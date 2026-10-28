import crypto from 'node:crypto';
import type { DB } from '../db.js';
import type { PlatformCredentials } from '@zemingengine/shared';
import { getCanonicalPlatformId } from '@zemingengine/shared';
import { encryptJSON, decryptJSON } from '@zemingengine/account-vault';

const ENCRYPTION_PREFIX = 'enc:';
const LEGACY_SALT = 'geo-account-vault-v1';

// === Repository Constants ===
/** AES-256 key length in bytes for scrypt derivation */
const ENCRYPTION_KEY_BYTE_LENGTH = 32;
/** Default browser session max age in hours (7 days) */
const DEFAULT_SESSION_MAX_AGE_HOURS = 168;
/** Default credential health check interval (6 hours in milliseconds) */
const DEFAULT_CREDENTIAL_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Default batch size for credential health checks */
const DEFAULT_HEALTH_CHECK_BATCH_SIZE = 3;
/** Default limit for health log queries */
const DEFAULT_HEALTH_LOGS_LIMIT = 50;
/** Default limit for relogin log queries */
const DEFAULT_RELOGIN_LOGS_LIMIT = 50;

function decryptWithLegacySalt(ciphertext: string): Record<string, string> {
  const raw = ciphertext.startsWith(ENCRYPTION_PREFIX)
    ? ciphertext.slice(ENCRYPTION_PREFIX.length)
    : ciphertext;
  const parts = raw.split(':');
  if (parts.length !== 3) throw new Error('Invalid ciphertext format');
  const passphrase = process.env.ACCOUNT_VAULT_KEY || process.env.CREDENTIAL_ENCRYPTION_KEY || 'dev-only-encryption-key';
  const key = crypto.scryptSync(passphrase, LEGACY_SALT, ENCRYPTION_KEY_BYTE_LENGTH);
  const iv = Buffer.from(parts[0], 'base64');
  const encrypted = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8'));
}

export class CredentialRepository {
  constructor(private db: DB) {}

  /**
   * Normalize platform naming variants (harvesterName/llmwikiName/sessionName)
   * to the canonical internal platform id, so 'toutiaohao' and 'toutiao'
   * converge on a single credential row.
   */
  private canonical(platform: string): string {
    return getCanonicalPlatformId(platform);
  }

  /**
   * Upsert a credential. If accountId is not provided, defaults to 'default'.
   */
  upsertCredential(platform: string, cred: PlatformCredentials, userId: string = 'user_default'): void {
    platform = this.canonical(platform);
    // Pre-write validation
    if (!platform || (typeof platform === 'string' && platform.trim().length === 0)) {
      throw new Error(
        `Validation failed: platform must be a non-empty string (received: ${JSON.stringify(platform)})`,
      );
    }

    const accountId = cred.accountId || 'default';
    const stmt = this.db.prepare(`
      INSERT INTO platform_credentials
        (user_id, platform, account_id, brand_id, account_name, credential_type,
         credential_data, status, last_validated_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, platform, account_id) DO UPDATE SET
        brand_id = excluded.brand_id,
        account_name = excluded.account_name,
        credential_type = excluded.credential_type,
        credential_data = excluded.credential_data,
        status = excluded.status,
        last_validated_at = excluded.last_validated_at,
        updated_at = excluded.updated_at
    `);
    const now = new Date().toISOString();
    // Encrypt credential data before storing (AES-256-GCM)
    stmt.run(
      userId,
      platform,
      accountId,
      cred.brandId ?? null,
      cred.accountName ?? null,
      cred.type,
      encryptJSON(cred.data),
      cred.status,
      cred.lastValidatedAt ?? null,
      now,
      now,
    );
  }

  /** Upsert a credential for a specific user (explicit userId). */
  upsertCredentialForUser(userId: string, platform: string, cred: PlatformCredentials): void {
    this.upsertCredential(platform, cred, userId);
  }

  /** Save a browser session's storageState (encrypted) for reuse. */
  saveBrowserSession(accountId: string, platform: string, storageState: string, fingerprintId?: string): void {
    platform = this.canonical(platform);
    const maxAge = parseInt(process.env.SESSION_MAX_AGE_HOURS || String(DEFAULT_SESSION_MAX_AGE_HOURS), 10) * 60 * 60 * 1000;
    this.db.prepare(`
      INSERT OR REPLACE INTO browser_sessions (account_id, platform, storage_state, user_data_dir, saved_at, valid, max_age, fingerprint_id)
      VALUES (?, ?, ?, '', ?, 1, ?, ?)
    `).run(accountId, platform, storageState, Date.now(), maxAge, fingerprintId || null);
  }

  /** Load a saved browser session for the given account + platform. */
  getBrowserSession(accountId: string, platform: string): { storageState: string; valid: boolean; savedAt: number; maxAge?: number } | null {
    platform = this.canonical(platform);
    try {
      const row = this.db.prepare('SELECT * FROM browser_sessions WHERE account_id = ? AND platform = ?').get(accountId, platform) as Record<string, unknown> | undefined;
      if (!row) return null;
      return {
        storageState: String(row.storage_state ?? ''),
        valid: Number(row.valid ?? 0) === 1,
        savedAt: Number(row.saved_at ?? 0),
        maxAge: row.max_age ? Number(row.max_age) : undefined,
      };
    } catch {
      return null;
    }
  }

  /**
   * Map a database row to PlatformCredentials.
   */
  private rowToCredential(row: Record<string, unknown>): PlatformCredentials {
    const raw = String(row.credential_data ?? '');
    let data: Record<string, string>;
    const ciphertext = raw.startsWith(ENCRYPTION_PREFIX)
      ? raw
      : raw.includes(':')
        ? ENCRYPTION_PREFIX + raw
        : '';
    if (!ciphertext) {
      data = { cookie: raw };
    } else {
      try {
        data = decryptJSON<Record<string, string>>(ciphertext);
      } catch (e1) {
        try {
          data = decryptWithLegacySalt(ciphertext);
        } catch (e2) {
          console.error(`[CredentialRepo] Decryption failed for ${row.platform}:${row.account_id}: salt1=${(e1 as Error)?.message}, salt2=${(e2 as Error)?.message}, key_set=${!!(process.env.CREDENTIAL_ENCRYPTION_KEY || process.env.ACCOUNT_VAULT_KEY)}`);
          data = { cookie: '' };
        }
      }
    }
    return {
      platform: String(row.platform) as PlatformCredentials['platform'],
      accountId: String(row.account_id ?? 'default'),
      brandId: row.brand_id ? Number(row.brand_id) : undefined,
      accountName: row.account_name ? String(row.account_name) : undefined,
      type: String(row.credential_type) as PlatformCredentials['type'],
      data,
      status: String(row.status) as PlatformCredentials['status'],
      lastValidatedAt: row.last_validated_at ? String(row.last_validated_at) : undefined,
    };
  }

  /**
   * Get a credential by platform and accountId.
   * If accountId is not provided, returns the 'default' account.
   */
  getCredential(platform: string, userId: string = 'user_default', accountId: string = 'default'): PlatformCredentials | undefined {
    platform = this.canonical(platform);
    const row = this.db
      .prepare('SELECT * FROM platform_credentials WHERE user_id = ? AND platform = ? AND account_id = ?')
      .get(userId, platform, accountId) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return this.rowToCredential(row);
  }

  updateCredentialStatus(platform: string, status: string, userId: string = 'user_default', accountId: string = 'default'): void {
    platform = this.canonical(platform);
    this.db
      .prepare('UPDATE platform_credentials SET status = ?, updated_at = ? WHERE user_id = ? AND platform = ? AND account_id = ?')
      .run(status, new Date().toISOString(), userId, platform, accountId);
  }

  deleteCredential(platform: string, userId: string = 'user_default', accountId: string = 'default'): void {
    platform = this.canonical(platform);
    this.db
      .prepare('DELETE FROM platform_credentials WHERE user_id = ? AND platform = ? AND account_id = ?')
      .run(userId, platform, accountId);
  }

  getAllCredentials(userId?: string): PlatformCredentials[] {
    const rows = userId
      ? this.db.prepare('SELECT * FROM platform_credentials WHERE user_id = ?').all(userId) as Record<string, unknown>[]
      : this.db.prepare('SELECT * FROM platform_credentials').all() as Record<string, unknown>[];
    return rows.map((row) => this.rowToCredential(row));
  }

  /** Get all credentials for a specific user. */
  getCredentialsByUser(userId: string): PlatformCredentials[] {
    return this.getAllCredentials(userId);
  }

  /** Get credentials filtered by brand ID. */
  getCredentialsByBrand(brandId: number, userId?: string): PlatformCredentials[] {
    const rows = userId
      ? this.db.prepare('SELECT * FROM platform_credentials WHERE user_id = ? AND brand_id = ?').all(userId, brandId) as Record<string, unknown>[]
      : this.db.prepare('SELECT * FROM platform_credentials WHERE brand_id = ?').all(brandId) as Record<string, unknown>[];
    return rows.map((row) => this.rowToCredential(row));
  }

  /** Get all credentials for a specific platform (all accounts). */
  getCredentialsByPlatform(platform: string, userId?: string): PlatformCredentials[] {
    platform = this.canonical(platform);
    const rows = userId
      ? this.db.prepare('SELECT * FROM platform_credentials WHERE user_id = ? AND platform = ?').all(userId, platform) as Record<string, unknown>[]
      : this.db.prepare('SELECT * FROM platform_credentials WHERE platform = ?').all(platform) as Record<string, unknown>[];
    return rows.map((row) => this.rowToCredential(row));
  }

  /**
   * Get credentials that are due for a health check.
   * Returns credentials where last_checked_at is null or older than check_interval_ms,
   * limited to batchSize, ordered by last_checked_at ASC (oldest first).
   */
  getCredentialsDueForCheck(batchSize: number = DEFAULT_HEALTH_CHECK_BATCH_SIZE, userId?: string): PlatformCredentials[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM platform_credentials
         WHERE status IN ('active', 'expired')
           AND (last_checked_at IS NULL OR last_checked_at < ?)
           ${userId ? 'AND user_id = ?' : ''}
         ORDER BY last_checked_at IS NULL DESC, last_checked_at ASC
         LIMIT ?`,
      )
      .all(
        Date.now() - DEFAULT_CREDENTIAL_CHECK_INTERVAL_MS,
        ...(userId ? [userId] : []),
        batchSize,
      ) as Record<string, unknown>[];
    return rows.map((row) => this.rowToCredential(row));
  }

  /** Record the result of a health check. */
  recordHealthCheck(
    platform: string,
    status: 'valid' | 'expired' | 'checking' | 'error',
    durationMs: number,
    errorMessage?: string,
    userId: string = 'user_default',
  ): void {
    platform = this.canonical(platform);
    const now = Date.now();

    // Insert log
    this.db.prepare(
      `INSERT INTO session_health_logs (platform, user_id, status, duration_ms, error_message, checked_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(platform, userId, status, durationMs, errorMessage ?? null, now);

    // Update credential status
    if (status === 'valid') {
      this.db.prepare(
        `UPDATE platform_credentials
         SET status = 'active',
             last_checked_at = ?,
             last_check_status = 'valid',
             consecutive_failures = 0,
             check_error = NULL,
             updated_at = ?
         WHERE user_id = ? AND platform = ?`,
      ).run(now, new Date().toISOString(), userId, platform);
    } else if (status === 'expired') {
      this.db.prepare(
        `UPDATE platform_credentials
         SET status = 'expired',
             last_checked_at = ?,
             last_check_status = 'expired',
             check_error = ?,
             updated_at = ?
         WHERE user_id = ? AND platform = ?`,
      ).run(now, errorMessage ?? null, new Date().toISOString(), userId, platform);
    } else {
      // checking or error - increment failures if error
      if (status === 'error') {
        this.db.prepare(
          `UPDATE platform_credentials
           SET last_checked_at = ?,
               last_check_status = 'checking',
               consecutive_failures = consecutive_failures + 1,
               check_error = ?,
               updated_at = ?
           WHERE user_id = ? AND platform = ?`,
        ).run(now, errorMessage ?? null, new Date().toISOString(), userId, platform);
      }
    }
  }

  /** Get credential health statistics for the monitor dashboard. */
  getCredentialHealthStats(): {
    total: number;
    valid: number;
    checking: number;
    expired: number;
    invalid: number;
    byPlatform: Array<{ platform: string; total: number; valid: number; expired: number; healthRate: number }>;
  } {
    const all = this.db
      .prepare('SELECT platform, status, last_check_status FROM platform_credentials')
      .all() as { platform: string; status: string; last_check_status: string }[];

    let valid = 0;
    let checking = 0;
    let expired = 0;
    let invalid = 0;

    const byPlatformMap = new Map<string, { total: number; valid: number; expired: number }>();

    for (const row of all) {
      const checkStatus = row.last_check_status || 'valid';
      const effectiveStatus = row.status === 'expired' ? 'expired'
        : row.status === 'invalid' ? 'invalid'
        : checkStatus;

      if (effectiveStatus === 'valid') valid++;
      else if (effectiveStatus === 'checking') checking++;
      else if (effectiveStatus === 'expired') expired++;
      else if (effectiveStatus === 'invalid') invalid++;

      const p = byPlatformMap.get(row.platform) || { total: 0, valid: 0, expired: 0 };
      p.total++;
      if (effectiveStatus === 'valid') p.valid++;
      if (effectiveStatus === 'expired') p.expired++;
      byPlatformMap.set(row.platform, p);
    }

    const byPlatform = Array.from(byPlatformMap.entries()).map(([platform, data]) => ({
      platform,
      total: data.total,
      valid: data.valid,
      expired: data.expired,
      healthRate: data.total > 0 ? Math.round((data.valid / data.total) * 1000) / 10 : 0,
    }));

    return {
      total: all.length,
      valid,
      checking,
      expired,
      invalid,
      byPlatform,
    };
  }

  /** Get detailed health info for a credential including consecutive failures. */
  getCredentialHealthDetail(platform: string, userId: string = 'user_default'): {
    platform: string;
    status: string;
    lastCheckStatus: string;
    consecutiveFailures: number;
    lastCheckedAt: number | null;
    checkError: string | null;
    lastValidatedAt: string | null;
  } | undefined {
    platform = this.canonical(platform);
    const row = this.db
      .prepare(
        'SELECT platform, status, last_check_status, consecutive_failures, last_checked_at, check_error, last_validated_at FROM platform_credentials WHERE user_id = ? AND platform = ?',
      )
      .get(userId, platform) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      platform: String(row.platform),
      status: String(row.status),
      lastCheckStatus: String(row.last_check_status ?? 'valid'),
      consecutiveFailures: Number(row.consecutive_failures ?? 0),
      lastCheckedAt: row.last_checked_at ? Number(row.last_checked_at) : null,
      checkError: row.check_error ? String(row.check_error) : null,
      lastValidatedAt: row.last_validated_at ? String(row.last_validated_at) : null,
    };
  }

  /** Get the consecutive failure count for a credential. */
  getConsecutiveFailures(platform: string, userId: string = 'user_default'): number {
    platform = this.canonical(platform);
    const row = this.db
      .prepare('SELECT consecutive_failures FROM platform_credentials WHERE user_id = ? AND platform = ?')
      .get(userId, platform) as { consecutive_failures: number } | undefined;
    return row ? Number(row.consecutive_failures ?? 0) : 0;
  }

  /** Explicitly mark a credential as expired with a reason. */
  markCredentialExpired(platform: string, reason: string, userId: string = 'user_default'): void {
    platform = this.canonical(platform);
    const now = Date.now();
    this.db
      .prepare(
        `UPDATE platform_credentials
         SET status = 'expired',
             last_checked_at = ?,
             last_check_status = 'expired',
             check_error = ?,
             updated_at = ?
         WHERE user_id = ? AND platform = ?`,
      )
      .run(now, reason, new Date().toISOString(), userId, platform);
  }

  /** Get recent health check logs, optionally filtered by platform. */
  getHealthLogs(limit: number = DEFAULT_HEALTH_LOGS_LIMIT, platform?: string, userId?: string): Array<{
    id: number;
    platform: string;
    userId: string;
    status: string;
    durationMs: number;
    errorMessage: string | null;
    checkedAt: number;
  }> {
    if (platform) platform = this.canonical(platform);
    const safeLimit = Math.max(1, Math.floor(limit));
    let sql = 'SELECT * FROM session_health_logs';
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (platform) {
      conditions.push('platform = ?');
      params.push(platform);
    }
    if (userId) {
      conditions.push('user_id = ?');
      params.push(userId);
    }
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY checked_at DESC LIMIT ?';
    params.push(safeLimit);
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: Number(r.id),
      platform: String(r.platform),
      userId: String(r.user_id),
      status: String(r.status),
      durationMs: Number(r.duration_ms),
      errorMessage: r.error_message ? String(r.error_message) : null,
      checkedAt: Number(r.checked_at),
    }));
  }

  /** Insert a health alert. */
  insertHealthAlert(
    platform: string,
    alertType: string,
    message: string,
    userId: string = 'user_default',
  ): number {
    const result = this.db
      .prepare(
        'INSERT INTO health_alerts (platform, user_id, alert_type, message, sent, created_at) VALUES (?, ?, ?, ?, 0, ?)',
      )
      .run(platform, userId, alertType, message, new Date().toISOString());
    return Number(result.lastInsertRowid);
  }

  /** Get unsent alerts. */
  getUnsentAlerts(): Array<{
    id: number;
    platform: string;
    userId: string;
    alertType: string;
    message: string;
    createdAt: string;
  }> {
    const rows = this.db
      .prepare('SELECT * FROM health_alerts WHERE sent = 0 ORDER BY created_at ASC')
      .all() as Record<string, unknown>[];
    return rows.map((r) => ({
      id: Number(r.id),
      platform: String(r.platform),
      userId: String(r.user_id),
      alertType: String(r.alert_type),
      message: String(r.message),
      createdAt: String(r.created_at),
    }));
  }

  /** Mark an alert as sent. */
  markAlertSent(alertId: number): void {
    this.db
      .prepare('UPDATE health_alerts SET sent = 1, sent_at = ? WHERE id = ?')
      .run(new Date().toISOString(), alertId);
  }

  /** Get alert statistics. */
  getAlertStats(): { total: number; unsent: number; sent: number } {
    const row = this.db
      .prepare('SELECT COUNT(*) as total, SUM(CASE WHEN sent = 0 THEN 1 ELSE 0 END) as unsent FROM health_alerts')
      .get() as { total: number; unsent: number };
    return {
      total: Number(row.total ?? 0),
      unsent: Number(row.unsent ?? 0),
      sent: Number(row.total ?? 0) - Number(row.unsent ?? 0),
    };
  }

  // === Relogin Tracking ===

  /** Record a relogin attempt result. */
  recordReloginAttempt(
    platform: string,
    userId: string,
    success: boolean,
    errorType?: string,
    errorMessage?: string,
    cookieCount?: number,
  ): void {
    platform = this.canonical(platform);
    this.db.prepare(
      `INSERT INTO relogin_logs (platform, user_id, success, error_type, error_message, cookie_count, attempted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      platform, userId, success ? 1 : 0,
      errorType ?? null, errorMessage ?? null, cookieCount ?? null,
      Date.now(),
    );
  }

  /** Get recent relogin attempts. */
  getReloginLogs(limit: number = DEFAULT_RELOGIN_LOGS_LIMIT, platform?: string): Array<{
    id: number;
    platform: string;
    userId: string;
    success: boolean;
    errorType: string | null;
    errorMessage: string | null;
    cookieCount: number | null;
    attemptedAt: number;
  }> {
    if (platform) platform = this.canonical(platform);
    const safeLimit = Math.max(1, Math.floor(limit));
    let sql = 'SELECT * FROM relogin_logs';
    const params: unknown[] = [];
    if (platform) {
      sql += ' WHERE platform = ?';
      params.push(platform);
    }
    sql += ' ORDER BY attempted_at DESC LIMIT ?';
    params.push(safeLimit);
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: Number(r.id),
      platform: String(r.platform),
      userId: String(r.user_id),
      success: Number(r.success) === 1,
      errorType: r.error_type ? String(r.error_type) : null,
      errorMessage: r.error_message ? String(r.error_message) : null,
      cookieCount: r.cookie_count != null ? Number(r.cookie_count) : null,
      attemptedAt: Number(r.attempted_at),
    }));
  }

  /** Get relogin statistics. */
  getReloginStats(): {
    total: number;
    successful: number;
    failed: number;
    byPlatform: Array<{ platform: string; total: number; success: number; failed: number; successRate: number }>;
  } {
    const rows = this.db
      .prepare('SELECT platform, success, COUNT(*) as count FROM relogin_logs GROUP BY platform, success')
      .all() as { platform: string; success: number; count: number }[];

    const byPlatformMap = new Map<string, { total: number; success: number; failed: number }>();
    let total = 0, successful = 0, failed = 0;

    for (const row of rows) {
      const p = byPlatformMap.get(row.platform) || { total: 0, success: 0, failed: 0 };
      p.total += row.count;
      total += row.count;
      if (row.success === 1) {
        p.success += row.count;
        successful += row.count;
      } else {
        p.failed += row.count;
        failed += row.count;
      }
      byPlatformMap.set(row.platform, p);
    }

    const byPlatform = Array.from(byPlatformMap.entries()).map(([platform, stats]) => ({
      platform,
      total: stats.total,
      success: stats.success,
      failed: stats.failed,
      successRate: stats.total > 0 ? (stats.success / stats.total) * 100 : 0,
    }));

    return { total, successful, failed, byPlatform };
  }

  // === Dynamic Account Pool ===

  /** Get all credentials for a platform across all accounts (for dynamic account allocation). */
  getAllCredentialsForPlatform(platform: string, userId?: string): PlatformCredentials[] {
    platform = this.canonical(platform);
    const rows = userId
      ? this.db.prepare('SELECT * FROM platform_credentials WHERE platform = ? AND user_id = ?').all(platform, userId) as Record<string, unknown>[]
      : this.db.prepare('SELECT * FROM platform_credentials WHERE platform = ?').all(platform) as Record<string, unknown>[];
    return rows.map((row) => this.rowToCredential(row));
  }

  /** Get all active credentials for a platform (for dynamic account allocation). */
  getActiveCredentialsForPlatform(platform: string, userId?: string): PlatformCredentials[] {
    platform = this.canonical(platform);
    const rows = userId
      ? this.db.prepare("SELECT * FROM platform_credentials WHERE platform = ? AND user_id = ? AND status = 'active'").all(platform, userId) as Record<string, unknown>[]
      : this.db.prepare("SELECT * FROM platform_credentials WHERE platform = ? AND status = 'active'").all(platform) as Record<string, unknown>[];
    return rows.map((row) => this.rowToCredential(row));
  }

  /** Get active credentials for a platform filtered by brand ID. */
  getActiveCredentialsForPlatformAndBrand(platform: string, brandId: number, userId?: string): PlatformCredentials[] {
    platform = this.canonical(platform);
    const rows = userId
      ? this.db.prepare("SELECT * FROM platform_credentials WHERE platform = ? AND user_id = ? AND brand_id = ? AND status = 'active'").all(platform, userId, brandId) as Record<string, unknown>[]
      : this.db.prepare("SELECT * FROM platform_credentials WHERE platform = ? AND brand_id = ? AND status = 'active'").all(platform, brandId) as Record<string, unknown>[];
    return rows.map((row) => this.rowToCredential(row));
  }

  /** Update credential data (e.g., after successful relogin with new cookies). */
  updateCredentialData(
    platform: string,
    data: Record<string, string>,
    userId: string = 'user_default',
    accountId: string = 'default',
  ): void {
    platform = this.canonical(platform);
    const encrypted = encryptJSON(data);
    this.db
      .prepare(
        `UPDATE platform_credentials
         SET credential_data = ?, status = 'active', last_validated_at = ?, updated_at = ?
         WHERE user_id = ? AND platform = ? AND account_id = ?`,
      )
      .run(encrypted, new Date().toISOString(), new Date().toISOString(), userId, platform, accountId);
  }

  /** Invalidate a browser session (mark as invalid so next acquire creates fresh context). */
  invalidateBrowserSession(accountId: string, platform: string): void {
    platform = this.canonical(platform);
    this.db
      .prepare('UPDATE browser_sessions SET valid = 0 WHERE account_id = ? AND platform = ?')
      .run(accountId, platform);
  }
}
