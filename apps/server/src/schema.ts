import { createHash } from 'node:crypto';
import type { DB } from './db.js';

export function initDatabase(db: DB): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // === Schema migration system ===
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const currentVersion = (
    db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number | null }
  ).v ?? 0;

  initSessionsTable(db, currentVersion);
  initArticlesTable(db);
  initReviewTables(db, currentVersion);
  initPublishTables(db, currentVersion);
  initCredentialsTable(db, currentVersion);
  initPipelineTables(db, currentVersion);
  initMonitorTables(db, currentVersion);
  initUserTables(db, currentVersion);
  initPlanTables(db);
}

// ---------------------------------------------------------------------------
// Sessions & browser sessions
// ---------------------------------------------------------------------------
function initSessionsTable(db: DB, currentVersion: number): void {
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

// ---------------------------------------------------------------------------
// Articles
// ---------------------------------------------------------------------------
function initArticlesTable(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS articles (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      content_type TEXT NOT NULL,
      title TEXT NOT NULL,
      content_markdown TEXT NOT NULL,
      content_html TEXT,
      content_plain TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      summary TEXT,
      cover_image_desc TEXT,
      word_count INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      generation_round INTEGER NOT NULL DEFAULT 1,
      generation_meta TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_articles_session ON articles(session_id);
    CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
  `);

  // Migration v17: add review_round column to articles
  const row17 = db.prepare('SELECT version FROM schema_version WHERE version = ?').get(17);
  if (!row17) {
    try {
      db.exec(`ALTER TABLE articles ADD COLUMN review_round INTEGER NOT NULL DEFAULT 0`);
    } catch (e) {
      // Column may already exist
    }
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
      17, new Date().toISOString(),
    );
    console.log('[DB] Migration v17 applied: review_round on articles');
  }

  // Migration v18: add publish_url column to articles
  const row18 = db.prepare('SELECT version FROM schema_version WHERE version = ?').get(18);
  if (!row18) {
    try {
      db.exec(`ALTER TABLE articles ADD COLUMN publish_url TEXT`);
    } catch (e) {
      // Column may already exist
    }
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
      18, new Date().toISOString(),
    );
    console.log('[DB] Migration v18 applied: publish_url on articles');
  }
}

// ---------------------------------------------------------------------------
// Reviews & review audit log
// ---------------------------------------------------------------------------
function initReviewTables(db: DB, currentVersion: number): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL,
      round INTEGER NOT NULL,
      passed INTEGER NOT NULL,
      overall_score REAL NOT NULL,
      compliance_score REAL NOT NULL,
      quality_score REAL NOT NULL,
      seo_score REAL NOT NULL,
      brand_score REAL NOT NULL,
      originality_score REAL NOT NULL DEFAULT 100,
      platform_adaptation_score REAL NOT NULL DEFAULT 100,
      readability_score REAL NOT NULL DEFAULT 100,
      issues TEXT NOT NULL DEFAULT '[]',
      suggestions TEXT NOT NULL DEFAULT '[]',
      reviewed_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_reviews_article ON reviews(article_id);
  `);

  // Migration v1: add new review dimension columns
  if (currentVersion < 1) {
    const newColumns = [
      'originality_score',
      'platform_adaptation_score',
      'readability_score',
    ];
    for (const col of newColumns) {
      try {
        db.exec(`ALTER TABLE reviews ADD COLUMN ${col} REAL NOT NULL DEFAULT 100`);
      } catch {
        // Column already exists, ignore
      }
    }
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
      1, new Date().toISOString(),
    );
    console.log('[DB] Migration v1 applied: added review dimension columns');
  }

  // Migration v13: review audit trail, content hash, and safety dimension
  if (currentVersion < 13) {
    // Add safety_score and content_hash columns to reviews
    try { db.exec('ALTER TABLE reviews ADD COLUMN safety_score REAL NOT NULL DEFAULT 100'); } catch {}
    try { db.exec('ALTER TABLE reviews ADD COLUMN content_hash TEXT'); } catch {}

    // Create review audit log table
    db.exec(`
      CREATE TABLE IF NOT EXISTS review_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        review_id TEXT NOT NULL,
        article_id TEXT NOT NULL,
        action TEXT NOT NULL,
        actor TEXT DEFAULT 'system',
        details TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_review ON review_audit_log(review_id);
      CREATE INDEX IF NOT EXISTS idx_audit_article ON review_audit_log(article_id);
      CREATE INDEX IF NOT EXISTS idx_audit_created ON review_audit_log(created_at);
    `);

    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
      13, new Date().toISOString(),
    );
    console.log('[DB] Migration v13 applied: review audit trail, content hash, and safety dimension');
  }
}

// ---------------------------------------------------------------------------
// Publish tasks & publish logs
// ---------------------------------------------------------------------------
function initPublishTables(db: DB, currentVersion: number): void {
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
      max_retries INTEGER NOT NULL DEFAULT 2,
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

// ---------------------------------------------------------------------------
// Platform credentials
// ---------------------------------------------------------------------------
function initCredentialsTable(db: DB, currentVersion: number): void {
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
        ALTER TABLE platform_credentials ADD COLUMN check_interval_ms INTEGER DEFAULT ${6 * 60 * 60 * 1000};
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
          check_interval_ms INTEGER DEFAULT 21600000,
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

// ---------------------------------------------------------------------------
// Pipeline runs
// ---------------------------------------------------------------------------
function initPipelineTables(db: DB, currentVersion: number): void {
  // Migration v2: add pipeline_runs table for tracking pipeline executions
  if (currentVersion < 2) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS pipeline_runs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        total_articles INTEGER NOT NULL DEFAULT 0,
        completed_articles INTEGER NOT NULL DEFAULT 0,
        current_platform TEXT,
        current_round INTEGER,
        error_message TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT
      );
    `);
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
      2, new Date().toISOString(),
    );
    console.log('[DB] Migration v2 applied: added pipeline_runs table');
  }
}

// ---------------------------------------------------------------------------
// Monitoring: health logs, alerts, relogin, selector health, captcha
// ---------------------------------------------------------------------------
function initMonitorTables(db: DB, currentVersion: number): void {
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

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
function initUserTables(db: DB, currentVersion: number): void {
  // Migration v4 (partial): multi-user support - users table + default admin
  if (currentVersion < 4) {
    // Create users table
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        api_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        last_active_at TEXT
      );
    `);

    // Create default admin user with secure random API key
    const defaultUser = db.prepare('SELECT id FROM users WHERE id = ?').get('user_default');
    if (!defaultUser) {
      // Use env var if provided, otherwise generate a secure random key
      const defaultApiKey = process.env.DEFAULT_ADMIN_API_KEY
        ?? `geo-${Date.now()}-${crypto.randomUUID().replace(/-/g, '')}`;
      db.prepare(
        'INSERT INTO users (id, username, display_name, role, api_key, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run('user_default', 'hsq', 'Administrator', 'admin', defaultApiKey, new Date().toISOString());
      console.log(`[DB] Default admin user created with API key: ${defaultApiKey.slice(0, 8)}... (set DEFAULT_ADMIN_API_KEY to customize)`);
    }

    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
      4, new Date().toISOString(),
    );
    console.log('[DB] Migration v4 applied: added multi-user support');
  }

  // Migration v15: password_hash column on users for username/password login
  const row15 = db.prepare('SELECT version FROM schema_version WHERE version = ?').get(15);
  if (!row15) {
    // Add password_hash column (SQLite ADD COLUMN is safe if not exists)
    try {
      db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT');
    } catch {
      // Column may already exist
    }

    // Set default admin password hash (XTGEO123)
    const hash = createHash('sha256').update('XTGEO123').digest('hex');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, 'user_default');
    // Ensure all users without a password get the default too
    db.prepare('UPDATE users SET password_hash = ? WHERE password_hash IS NULL').run(hash);

    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
      15, new Date().toISOString(),
    );
    console.log('[DB] Migration v15 applied: password_hash on users');
  }
}

// ---------------------------------------------------------------------------
// Optimization plans & scheduled plan tasks
// ---------------------------------------------------------------------------
function initPlanTables(db: DB): void {
  // Migration v16: optimization plans persistence + scheduled plan tasks
  const row16 = db.prepare('SELECT version FROM schema_version WHERE version = ?').get(16);
  if (!row16) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS optimization_plans (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        enterprise_name TEXT NOT NULL,
        duration TEXT NOT NULL,
        platforms TEXT NOT NULL,
        content_types TEXT NOT NULL,
        html_content TEXT NOT NULL,
        plan_articles TEXT NOT NULL,
        auto_publish INTEGER DEFAULT 0,
        content_supplement TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_plans_session ON optimization_plans(session_id);

      CREATE TABLE IF NOT EXISTS scheduled_plan_tasks (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        enterprise_name TEXT NOT NULL,
        scheduled_date TEXT NOT NULL,
        platform TEXT NOT NULL,
        content_type TEXT NOT NULL,
        topic TEXT NOT NULL,
        keyword TEXT,
        week INTEGER DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'pending',
        article_id TEXT,
        run_id TEXT,
        content_supplement TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        executed_at TEXT,
        FOREIGN KEY (plan_id) REFERENCES optimization_plans(id)
      );
      CREATE INDEX IF NOT EXISTS idx_spt_plan ON scheduled_plan_tasks(plan_id);
      CREATE INDEX IF NOT EXISTS idx_spt_date ON scheduled_plan_tasks(scheduled_date);
      CREATE INDEX IF NOT EXISTS idx_spt_status ON scheduled_plan_tasks(status);
    `);
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
      16, new Date().toISOString(),
    );
    console.log('[DB] Migration v16 applied: optimization_plans + scheduled_plan_tasks');
  }
}
