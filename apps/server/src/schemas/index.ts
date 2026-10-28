import type { DB } from '../db.js';

export { initSessionsTable } from './sessions.schema.js';
export { initArticlesTable } from './articles.schema.js';
export { initReviewTables, DEFAULT_REVIEW_DIMENSION_SCORE } from './reviews.schema.js';
export { initPublishTables, DEFAULT_MAX_PUBLISH_RETRIES } from './publish.schema.js';
export { initCredentialsTable, DEFAULT_CREDENTIAL_CHECK_INTERVAL_MS } from './credentials.schema.js';
export { initPipelineTables } from './pipeline.schema.js';
export { initMonitorTables } from './competitor-monitor.schema.js';
export { initUserTables } from './auth.schema.js';
export { initPlanTables } from './optimization-plan.schema.js';

import { initSessionsTable } from './sessions.schema.js';
import { initArticlesTable } from './articles.schema.js';
import { initReviewTables } from './reviews.schema.js';
import { initPublishTables } from './publish.schema.js';
import { initCredentialsTable } from './credentials.schema.js';
import { initPipelineTables } from './pipeline.schema.js';
import { initMonitorTables } from './competitor-monitor.schema.js';
import { initUserTables } from './auth.schema.js';
import { initPlanTables } from './optimization-plan.schema.js';

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
