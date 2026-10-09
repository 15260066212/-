import type { DatabaseAccess } from '../db.js';
import { getHarvesterPlatformName } from '@zemingengine/shared';

// === Cookie Warmer (Enhanced) ===
// Periodically visits platform pages with saved cookies to trigger Set-Cookie refresh,
// extending cookie lifetime without requiring re-login.
//
// Enhancements over original:
// 1. Adaptive interval: 1h default (down from 2h), auto-shortens on failures
// 2. Priority-based selection: warm oldest/expired credentials first
// 3. Retry failed warming with exponential backoff (up to 2 retries)
// 4. Warming failure triggers immediate health check for that credential
// 5. Pre-publish warming API for on-demand refresh before publishing
// 6. Per-platform freshness tracking and stats

const DEFAULT_INTERVAL_MS = parseInt(process.env.COOKIE_WARMER_INTERVAL_HOURS || '1', 10) * 60 * 60 * 1000;
const COOKIE_WARMER_BATCH_SIZE = parseInt(process.env.COOKIE_WARMER_BATCH_SIZE || '20', 10);
const WARM_RETRY_MAX = 2;
const WARM_RETRY_BASE_DELAY_MS = 5000;
const WARM_INTER_CRED_DELAY_MS = 2000;
const PRE_PUBLISH_WARM_TIMEOUT_MS = 45000;

let cookieWarmerTimer: ReturnType<typeof setInterval> | null = null;
let cookieWarmerLastRunAt: Date | null = null;
let cookieWarmerLastResult: { warmed: number; skipped: number; failed: number; retried: number } | null = null;
let cookieWarmerRunning = false;

interface PlatformWarmStats {
  total: number;
  warmed: number;
  failed: number;
  lastWarmedAt: number | null;
  lastFailedAt: number | null;
}

const platformStats = new Map<string, PlatformWarmStats>();

function getOrCreateStats(platform: string): PlatformWarmStats {
  let s = platformStats.get(platform);
  if (!s) {
    s = { total: 0, warmed: 0, failed: 0, lastWarmedAt: null, lastFailedAt: null };
    platformStats.set(platform, s);
  }
  return s;
}

function getAdaptiveInterval(): number {
  let interval = DEFAULT_INTERVAL_MS;
  for (const stats of platformStats.values()) {
    if (stats.total >= 3 && stats.failed / stats.total > 0.5) {
      interval = Math.min(interval, 30 * 60 * 1000);
    }
  }
  return interval;
}

/**
 * Run one batch of cookie warming: visit platform pages with saved cookies,
 * let the platform issue fresh Set-Cookie headers, and persist the refreshed cookies.
 */
async function runCookieWarmBatch(db: DatabaseAccess): Promise<void> {
  const harvesterUrl = process.env.RPA_REMOTE_URL;
  if (!harvesterUrl) {
    console.warn('[CookieWarmer] RPA_REMOTE_URL not set, skipping');
    return;
  }

  cookieWarmerRunning = true;
  cookieWarmerLastRunAt = new Date();
  let warmed = 0;
  let skipped = 0;
  let failed = 0;
  let retried = 0;

  const due = selectCredentialsForWarming(db);

  if (due.length === 0) {
    console.log('[CookieWarmer] No credentials due for warming');
    cookieWarmerLastResult = { warmed: 0, skipped: 0, failed: 0, retried: 0 };
    cookieWarmerRunning = false;
    return;
  }

  console.log(`[CookieWarmer] Warming ${due.length} credentials (priority: oldest first)...`);

  for (const cred of due) {
    const result = await warmSingleCredentialWithRetry(db, harvesterUrl, cred);
    if (result === 'warmed') warmed++;
    else if (result === 'skipped') skipped++;
    else failed++;

    await new Promise((resolve) => setTimeout(resolve, WARM_INTER_CRED_DELAY_MS));
  }

  cookieWarmerLastResult = { warmed, skipped, failed, retried };
  cookieWarmerRunning = false;
  console.log(
    `[CookieWarmer] Batch complete (warmed: ${warmed}, skipped: ${skipped}, failed: ${failed}, retried: ${retried})`,
  );
}

/**
 * Select credentials due for warming, sorted by priority:
 * 1. Expired credentials (most urgent)
 * 2. Oldest lastValidatedAt first (closest to expiry)
 */
function selectCredentialsForWarming(db: DatabaseAccess) {
  const allCreds = db.credentials.getAllCredentials();
  const warmThreshold = Date.now() - 1 * 60 * 60 * 1000;

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

/**
 * Warm a single credential with retry on failure.
 * Uses exponential backoff: 5s, 10s between retries.
 */
async function warmSingleCredentialWithRetry(
  db: DatabaseAccess,
  harvesterUrl: string,
  cred: { platform: string; accountId: string; data: Record<string, string> },
): Promise<'warmed' | 'skipped' | 'failed'> {
  let lastResult: 'warmed' | 'skipped' | 'failed' = 'failed';

  for (let attempt = 0; attempt <= WARM_RETRY_MAX; attempt++) {
    if (attempt > 0) {
      const delay = WARM_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.log(`[CookieWarmer] Retrying ${cred.platform}:${cred.accountId} (attempt ${attempt + 1}) after ${delay}ms`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    lastResult = await warmSingleCredential(db, harvesterUrl, cred);
    if (lastResult === 'warmed' || lastResult === 'skipped') break;
  }

  if (lastResult === 'failed') {
    console.warn(
      `[CookieWarmer] ${cred.platform}:${cred.accountId} failed after ${WARM_RETRY_MAX + 1} attempts, triggering health check`,
    );
    db.credentials.recordHealthCheck(
      cred.platform,
      'error',
      0,
      'Cookie warming failed after retries',
      'user_default',
    );
  }

  return lastResult;
}

/** Warm a single credential by calling the harvester's refresh endpoint. */
async function warmSingleCredential(
  db: DatabaseAccess,
  harvesterUrl: string,
  cred: { platform: string; accountId: string; data: Record<string, string> },
): Promise<'warmed' | 'skipped' | 'failed'> {
  const cookie = cred.data.cookie || cred.data.cookies || '';
  const storageState = cred.data.storageState || '';
  const fingerprintData = cred.data.fingerprintData || '';

  // Need at least one auth method
  if (
    (!cookie || cookie === 'placeholder_pending_login') &&
    !storageState
  ) {
    console.log(`[CookieWarmer] Skipping ${cred.platform}:${cred.accountId} - no real auth data`);
    return 'skipped';
  }

  const harvesterPlatform = getHarvesterPlatformName(cred.platform);
  const stats = getOrCreateStats(cred.platform);
  stats.total++;

  try {
    const refreshUrl = `${harvesterUrl.replace(/\/+$/, '')}/api/rpa/refresh-cookies`;

    // Build request body: prefer storageState, include fingerprint if available
    const body: Record<string, string> = { platform: harvesterPlatform };
    if (storageState) {
      body.storageState = storageState;
    } else if (cookie) {
      body.cookies = cookie;
    }
    if (fingerprintData) {
      body.fingerprintData = fingerprintData;
    }

    const res = await fetch(refreshUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      console.warn(`[CookieWarmer] ${cred.platform}:${cred.accountId} - HTTP ${res.status}`);
      stats.failed++;
      stats.lastFailedAt = Date.now();
      return 'failed';
    }

    const data = (await res.json()) as {
      success: boolean;
      valid: boolean;
      refreshedCookies?: string;
      refreshedStorageState?: string;
      refreshedFingerprintData?: string;
      reason?: string;
    };

    if (data.success && data.valid) {
      // Build the update payload — save whatever the harvester returned
      const updateData: Record<string, string> = {};

      // Prefer full storageState over legacy cookie string
      if (data.refreshedStorageState) {
        updateData.storageState = data.refreshedStorageState;
        // Also keep a cookie string for backward compatibility
        if (data.refreshedCookies) {
          updateData.cookie = data.refreshedCookies;
        }
      } else if (data.refreshedCookies) {
        updateData.cookie = data.refreshedCookies;
      }

      // Save fingerprint if returned (consistent identity across refreshes)
      if (data.refreshedFingerprintData) {
        updateData.fingerprintData = data.refreshedFingerprintData;
      }

      if (Object.keys(updateData).length > 0) {
        db.credentials.updateCredentialData(
          cred.platform,
          updateData,
          'user_default',
          cred.accountId,
        );
      }

      db.credentials.updateCredentialStatus(cred.platform, 'active', 'user_default', cred.accountId);
      stats.warmed++;
      stats.lastWarmedAt = Date.now();
      console.log(`[CookieWarmer] Refreshed ${cred.platform}:${cred.accountId} - OK`);
      return 'warmed';
    }

    console.log(`[CookieWarmer] ${cred.platform}:${cred.accountId} - ${data.reason || 'not valid'}`);
    if (data.success && !data.valid) {
      db.credentials.updateCredentialStatus(cred.platform, 'expired', 'user_default', cred.accountId);
    }
    stats.failed++;
    stats.lastFailedAt = Date.now();
    return 'failed';
  } catch (err) {
    console.warn(
      `[CookieWarmer] Error warming ${cred.platform}:${cred.accountId}:`,
      err instanceof Error ? err.message : err,
    );
    stats.failed++;
    stats.lastFailedAt = Date.now();
    return 'failed';
  }
}

/**
 * Pre-publish warming: warm a specific platform's cookies on demand.
 * Called before publishing to ensure cookies are fresh.
 * Returns the refreshed credentials (cookie + storageState + fingerprintData), or null if warming failed.
 */
export async function warmForPublish(
  db: DatabaseAccess,
  platform: string,
  accountId: string = 'default',
): Promise<{ cookie: string; storageState?: string; fingerprintData?: string } | null> {
  const harvesterUrl = process.env.RPA_REMOTE_URL;
  if (!harvesterUrl) {
    console.warn('[CookieWarmer] Pre-publish warm: RPA_REMOTE_URL not set');
    return null;
  }

  const cred = db.credentials.getCredential(platform, 'user_default', accountId);
  if (!cred) {
    console.warn(`[CookieWarmer] Pre-publish warm: no credential for ${platform}:${accountId}`);
    return null;
  }

  const cookie = cred.data.cookie || cred.data.cookies || '';
  const storageState = cred.data.storageState || '';
  const fingerprintData = cred.data.fingerprintData || '';

  if (
    (!cookie || cookie === 'placeholder_pending_login') &&
    !storageState
  ) {
    console.warn(`[CookieWarmer] Pre-publish warm: no real auth data for ${platform}:${accountId}`);
    return null;
  }

  const harvesterPlatform = getHarvesterPlatformName(platform);
  console.log(`[CookieWarmer] Pre-publish warming for ${platform}:${accountId}`);

  try {
    const refreshUrl = `${harvesterUrl.replace(/\/+$/, '')}/api/rpa/refresh-cookies`;

    // Build request body: prefer storageState, include fingerprint if available
    const body: Record<string, string> = { platform: harvesterPlatform };
    if (storageState) {
      body.storageState = storageState;
    } else if (cookie) {
      body.cookies = cookie;
    }
    if (fingerprintData) {
      body.fingerprintData = fingerprintData;
    }

    const res = await fetch(refreshUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PRE_PUBLISH_WARM_TIMEOUT_MS),
    });

    if (!res.ok) {
      console.warn(`[CookieWarmer] Pre-publish warm: HTTP ${res.status} for ${platform}`);
      return null;
    }

    const data = (await res.json()) as {
      success: boolean;
      valid: boolean;
      refreshedCookies?: string;
      refreshedStorageState?: string;
      refreshedFingerprintData?: string;
      reason?: string;
    };

    if (data.success && data.valid) {
      // Build the update payload — save whatever the harvester returned
      const updateData: Record<string, string> = {};
      const result: { cookie: string; storageState?: string; fingerprintData?: string } = {
        cookie: data.refreshedCookies || cookie,
      };

      if (data.refreshedStorageState) {
        updateData.storageState = data.refreshedStorageState;
        result.storageState = data.refreshedStorageState;
        if (data.refreshedCookies) {
          updateData.cookie = data.refreshedCookies;
        }
      } else if (data.refreshedCookies) {
        updateData.cookie = data.refreshedCookies;
      }

      if (data.refreshedFingerprintData) {
        updateData.fingerprintData = data.refreshedFingerprintData;
        result.fingerprintData = data.refreshedFingerprintData;
      }

      if (Object.keys(updateData).length > 0) {
        db.credentials.updateCredentialData(
          platform,
          updateData,
          'user_default',
          accountId,
        );
      }

      db.credentials.updateCredentialStatus(platform, 'active', 'user_default', accountId);
      console.log(`[CookieWarmer] Pre-publish warm succeeded for ${platform}:${accountId}`);
      return result;
    }

    console.warn(
      `[CookieWarmer] Pre-publish warm failed for ${platform}:${accountId}: ${data.reason || 'invalid'}`,
    );
    if (data.success && !data.valid) {
      db.credentials.updateCredentialStatus(platform, 'expired', 'user_default', accountId);
    }
    return null;
  } catch (err) {
    console.warn(
      `[CookieWarmer] Pre-publish warm error for ${platform}:${accountId}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export function startCookieWarmer(db: DatabaseAccess): void {
  if (cookieWarmerTimer) {
    console.warn('[CookieWarmer] Already running');
    return;
  }

  const intervalHours = process.env.COOKIE_WARMER_INTERVAL_HOURS || '1';
  console.log(`[CookieWarmer] Starting (every ${intervalHours}h, batch size ${COOKIE_WARMER_BATCH_SIZE})`);

  setTimeout(() => {
    runCookieWarmBatch(db).catch((err) => {
      console.error('[CookieWarmer] First batch failed:', err instanceof Error ? err.message : err);
    });
  }, 30000);

  cookieWarmerTimer = setInterval(() => {
    runCookieWarmBatch(db).catch((err) => {
      console.error('[CookieWarmer] Batch failed:', err instanceof Error ? err.message : err);
    });
  }, getAdaptiveInterval());
}

export function stopCookieWarmer(): void {
  if (cookieWarmerTimer) {
    clearInterval(cookieWarmerTimer);
    cookieWarmerTimer = null;
    console.log('[CookieWarmer] Stopped');
  }
}

export function getCookieWarmerStatus() {
  return {
    running: cookieWarmerRunning,
    lastRunAt: cookieWarmerLastRunAt,
    lastResult: cookieWarmerLastResult,
    platformStats: Object.fromEntries(platformStats.entries()),
    adaptiveIntervalMs: getAdaptiveInterval(),
  };
}
