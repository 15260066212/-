/**
 * ReloginManager — Coordinates automatic re-login for platforms with
 * username/password login forms.
 *
 * Flow:
 * 1. Health checker detects expired session (3 consecutive failures)
 * 2. ReloginManager.attemptRelogin() is called
 * 3. Calls harvester's /api/rpa/relogin endpoint with stored credentials
 * 4. On success: updates credential data, marks as active
 * 5. On captcha: creates alert for manual intervention
 * 6. On failure: logs attempt, schedules retry with cooldown
 *
 * Supported platforms (auto-relogin): csdn, juejin, bilibili
 * Unsupported platforms (require manual): zhihu, baijia, toutiao, sohu, netease, zhidao
 */

import type { DatabaseAccess } from '../db.js';
import { HealthAlerter } from './alerter.js';

/** Platforms that support automatic re-login via username/password. */
const RELOGIN_SUPPORTED_PLATFORMS = new Set(['csdn', 'juejin', 'bilibili']);

/** Cooldown period between relogin attempts for the same platform (30 minutes). */
const RELOGIN_COOLDOWN_MS = 30 * 60 * 1000;

/** Maximum relogin attempts per platform per hour. */
const MAX_RELOGIN_PER_HOUR = 3;

interface ReloginResult {
  success: boolean;
  platform: string;
  errorType?: string;
  errorMessage?: string;
  cookieCount?: number;
  cookies?: string;
  screenshot?: string;
}

export class ReloginManager {
  private db: DatabaseAccess;
  private alerter: HealthAlerter;
  private lastAttemptTime = new Map<string, number>();
  private attemptCount = new Map<string, number[]>();

  constructor(db: DatabaseAccess) {
    this.db = db;
    this.alerter = new HealthAlerter(db);
  }

  /** Check if a platform supports automatic re-login. */
  isPlatformSupported(platform: string): boolean {
    return RELOGIN_SUPPORTED_PLATFORMS.has(platform);
  }

  /** Check if a relogin attempt is allowed (not in cooldown, under rate limit). */
  canAttempt(platform: string): boolean {
    if (!this.isPlatformSupported(platform)) return false;

    const now = Date.now();
    const lastAttempt = this.lastAttemptTime.get(platform);
    if (lastAttempt && now - lastAttempt < RELOGIN_COOLDOWN_MS) {
      return false;
    }

    // Clean up old attempt timestamps (older than 1 hour)
    const timestamps = this.attemptCount.get(platform) || [];
    const recent = timestamps.filter((t) => now - t < 60 * 60 * 1000);
    this.attemptCount.set(platform, recent);

    if (recent.length >= MAX_RELOGIN_PER_HOUR) {
      return false;
    }

    return true;
  }

  /**
   * Attempt automatic re-login for a platform.
   *
   * This calls the harvester service's /api/rpa/relogin endpoint, which
   * launches a headless browser, navigates to the platform's login page,
   * fills in the stored credentials, and extracts new cookies on success.
   *
   * If a captcha is encountered, the relogin fails with errorType='captcha'
   * and a manual intervention alert is created.
   */
  async attemptRelogin(
    platform: string,
    userId: string = 'user_default',
  ): Promise<ReloginResult> {
    if (!this.isPlatformSupported(platform)) {
      return {
        success: false,
        platform,
        errorType: 'unsupported',
        errorMessage: `Platform ${platform} does not support auto-relogin`,
      };
    }

    if (!this.canAttempt(platform)) {
      const lastAttempt = this.lastAttemptTime.get(platform) || 0;
      const remaining = Math.ceil((RELOGIN_COOLDOWN_MS - (Date.now() - lastAttempt)) / 60000);
      return {
        success: false,
        platform,
        errorType: 'cooldown',
        errorMessage: `Relogin for ${platform} is in cooldown (${remaining} min remaining)`,
      };
    }

    const harvesterUrl = process.env.RPA_REMOTE_URL;
    if (!harvesterUrl) {
      return {
        success: false,
        platform,
        errorType: 'config',
        errorMessage: 'RPA_REMOTE_URL is not configured — cannot reach harvester for relogin',
      };
    }

    // Get stored credentials
    const credential = this.db.credentials.getCredential(platform, userId);
    if (!credential) {
      return {
        success: false,
        platform,
        errorType: 'no_credentials',
        errorMessage: `No stored credentials for platform ${platform}`,
      };
    }

    // Extract username and password from credential data
    const username = credential.data?.username || credential.data?.account || credential.data?.phone || '';
    const password = credential.data?.password || credential.data?.pwd || '';

    if (!username || !password) {
      return {
        success: false,
        platform,
        errorType: 'no_credentials',
        errorMessage: `Credential data for ${platform} does not contain username/password`,
      };
    }

    // Record attempt time
    const now = Date.now();
    this.lastAttemptTime.set(platform, now);
    const timestamps = this.attemptCount.get(platform) || [];
    timestamps.push(now);
    this.attemptCount.set(platform, timestamps);

    console.log(`[ReloginManager] Attempting auto-relogin for ${platform} (user: ${username})`);

    try {
      const url = `${harvesterUrl.replace(/\/+$/, '')}/api/rpa/relogin`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, username, password }),
        signal: AbortSignal.timeout(60000),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const errorMessage = `Harvester /api/rpa/relogin returned HTTP ${res.status}: ${text}`;
        this.db.credentials.recordReloginAttempt(platform, userId, false, 'http_error', errorMessage);
        this.alerter.createAlert({
          platform,
          alertType: 'relogin_failed',
          message: `自动重新登录失败: ${errorMessage}`,
          userId,
        });
        return { success: false, platform, errorType: 'http_error', errorMessage };
      }

      const data = await res.json() as {
        success: boolean;
        cookies?: string;
        cookieCount?: number;
        errorType?: string;
        error?: string;
        errorMessage?: string;
        screenshot?: string;
        finalUrl?: string;
        hasAuthCookie?: boolean;
        loggedInElement?: boolean;
      };

      if (data.success && data.cookies) {
        // Login successful — update credentials in database
        const newData = {
          ...credential.data,
          cookieString: data.cookies,
          lastReloginAt: new Date().toISOString(),
        };

        this.db.credentials.updateCredentialData(platform, newData, userId);
        this.db.credentials.recordReloginAttempt(platform, userId, true, undefined, undefined, data.cookieCount);
        this.db.credentials.invalidateBrowserSession(userId, platform);

        // Mark credential as healthy
        this.db.credentials.recordHealthCheck(platform, 'valid', 0, undefined, userId);

        this.alerter.createAlert({
          platform,
          alertType: 'relogin_success',
          message: `自动重新登录成功，已更新Cookie (${data.cookieCount}个)`,
          userId,
        });

        console.log(`[ReloginManager] Relogin successful for ${platform} (${data.cookieCount} cookies)`);

        return {
          success: true,
          platform,
          cookieCount: data.cookieCount,
          cookies: data.cookies,
        };
      } else {
        // Login failed
        const errorType = data.errorType || 'unknown';
        const errorMessage = data.error || 'Login failed';

        this.db.credentials.recordReloginAttempt(platform, userId, false, errorType, errorMessage, undefined);

        if (errorType === 'captcha') {
          this.alerter.createAlert({
            platform,
            alertType: 'relogin_captcha',
            message: `自动重新登录遇到验证码，需要人工干预。截图: ${data.screenshot ? '已保存' : '无'}`,
            userId,
          });
          console.warn(`[ReloginManager] Captcha detected for ${platform} — manual intervention required`);
        } else {
          this.alerter.createAlert({
            platform,
            alertType: 'relogin_failed',
            message: `自动重新登录失败 (${errorType}): ${errorMessage}`,
            userId,
          });
          console.warn(`[ReloginManager] Relogin failed for ${platform}: ${errorMessage} (${errorType})`);
        }

        return {
          success: false,
          platform,
          errorType,
          errorMessage,
          screenshot: data.screenshot,
        };
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorType = errorMessage.includes('Timeout') || errorMessage.includes('abort') ? 'network' : 'unknown';

      this.db.credentials.recordReloginAttempt(platform, userId, false, errorType, errorMessage);

      this.alerter.createAlert({
        platform,
        alertType: 'relogin_failed',
        message: `重新登录请求异常: ${errorMessage}`,
        userId,
      });

      console.error(`[ReloginManager] Relogin error for ${platform}:`, errorMessage);

      return { success: false, platform, errorType, errorMessage };
    }
  }

  /**
   * Get the status of the relogin system.
   * Used by the monitor dashboard.
   */
  getStatus(): {
    supportedPlatforms: string[];
    cooldowns: Array<{ platform: string; lastAttemptAt: number; cooldownEndsAt: number; remainingMin: number }>;
    attemptHistory: Array<{ platform: string; recentAttempts: number }>;
  } {
    const now = Date.now();
    const cooldowns: Array<{ platform: string; lastAttemptAt: number; cooldownEndsAt: number; remainingMin: number }> = [];
    const attemptHistory: Array<{ platform: string; recentAttempts: number }> = [];

    for (const platform of RELOGIN_SUPPORTED_PLATFORMS) {
      const lastAttempt = this.lastAttemptTime.get(platform);
      if (lastAttempt) {
        const cooldownEndsAt = lastAttempt + RELOGIN_COOLDOWN_MS;
        const remaining = Math.max(0, cooldownEndsAt - now);
        if (remaining > 0) {
          cooldowns.push({
            platform,
            lastAttemptAt: lastAttempt,
            cooldownEndsAt,
            remainingMin: Math.ceil(remaining / 60000),
          });
        }
      }

      const timestamps = this.attemptCount.get(platform) || [];
      const recent = timestamps.filter((t) => now - t < 60 * 60 * 1000);
      attemptHistory.push({ platform, recentAttempts: recent.length });
    }

    return {
      supportedPlatforms: Array.from(RELOGIN_SUPPORTED_PLATFORMS),
      cooldowns,
      attemptHistory,
    };
  }
}
