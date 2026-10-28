import type { DB } from '../db.js';

// ---------------------------------------------------------------------------
// Monitoring: health logs, alerts, relogin, selector health, captcha
// ---------------------------------------------------------------------------
export function initMonitorTables(db: DB, currentVersion: number): void {
  // Migration v7 (partial): create session_health_logs table
  if (currentVersion < 7) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS session_health_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL,
        user_id TEXT NOT NULL DEFAULT 'user_default',
        status TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        error_message TEXT,
        checked_at INTEGER NOT NULL
      )
    `);

    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
      7, new Date().toISOString(),
    );
    console.log('[DB] Migration v7 applied: session health monitoring');
  }

  // Migration v8: health alerts table
  if (currentVersion < 8) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS health_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL,
        user_id TEXT NOT NULL DEFAULT 'user_default',
        alert_type TEXT NOT NULL,
        message TEXT NOT NULL,
        sent INTEGER DEFAULT 0,
        sent_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_health_alerts_sent ON health_alerts(sent);
      CREATE INDEX IF NOT EXISTS idx_health_alerts_platform ON health_alerts(platform);
    `);
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
      8, new Date().toISOString(),
    );
    console.log('[DB] Migration v8 applied: health alerts table');
  }

  // Migration v9: relogin tracking
  if (currentVersion < 9) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS relogin_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL,
        user_id TEXT NOT NULL DEFAULT 'user_default',
        success INTEGER NOT NULL,
        error_type TEXT,
        error_message TEXT,
        cookie_count INTEGER,
        screenshot TEXT,
        attempted_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_relogin_logs_platform ON relogin_logs(platform);
      CREATE INDEX IF NOT EXISTS idx_relogin_logs_attempted ON relogin_logs(attempted_at);
    `);
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
      9, new Date().toISOString(),
    );
    console.log('[DB] Migration v9 applied: relogin tracking table');
  }

  // Migration v10: selector health monitoring
  if (currentVersion < 10) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS selector_health_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL,
        url TEXT NOT NULL,
        total_selectors INTEGER NOT NULL,
        found_selectors INTEGER NOT NULL,
        missing_selectors INTEGER NOT NULL,
        broken_purposes TEXT,
        results_json TEXT,
        triggered_by TEXT DEFAULT 'scheduled',
        checked_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_selector_health_platform ON selector_health_logs(platform);
      CREATE INDEX IF NOT EXISTS idx_selector_health_checked ON selector_health_logs(checked_at);
    `);
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
      10, new Date().toISOString(),
    );
    console.log('[DB] Migration v10 applied: selector health monitoring table');
  }

  // Migration v11: captcha event tracking
  if (currentVersion < 11) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS captcha_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL,
        task_id TEXT,
        user_id TEXT DEFAULT 'user_default',
        captcha_type TEXT NOT NULL,
        captcha_source TEXT NOT NULL DEFAULT 'publish',
        status TEXT NOT NULL DEFAULT 'pending',
        page_url TEXT,
        screenshot TEXT,
        resolved_by TEXT,
        resolved_at INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_captcha_platform ON captcha_events(platform);
      CREATE INDEX IF NOT EXISTS idx_captcha_status ON captcha_events(status);
      CREATE INDEX IF NOT EXISTS idx_captcha_created ON captcha_events(created_at);
    `);
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
      11, new Date().toISOString(),
    );
    console.log('[DB] Migration v11 applied: captcha event tracking table');
  }
}
