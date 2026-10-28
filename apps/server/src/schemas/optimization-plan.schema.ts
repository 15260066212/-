import type { DB } from '../db.js';

// ---------------------------------------------------------------------------
// Optimization plans & scheduled plan tasks
// ---------------------------------------------------------------------------
export function initPlanTables(db: DB): void {
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
