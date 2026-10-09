import type { PlatformCredentials, PlatformId } from '@zemingengine/shared';
import type { DatabaseAccess } from '../db.js';
import { BaseValidator } from './validators/base.js';
import { WechatValidator } from './validators/wechat.js';
import { createHarvesterValidators } from './validators/harvester-registry.js';
import type { HarvesterBrowserValidator } from './validators/harvester-browser.js';
import { HealthAlerter } from './alerter.js';
import type { ReloginManager } from './relogin-manager.js';
import {
  CHECK_BATCH_SIZE,
  MAX_CONSECUTIVE_FAILURES,
  type HealthCheckStatus,
} from './types.js';

export class SessionHealthChecker {
  private db: DatabaseAccess;
  private validators: Map<PlatformId, BaseValidator> = new Map();
  private alerter: HealthAlerter;
  private reloginManager?: ReloginManager;
  private running = false;

  constructor(db: DatabaseAccess, reloginManager?: ReloginManager) {
    this.db = db;
    this.alerter = new HealthAlerter(db);
    this.reloginManager = reloginManager;
    this.registerValidator(new WechatValidator());

    if (process.env.RPA_REMOTE_URL) {
      const harvesterValidators = createHarvesterValidators();
      for (const v of harvesterValidators) {
        this.registerValidator(v);
      }
      console.log(`[HealthChecker] Registered ${harvesterValidators.length} RPA platform validators (harvester mode)`);
    }
  }

  /** Set or update the relogin manager (for late injection). */
  setReloginManager(mgr: ReloginManager): void {
    this.reloginManager = mgr;
  }

  registerValidator(validator: BaseValidator): void {
    // Inject database access for validators that support cookie refresh
    if ('setDatabase' in validator && typeof (validator as { setDatabase: (db: DatabaseAccess) => void }).setDatabase === 'function') {
      (validator as HarvesterBrowserValidator).setDatabase(this.db);
    }
    this.validators.set(validator.platform, validator);
  }

  hasValidator(platform: PlatformId): boolean {
    return this.validators.has(platform);
  }

  /**
   * Run a batch of health checks on credentials that are due.
   * Called periodically by the scheduler.
   */
  async runCheckBatch(batchSize: number = CHECK_BATCH_SIZE): Promise<number> {
    if (this.running) {
      console.log('[HealthChecker] Skipping batch: previous batch still running');
      return 0;
    }

    this.running = true;
    let checkedCount = 0;

    try {
      const dueCredentials = this.db.credentials.getCredentialsDueForCheck(batchSize);
      const toCheck = dueCredentials.filter((c) => this.hasValidator(c.platform as PlatformId));

      if (toCheck.length === 0) {
        return 0;
      }

      console.log(`[HealthChecker] Checking ${toCheck.length} credential(s)`);

      const promises = toCheck.map(async (cred) => {
        try {
          await this.checkCredential(cred);
        } catch (err) {
          console.error(
            `[HealthChecker] Unexpected error checking ${cred.platform}:`,
            err instanceof Error ? err.message : err,
          );
        }
      });

      await Promise.all(promises);
      checkedCount = toCheck.length;

      // Send pending alerts after batch completes
      await this.alerter.sendPendingAlerts().catch((err) => {
        console.error('[HealthChecker] Failed to send alerts:', err instanceof Error ? err.message : err);
      });
    } finally {
      this.running = false;
    }

    return checkedCount;
  }

  /**
   * Check a single credential's health status.
   * Auto-upgrades to 'expired' after MAX_CONSECUTIVE_FAILURES.
   * Creates alerts on status transitions.
   */
  async checkCredential(credentials: PlatformCredentials): Promise<HealthCheckStatus> {
    const validator = this.validators.get(credentials.platform as PlatformId);
    if (!validator) {
      return 'valid';
    }

    const userId = 'user_default';
    const previousHealth = this.db.credentials.getCredentialHealthDetail(credentials.platform, userId);
    const wasExpired = previousHealth?.status === 'expired';

    let status: HealthCheckStatus = 'valid';
    let errorMessage: string | undefined;

    try {
      this.db.credentials.recordHealthCheck(credentials.platform, 'checking', 0, undefined, userId);

      const result = await validator.validate(credentials);

      if (result.valid) {
        status = 'valid';
      } else {
        errorMessage = result.error || 'Validation failed';
        status = 'error';
      }
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      status = 'error';
    }

    if (status === 'valid') {
      this.db.credentials.recordHealthCheck(credentials.platform, 'valid', 0, undefined, userId);

      // Recovery alert: was expired, now valid
      if (wasExpired) {
        this.alerter.createAlert({
          platform: credentials.platform,
          alertType: 'session_recovered',
          message: `登录态已恢复正常`,
          userId,
        });
        console.log(`[HealthChecker] ${credentials.platform}: recovered from expired`);
      }
    } else {
      this.db.credentials.recordHealthCheck(credentials.platform, status, 0, errorMessage, userId);

      // Check consecutive failures → auto-upgrade to expired
      const failures = this.db.credentials.getConsecutiveFailures(credentials.platform, userId);
      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        const reason = `连续 ${failures} 次检查失败: ${errorMessage}`;
        this.db.credentials.markCredentialExpired(credentials.platform, reason, userId);

        if (!wasExpired) {
          this.alerter.createAlert({
            platform: credentials.platform,
            alertType: 'session_expired',
            message: reason,
            userId,
          });

          // Trigger auto-relogin for supported platforms (async, non-blocking)
          if (this.reloginManager?.isPlatformSupported(credentials.platform)) {
            if (this.reloginManager.canAttempt(credentials.platform)) {
              console.log(`[HealthChecker] Triggering auto-relogin for ${credentials.platform}`);
              void this.reloginManager.attemptRelogin(credentials.platform, userId)
                .then((result) => {
                  if (result.success) {
                    console.log(`[HealthChecker] Auto-relogin succeeded for ${credentials.platform}`);
                  } else {
                    console.warn(`[HealthChecker] Auto-relogin failed for ${credentials.platform}: ${result.errorType} - ${result.errorMessage}`);
                  }
                })
                .catch((err) => {
                  console.error(`[HealthChecker] Relogin error for ${credentials.platform}:`, err instanceof Error ? err.message : err);
                });
            } else {
              console.log(`[HealthChecker] Relogin for ${credentials.platform} is in cooldown or rate-limited`);
            }
          }
        }

        status = 'expired';
      }

      // Alert on first failure if not already expired
      if (failures === 1 && !wasExpired) {
        this.alerter.createAlert({
          platform: credentials.platform,
          alertType: 'consecutive_failures',
          message: `健康检查失败: ${errorMessage}`,
          userId,
        });
      }
    }

    console.log(
      `[HealthChecker] ${credentials.platform}: ${status}` +
        (errorMessage ? ` (${errorMessage})` : '') +
        (previousHealth ? ` [failures: ${previousHealth.consecutiveFailures}→${this.db.credentials.getConsecutiveFailures(credentials.platform, userId)}]` : ''),
    );

    return status;
  }
}
