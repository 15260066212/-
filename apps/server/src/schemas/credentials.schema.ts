import type { DB } from '../db.js';

/** Default credential health check interval (6 hours in milliseconds) */
export const DEFAULT_CREDENTIAL_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Platform credentials
// ---------------------------------------------------------------------------
export function initCredentialsTable(db: DB, currentVersion: number): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_credentials (
      platform TEXT PRIMARY KEY,
      credential_type TEXT NOT NULL,
      credential_data TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      last_validated_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Migration v4 (partial): recreate platform_credentials with composite PK (user_id, platform)
  if (currentVersion < 4) {
    const credColumns = db.prepare('PRAGMA table_info(platform_credentials)').all() as { name: string }[];
    const hasUserIdCol = credColumns.some((c) => c.name === 'user_id');

    if (!hasUserIdCol) {
      db.exec(`
        CREATE TABLE platform_credentials_v4 (
          user_id TEXT NOT NULL DEFAULT 'user_default',
          platform TEXT NOT NULL,
          credential_type TEXT NOT NULL,
          credential_data TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          last_validated_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (user_id, platform)
        );

        INSERT INTO platform_credentials_v4 (user_id, platform, credential_type, credential_data, status, last_validated_at, created_at, updated_at)
        SELECT 'user_default', platform, credential_type, credential_data, status, last_validated_at, created_at, updated_at
        FROM platform_credentials;

        DROP TABLE platform_credentials;
        ALTER TABLE platform_credentials_v4 RENAME TO platform_credentials;
      `);
    }
  }

  // Migration v7 (partial): add health check columns to platform_credentials
  if (currentVersion < 7) {
    const credCols = db.prepare('PRAGMA table_info(platform_credentials)').all() as { name: string }[];
    const hasLastCheckedAt = credCols.some((c) => c.name === 'last_checked_at');
    if (!hasLastCheckedAt) {
      db.exec(`
        ALTER TABLE platform_credentials ADD COLUMN last_checked_at INTEGER;
        ALTER TABLE platform_credentials ADD COLUMN last_check_status TEXT DEFAULT 'valid';
        ALTER TABLE platform_credentials ADD COLUMN consecutive_failures INTEGER DEFAULT 0;
        ALTER TABLE platform_credentials ADD COLUMN check_error TEXT;
        ALTER TABLE platform_credentials ADD COLUMN check_interval_ms INTEGER DEFAULT ${DEFAULT_CREDENTIAL_CHECK_INTERVAL_MS};
      `);
    }
  }

  // Migration v14: multi-account support (account_id, brand_id, account_name)
  if (currentVersion < 14) {
    // Rebuild platform_credentials with account_id in the primary key
    const credCols = db.prepare('PRAGMA table_info(platform_credentials)').all() as { name: string }[];
    const hasAccountId = credCols.some((c) => c.name === 'account_id');

    if (!hasAccountId) {
      db.exec(`
        CREATE TABLE platform_credentials_v14 (
          user_id TEXT NOT NULL DEFAULT 'user_default',
          platform TEXT NOT NULL,
          account_id TEXT NOT NULL DEFAULT 'default',
          brand_id INTEGER,
          account_name TEXT,
          credential_type TEXT NOT NULL,
          credential_data TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          last_validated_at TEXT,
          last_checked_at INTEGER,
          last_check_status TEXT DEFAULT 'valid',
          consecutive_failures INTEGER DEFAULT 0,
          check_error TEXT,
          check_interval_ms INTEGER DEFAULT ${DEFAULT_CREDENTIAL_CHECK_INTERVAL_MS},
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (user_id, platform, account_id)
        );

        INSERT INTO platform_credentials_v14
          (user_id, platform, account_id, credential_type, credential_data, status,
           last_validated_at, last_checked_at, last_check_status, consecutive_failures,
           check_error, check_interval_ms, created_at, updated_at)
        SELECT user_id, platform, 'default', credential_type, credential_data, status,
               last_validated_at, last_checked_at, last_check_status, consecutive_failures,
               check_error, check_interval_ms, created_at, updated_at
        FROM platform_credentials;

        DROP TABLE platform_credentials;
        ALTER TABLE platform_credentials_v14 RENAME TO platform_credentials;

        CREATE INDEX IF NOT EXISTS idx_cred_platform ON platform_credentials(platform);
        CREATE INDEX IF NOT EXISTS idx_cred_brand ON platform_credentials(brand_id);
        CREATE INDEX IF NOT EXISTS idx_cred_status ON platform_credentials(status);
      `);
    }

    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
      14, new Date().toISOString(),
    );
    console.log('[DB] Migration v14 applied: multi-account support (account_id, brand_id)');
  }
}
