import type { DB } from '../db.js';

// ---------------------------------------------------------------------------
// Sessions & browser sessions
// ---------------------------------------------------------------------------
export function initSessionsTable(db: DB, currentVersion: number): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      current_stage TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS browser_sessions (
      account_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      storage_state TEXT,
      user_data_dir TEXT,
      saved_at INTEGER NOT NULL,
      valid INTEGER DEFAULT 1,
      max_age INTEGER,
      fingerprint_id TEXT,
      PRIMARY KEY(account_id, platform)
    );
  `);

  // Migration v4 (partial): add user_id column to sessions + backfill
  if (currentVersion < 4) {
    try {
      db.exec('ALTER TABLE sessions ADD COLUMN user_id TEXT');
    } catch {
      // Column already exists, ignore
    }
    db.exec("UPDATE sessions SET user_id = 'user_default' WHERE user_id IS NULL");
  }
}
