import type { DB } from '../db.js';

// ---------------------------------------------------------------------------
// Pipeline runs
// ---------------------------------------------------------------------------
export function initPipelineTables(db: DB, currentVersion: number): void {
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
