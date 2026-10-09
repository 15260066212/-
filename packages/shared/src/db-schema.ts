/**
 * Shared database schema initialization for sessions and fingerprints tables.
 *
 * Both `account-vault` and `session-pool` need the same `sessions` and
 * `fingerprints` table structures. This module centralizes the DDL so the
 * two packages never drift apart.
 */

/**
 * Minimal database interface for schema initialization.
 * Structurally compatible with better-sqlite3's `Database` (which exposes
 * `exec(sql: string): void`), so callers can pass their `Database.Database`
 * instance without the shared package needing a better-sqlite3 dependency.
 */
export interface SchemaDatabase {
  exec(sql: string): void;
}

/** SQL for the sessions table — stores per-account browser storage states. */
const SESSIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS sessions (
    account_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    storage_state TEXT,
    user_data_dir TEXT,
    proxy_host TEXT,
    proxy_port INTEGER,
    saved_at INTEGER NOT NULL,
    valid INTEGER DEFAULT 1,
    max_age INTEGER,
    fingerprint_id TEXT,
    PRIMARY KEY(account_id, platform)
  );
`;

/** SQL for the fingerprints table — stores browser fingerprint configs. */
const FINGERPRINTS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS fingerprints (
    fingerprint_id TEXT PRIMARY KEY,
    user_agent TEXT NOT NULL,
    viewport_width INTEGER NOT NULL,
    viewport_height INTEGER NOT NULL,
    timezone TEXT NOT NULL,
    locale TEXT NOT NULL,
    platform_hardware TEXT NOT NULL,
    webgl_vendor TEXT NOT NULL,
    webgl_renderer TEXT NOT NULL,
    canvas_noise REAL NOT NULL,
    hardware_concurrency INTEGER NOT NULL,
    device_memory INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    bound_account_id TEXT
  );
`;

/**
 * Initialize the shared `sessions` and `fingerprints` tables.
 *
 * Safe to call multiple times (uses `CREATE TABLE IF NOT EXISTS`).
 * Also runs idempotent column migrations for the `sessions` table
 * (`max_age`, `fingerprint_id`) — the `ALTER TABLE` errors are swallowed
 * when the column already exists.
 */
export function initSessionTables(db: SchemaDatabase): void {
  db.exec(SESSIONS_TABLE_SQL);
  db.exec(FINGERPRINTS_TABLE_SQL);

  // Migrations: add columns if they don't exist (errors swallowed when already present)
  try { db.exec('ALTER TABLE sessions ADD COLUMN max_age INTEGER'); } catch {}
  try { db.exec('ALTER TABLE sessions ADD COLUMN fingerprint_id TEXT'); } catch {}
}
