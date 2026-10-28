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

interface ValidationOutcome {
  status: HealthCheckStatus;
  errorMessage?: string;
}

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

      await this.alerter.sendPendingAlerts().catch((err) => {
        console.error('[HealthChecker] Failed to send alerts:', err instanceof Error ? err.message : err);
      });
    } finally {
      this.running = false;
    }

    return checkedCount;
  }

  /** Run the validator and capture the outcome, catching any thrown errors. */
  private async executeValidation(credentials: PlatformCredentials, userId: string): Promise<ValidationOutcome> {
    this.db.credentials.recordHealthCheck(credentials.platform, 'checking', 0, undefined, userId);

    try {
      const validator = this.validators.get(credentials.platform as PlatformId)!;
      const result = await validator.validate(credentials);
      if (result.valid) {
        return { status: 'valid' };
      }
      return { status: 'error', errorMessage: result.error || 'Validation failed' };
    } catch (err) {
      return { status: 'error', errorMessage: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Record a valid result and create a recovery alert if the credential was previously expired. */
  private handleValidResult(credentials: PlatformCredentials, userId: string, wasExpired: boolean): void {
    this.db.credentials.recordHealthCheck(credentials.platform, 'valid', 0, undefined, userId);

    if (wasExpired) {
      this.alerter.createAlert({
        platform: credentials.platform,
        alertType: 'session_recovered',
        message: `登录态已恢复正常`,
        userId,
      });
      console.log(`[HealthChecker] ${credentials.platform}: recovered from expired`);
    }
  }

  /** Fire-and-forget auto-relogin for supported platforms. */
  private maybeTriggerRelogin(platform: string, userId: string): void {
    if (!this.reloginManager?.isPlatformSupported(platform)) return;

    if (!this.reloginManager.canAttempt(platform)) {
      console.log(`[HealthChecker] Relogin for ${platform} is in cooldown or rate-limited`);
      return;
    }

    console.log(`[HealthChecker] Triggering auto-relogin for ${platform}`);
    void this.reloginManager.attemptRelogin(platform, userId)
      .then((result) => {
        if (result.success) {
          console.log(`[HealthChecker] Auto-relogin succeeded for ${platform}`);
        } else {
          console.warn(`[HealthChecker] Auto-relogin failed for ${platform}: ${result.errorType} - ${result.errorMessage}`);
        }
      })
      .catch((err) => {
        console.error(`[HealthChecker] Relogin error for ${platform}:`, err instanceof Error ? err.message : err);
      });
  }

  /** Record an error result, auto-upgrade to expired if threshold reached, and create appropriate alerts. */
  private handleErrorResult(
    credentials: PlatformCredentials,
    userId: string,
    wasExpired: boolean,
    outcome: ValidationOutcome,
  ): HealthCheckStatus {
    const errorMessage = outcome.errorMessage;
    this.db.credentials.recordHealthCheck(credentials.platform, 'error', 0, errorMessage, userId);

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
        this.maybeTriggerRelogin(credentials.platform, userId);
      }
      return 'expired';
    }

    if (failures === 1 && !wasExpired) {
      this.alerter.createAlert({
        platform: credentials.platform,
        alertType: 'consecutive_failures',
        message: `健康检查失败: ${errorMessage}`,
        userId,
      });
    }

    return 'error';
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

    const outcome = await this.executeValidation(credentials, userId);

    const status = outcome.status === 'valid'
      ? (this.handleValidResult(credentials, userId, wasExpired), 'valid' as HealthCheckStatus)
      : this.handleErrorResult(credentials, userId, wasExpired, outcome);

    console.log(
      `[HealthChecker] ${credentials.platform}: ${status}` +
        (outcome.errorMessage ? ` (${outcome.errorMessage})` : '') +
        (previousHealth ? ` [failures: ${previousHealth.consecutiveFailures}→${this.db.credentials.getConsecutiveFailures(credentials.platform, userId)}]` : ''),
    );

    return status;
  }
}
