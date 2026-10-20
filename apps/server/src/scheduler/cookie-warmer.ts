import type { DatabaseAccess } from '../db.js';
import { HarvesterClient, type RefreshResponse } from '../session-health/harvester-client.js';

// === Cookie Warmer (Profile-first) ===
// Periodically visits platform pages with saved cookies / profiles to trigger
// Set-Cookie refresh, extending login lifetime without requiring re-login.
//
// Profile-first strategy:
// 1. Try Profile renewal (full browser session refresh) — most reliable
// 2. Fall back to cookie refresh if profile doesn't exist or renewal fails
//
// Encapsulated as a class to eliminate global mutable state and make the
// warmer testable (can create multiple instances with different configs).

const DEFAULT_INTERVAL_MS = parseFloat(process.env.COOKIE_WARMER_INTERVAL_HOURS || '0.5') * 60 * 60 * 1000;
const COOKIE_WARMER_BATCH_SIZE = parseInt(process.env.COOKIE_WARMER_BATCH_SIZE || '20', 10);
const WARM_RETRY_MAX = 2;
const WARM_RETRY_BASE_DELAY_MS = 5000;
const WARM_INTER_CRED_DELAY_MS = 2000;
const PRE_PUBLISH_WARM_TIMEOUT_MS = 45000;

/** Threshold: credentials older than this are due for warming (ms). */
const WARM_THRESHOLD_MS = 30 * 60 * 1000;
/** Adaptive interval: when failure rate is high, shorten to this (ms). */
const ADAPTIVE_MIN_INTERVAL_MS = 30 * 60 * 1000;
/** Delay before first warm batch runs after start (ms). */
const FIRST_BATCH_DELAY_MS = 30000;
/** Minimum total samples before applying adaptive interval. */
const ADAPTIVE_MIN_SAMPLES = 3;
/** Failure rate threshold to trigger adaptive interval (0-1). */
const ADAPTIVE_FAILURE_RATE_THRESHOLD = 0.5;

interface PlatformWarmStats {
  total: number;
  warmed: number;
  failed: number;
  lastWarmedAt: number | null;
  lastFailedAt: number | null;
}

interface WarmBatchResult {
  warmed: number;
  skipped: number;
  failed: number;
  retried: number;
}

type WarmOutcome = 'warmed' | 'skipped' | 'failed';

/**
 * CookieWarmer — profile-first credential freshness manager.
 *
 * Encapsulates all warmer state (timer, stats, running flag) so there are
 * no module-level mutable variables. Exposes the same public API as the
 * previous functional version for drop-in replacement.
 */
export class CookieWarmer {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastRunAt: Date | null = null;
  private lastResult: WarmBatchResult | null = null;
  private running = false;
  private platformStats = new Map<string, PlatformWarmStats>();
  private db: DatabaseAccess;
  private harvesterUrl: string;

  constructor(db: DatabaseAccess, harvesterUrl?: string) {
    this.db = db;
    this.harvesterUrl = harvesterUrl || process.env.RPA_REMOTE_URL || '';
  }

  // --- Public API ---

  start(): void {
    if (this.timer) {
      console.warn('[CookieWarmer] Already running');
      return;
    }
    if (!this.harvesterUrl) {
      console.warn('[CookieWarmer] RPA_REMOTE_URL not set, cannot start');
      return;
    }

    const intervalHours = process.env.COOKIE_WARMER_INTERVAL_HOURS || '0.5';
    console.log(`[CookieWarmer] Starting (every ${intervalHours}h, batch size ${COOKIE_WARMER_BATCH_SIZE})`);

    setTimeout(() => {
      this.runBatch().catch((err) => {
        console.error('[CookieWarmer] First batch failed:', err instanceof Error ? err.message : err);
      });
    }, FIRST_BATCH_DELAY_MS);

    this.timer = setInterval(() => {
      this.runBatch().catch((err) => {
        console.error('[CookieWarmer] Batch failed:', err instanceof Error ? err.message : err);
      });
    }, this.getAdaptiveInterval());
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[CookieWarmer] Stopped');
    }
  }

  getStatus() {
    return {
      running: this.running,
      lastRunAt: this.lastRunAt,
      lastResult: this.lastResult,
      platformStats: Object.fromEntries(this.platformStats.entries()),
      adaptiveIntervalMs: this.getAdaptiveInterval(),
    };
  }

  /**
   * Pre-publish warming: warm a specific platform's credentials on demand.
   * Called before publishing to ensure login state is fresh.
   */
  async warmForPublish(
    platform: string,
    accountId: string = 'default',
  ): Promise<{ cookie: string; storageState?: string; fingerprintData?: string } | null> {
    if (!this.harvesterUrl) {
      console.warn('[CookieWarmer] Pre-publish warm: RPA_REMOTE_URL not set');
      return null;
    }

    const cred = this.db.credentials.getCredential(platform, 'user_default', accountId);
    if (!cred) {
      console.warn(`[CookieWarmer] Pre-publish warm: no credential for ${platform}:${accountId}`);
      return null;
    }

    const client = new HarvesterClient(this.harvesterUrl);

    // Strategy 1: Profile renewal (if accountName exists)
    if (cred.accountName) {
      try {
        const profileResult = await client.renewProfile(platform, cred.accountName);
        if (profileResult?.success && profileResult.loggedIn) {
          this.db.credentials.updateCredentialStatus(platform, 'active', 'user_default', accountId);
          const stats = this.getOrCreateStats(platform);
          stats.warmed++;
          stats.lastWarmedAt = Date.now();
          console.log(`[CookieWarmer] Pre-publish profile renewed ${platform}:${accountId}`);
          // Profile renewal succeeded — return existing credential data
          return {
            cookie: cred.data.cookie || cred.data.cookies || '',
            storageState: cred.data.storageState,
            fingerprintData: cred.data.fingerprintData,
          };
        }
      } catch {
        console.log(`[CookieWarmer] Pre-publish profile renewal failed for ${platform}:${accountId}, trying cookie refresh`);
      }
    }

    // Strategy 2: Cookie refresh (fallback)
    const body = client.buildRefreshBody(cred.data, platform);
    if (!body) {
      console.warn(`[CookieWarmer] Pre-publish warm: no real auth data for ${platform}:${accountId}`);
      return null;
    }

    console.log(`[CookieWarmer] Pre-publish warming for ${platform}:${accountId}`);

    const data = await client.refreshCookies(body, PRE_PUBLISH_WARM_TIMEOUT_MS);
    if (!data) {
      console.warn(`[CookieWarmer] Pre-publish warm: fetch failed for ${platform}`);
      return null;
    }

    if (data.success && data.valid) {
      const updateData = HarvesterClient.extractUpdateData(data);
      const result: { cookie: string; storageState?: string; fingerprintData?: string } = {
        cookie: data.refreshedCookies || cred.data.cookie || cred.data.cookies || '',
      };

      if (data.refreshedStorageState) {
        result.storageState = data.refreshedStorageState;
      }
      if (data.refreshedFingerprintData) {
        result.fingerprintData = data.refreshedFingerprintData;
      }

      if (Object.keys(updateData).length > 0) {
        this.db.credentials.updateCredentialData(platform, updateData, 'user_default', accountId);
      }

      this.db.credentials.updateCredentialStatus(platform, 'active', 'user_default', accountId);
      const stats = this.getOrCreateStats(platform);
      stats.warmed++;
      stats.lastWarmedAt = Date.now();
      console.log(`[CookieWarmer] Pre-publish warm succeeded for ${platform}:${accountId}`);
      return result;
    }

    console.warn(
      `[CookieWarmer] Pre-publish warm failed for ${platform}:${accountId}: ${data.reason || 'invalid'}`,
    );
    if (data.success && !data.valid) {
      this.db.credentials.updateCredentialStatus(platform, 'expired', 'user_default', accountId);
      const stats = this.getOrCreateStats(platform);
      stats.failed++;
      stats.lastFailedAt = Date.now();
    }
    return null;
  }

  // --- Internal methods ---

  private async runBatch(): Promise<void> {
    if (!this.harvesterUrl) return;

    this.running = true;
    this.lastRunAt = new Date();
    let warmed = 0;
    let skipped = 0;
    let failed = 0;
    let retried = 0;

    const due = this.selectCredentialsForWarming();

    if (due.length === 0) {
      console.log('[CookieWarmer] No credentials due for warming');
      this.lastResult = { warmed: 0, skipped: 0, failed: 0, retried: 0 };
      this.running = false;
      return;
    }

    console.log(`[CookieWarmer] Warming ${due.length} credentials (priority: oldest first)...`);

    const client = new HarvesterClient(this.harvesterUrl);

    for (const cred of due) {
      const result = await this.warmSingleWithRetry(client, cred);
      if (result === 'warmed') warmed++;
      else if (result === 'skipped') skipped++;
      else failed++;

      await new Promise((resolve) => setTimeout(resolve, WARM_INTER_CRED_DELAY_MS));
    }

    this.lastResult = { warmed, skipped, failed, retried };
    this.running = false;
    console.log(
      `[CookieWarmer] Batch complete (warmed: ${warmed}, skipped: ${skipped}, failed: ${failed}, retried: ${retried})`,
    );
  }

  private selectCredentialsForWarming() {
    const allCreds = this.db.credentials.getAllCredentials();
    const warmThreshold = Date.now() - WARM_THRESHOLD_MS;

    const due = allCreds.filter((c) => {
      if (c.status === 'invalid') return false;
      const lastValidated = c.lastValidatedAt ? new Date(c.lastValidatedAt).getTime() : 0;
      return lastValidated < warmThreshold;
    });

    due.sort((a, b) => {
      if (a.status === 'expired' && b.status !== 'expired') return -1;
      if (b.status === 'expired' && a.status !== 'expired') return 1;
      const aTime = a.lastValidatedAt ? new Date(a.lastValidatedAt).getTime() : 0;
      const bTime = b.lastValidatedAt ? new Date(b.lastValidatedAt).getTime() : 0;
      return aTime - bTime;
    });

    return due.slice(0, COOKIE_WARMER_BATCH_SIZE);
  }

  private async warmSingleWithRetry(
    client: HarvesterClient,
    cred: { platform: string; accountId: string; data: Record<string, string> },
  ): Promise<WarmOutcome> {
    let lastResult: WarmOutcome = 'failed';

    for (let attempt = 0; attempt <= WARM_RETRY_MAX; attempt++) {
      if (attempt > 0) {
        const delay = WARM_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.log(`[CookieWarmer] Retrying ${cred.platform}:${cred.accountId} (attempt ${attempt + 1}) after ${delay}ms`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      lastResult = await this.warmSingle(client, cred);
      if (lastResult === 'warmed' || lastResult === 'skipped') break;
    }

    if (lastResult === 'failed') {
      console.warn(
        `[CookieWarmer] ${cred.platform}:${cred.accountId} failed after ${WARM_RETRY_MAX + 1} attempts, triggering health check`,
      );
      this.db.credentials.recordHealthCheck(
        cred.platform,
        'error',
        0,
        'Cookie warming failed after retries',
        'user_default',
      );
    }

    return lastResult;
  }

  /** Warm a single credential — try profile renewal first, fallback to cookie refresh. */
  private async warmSingle(
    client: HarvesterClient,
    cred: { platform: string; accountId: string; accountName?: string; data: Record<string, string> },
  ): Promise<WarmOutcome> {
    const stats = this.getOrCreateStats(cred.platform);
    stats.total++;

    // Strategy 1: Profile renewal (if accountName exists)
    if (cred.accountName) {
      try {
        const profileResult = await client.renewProfile(cred.platform, cred.accountName);
        if (profileResult?.success) {
          if (profileResult.loggedIn) {
            this.db.credentials.updateCredentialStatus(cred.platform, 'active', 'user_default', cred.accountId);
            stats.warmed++;
            stats.lastWarmedAt = Date.now();
            console.log(`[CookieWarmer] Profile renewed ${cred.platform}:${cred.accountName} - OK`);
            return 'warmed';
          } else {
            console.log(`[CookieWarmer] Profile ${cred.platform}:${cred.accountName} - not logged in, falling back to cookie refresh`);
          }
        }
      } catch {
        console.log(`[CookieWarmer] Profile renewal failed for ${cred.platform}:${cred.accountName}, trying cookie refresh`);
      }
    }

    // Strategy 2: Cookie refresh (fallback)
    const body = client.buildRefreshBody(cred.data, cred.platform);
    if (!body) {
      console.log(`[CookieWarmer] Skipping ${cred.platform}:${cred.accountId} - no real auth data`);
      return 'skipped';
    }

    const data = await client.refreshCookies(body);

    if (!data) {
      console.warn(`[CookieWarmer] ${cred.platform}:${cred.accountId} - fetch failed`);
      stats.failed++;
      stats.lastFailedAt = Date.now();
      return 'failed';
    }

    if (data.success && data.valid) {
      const updateData = HarvesterClient.extractUpdateData(data);
      if (Object.keys(updateData).length > 0) {
        this.db.credentials.updateCredentialData(
          cred.platform,
          updateData,
          'user_default',
          cred.accountId,
        );
      }
      this.db.credentials.updateCredentialStatus(cred.platform, 'active', 'user_default', cred.accountId);
      stats.warmed++;
      stats.lastWarmedAt = Date.now();
      console.log(`[CookieWarmer] Refreshed ${cred.platform}:${cred.accountId} - OK`);
      return 'warmed';
    }

    console.log(`[CookieWarmer] ${cred.platform}:${cred.accountId} - ${data.reason || 'not valid'}`);
    if (data.success && !data.valid) {
      this.db.credentials.updateCredentialStatus(cred.platform, 'expired', 'user_default', cred.accountId);
    }
    stats.failed++;
    stats.lastFailedAt = Date.now();
    return 'failed';
  }

  private getOrCreateStats(platform: string): PlatformWarmStats {
    let s = this.platformStats.get(platform);
    if (!s) {
      s = { total: 0, warmed: 0, failed: 0, lastWarmedAt: null, lastFailedAt: null };
      this.platformStats.set(platform, s);
    }
    return s;
  }

  private getAdaptiveInterval(): number {
    let interval = DEFAULT_INTERVAL_MS;
    for (const stats of this.platformStats.values()) {
      if (stats.total >= ADAPTIVE_MIN_SAMPLES && stats.failed / stats.total > ADAPTIVE_FAILURE_RATE_THRESHOLD) {
        interval = Math.min(interval, ADAPTIVE_MIN_INTERVAL_MS);
      }
    }
    return interval;
  }
}

// --- Singleton instance + backward-compatible functional API ---
// The rest of the codebase uses startCookieWarmer / stopCookieWarmer / etc.
// We keep those as thin wrappers around a singleton CookieWarmer instance.

let singleton: CookieWarmer | null = null;

function getSingleton(db?: DatabaseAccess): CookieWarmer | null {
  if (!singleton && db) {
    singleton = new CookieWarmer(db);
  }
  return singleton;
}

export function startCookieWarmer(db: DatabaseAccess): void {
  getSingleton(db)?.start();
}

export function stopCookieWarmer(): void {
  singleton?.stop();
}

export function getCookieWarmerStatus() {
  return singleton?.getStatus() ?? {
    running: false,
    lastRunAt: null,
    lastResult: null,
    platformStats: {},
    adaptiveIntervalMs: DEFAULT_INTERVAL_MS,
  };
}

export async function warmForPublish(
  db: DatabaseAccess,
  platform: string,
  accountId: string = 'default',
): Promise<{ cookie: string; storageState?: string; fingerprintData?: string } | null> {
  const warmer = getSingleton(db);
  return warmer?.warmForPublish(platform, accountId) ?? null;
}
