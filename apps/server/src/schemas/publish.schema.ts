import type { DB } from '../db.js';

/** Default maximum retry count for publish tasks */
export const DEFAULT_MAX_PUBLISH_RETRIES = 2;

// ---------------------------------------------------------------------------
// Publish tasks & publish logs
// ---------------------------------------------------------------------------
export function initPublishTables(db: DB, currentVersion: number): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS publish_tasks (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      method TEXT NOT NULL,
      platform_post_id TEXT,
      platform_post_url TEXT,
      error_message TEXT,
      verification_status TEXT,
      verification_message TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT ${DEFAULT_MAX_PUBLISH_RETRIES},
      scheduled_at TEXT,
      published_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      failure_type TEXT,
      user_id TEXT DEFAULT 'user_default'
    );

    CREATE TABLE IF NOT EXISTS publish_logs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_publish_tasks_article ON publish_tasks(article_id);
    CREATE INDEX IF NOT EXISTS idx_publish_tasks_status ON publish_tasks(status);
  `);

  // Migration v3: add verification columns to publish_tasks table
  if (currentVersion < 3) {
    const verificationColumns = [
      'verification_status',
      'verification_message',
    ];
    for (const col of verificationColumns) {
      try {
        db.exec(`ALTER TABLE publish_tasks ADD COLUMN ${col} TEXT`);
      } catch {
        // Column already exists, ignore
      }
    }
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
      3, new Date().toISOString(),
    );
    console.log('[DB] Migration v3 applied: added verification columns to publish_tasks');
  }

  // Migration v5: add failure_type column to publish_tasks for failure analysis
  if (currentVersion < 5) {
    try {
      db.exec('ALTER TABLE publish_tasks ADD COLUMN failure_type TEXT');
    } catch {
      // Column already exists, ignore
    }
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
      5, new Date().toISOString(),
    );
    console.log('[DB] Migration v5 applied: added failure_type column to publish_tasks');
  }

  // Migration v6: add user_id column to publish_tasks for per-user credential lookup
  if (currentVersion < 6) {
    try {
      db.exec('ALTER TABLE publish_tasks ADD COLUMN user_id TEXT');
      db.exec("UPDATE publish_tasks SET user_id = 'user_default' WHERE user_id IS NULL");
    } catch {
      // Column already exists, ignore
    }
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
      6, new Date().toISOString(),
    );
    console.log('[DB] Migration v6 applied: added user_id column to publish_tasks');
  }

  // Migration v12: publish task priority and platform cooldown
  if (currentVersion < 12) {
    db.exec(`
      ALTER TABLE publish_tasks ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE publish_tasks ADD COLUMN cooldown_until TEXT;
      CREATE INDEX IF NOT EXISTS idx_publish_tasks_priority ON publish_tasks(priority);
    `);
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
      12, new Date().toISOString(),
    );
    console.log('[DB] Migration v12 applied: publish task priority and cooldown fields');
  }

  // Migration v14 (partial): add account_id to publish_tasks
  if (currentVersion < 14) {
    try {
      db.exec('ALTER TABLE publish_tasks ADD COLUMN account_id TEXT DEFAULT "default"');
    } catch {
      // Column may already exist
    }
  }
}
