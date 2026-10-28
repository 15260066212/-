import type { DB } from '../db.js';

/** Default score for review dimensions (originality, readability, etc.) */
export const DEFAULT_REVIEW_DIMENSION_SCORE = 100;

// ---------------------------------------------------------------------------
// Reviews & review audit log
// ---------------------------------------------------------------------------
export function initReviewTables(db: DB, currentVersion: number): void {
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
      originality_score REAL NOT NULL DEFAULT ${DEFAULT_REVIEW_DIMENSION_SCORE},
      platform_adaptation_score REAL NOT NULL DEFAULT ${DEFAULT_REVIEW_DIMENSION_SCORE},
      readability_score REAL NOT NULL DEFAULT ${DEFAULT_REVIEW_DIMENSION_SCORE},
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
        db.exec(`ALTER TABLE reviews ADD COLUMN ${col} REAL NOT NULL DEFAULT ${DEFAULT_REVIEW_DIMENSION_SCORE}`);
      } catch (err) {
        console.debug(`[DB] Migration v1: ${col} column already exists, skipping`, { error: err instanceof Error ? err.message : String(err) });
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
    try { db.exec(`ALTER TABLE reviews ADD COLUMN safety_score REAL NOT NULL DEFAULT ${DEFAULT_REVIEW_DIMENSION_SCORE}`); } catch (err) {
      console.debug('[DB] Migration v13: safety_score column already exists, skipping', { error: err instanceof Error ? err.message : String(err) });
    }
    try { db.exec('ALTER TABLE reviews ADD COLUMN content_hash TEXT'); } catch (err) {
      console.debug('[DB] Migration v13: content_hash column already exists, skipping', { error: err instanceof Error ? err.message : String(err) });
    }

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

  // Migration v15: truthfulness dimension (文章真实性审核 — 校验 LLM 自由生成内容是否有知识库依据)
  if (currentVersion < 15) {
    try { db.exec(`ALTER TABLE reviews ADD COLUMN truthfulness_score REAL NOT NULL DEFAULT ${DEFAULT_REVIEW_DIMENSION_SCORE}`); } catch (err) {
      console.debug('[DB] Migration v15: truthfulness_score column already exists, skipping', { error: err instanceof Error ? err.message : String(err) });
    }
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
      15, new Date().toISOString(),
    );
    console.log('[DB] Migration v15 applied: truthfulness dimension');
  }
}
