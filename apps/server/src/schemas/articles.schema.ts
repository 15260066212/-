import type { DB } from '../db.js';

// ---------------------------------------------------------------------------
// Articles
// ---------------------------------------------------------------------------
export function initArticlesTable(db: DB): void {
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
      console.debug('[DB] Migration v17: review_round column already exists, skipping', { error: e instanceof Error ? e.message : String(e) });
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
      console.debug('[DB] Migration v18: publish_url column already exists, skipping', { error: e instanceof Error ? e.message : String(e) });
    }
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
      18, new Date().toISOString(),
    );
    console.log('[DB] Migration v18 applied: publish_url on articles');
  }

  // Migration v19: add cited_source_ids column (芯图EK · 文章引用信源记录，用于组合引用统计)
  const row19 = db.prepare('SELECT version FROM schema_version WHERE version = ?').get(19);
  if (!row19) {
    try {
      db.exec(`ALTER TABLE articles ADD COLUMN cited_source_ids TEXT`);
    } catch (e) {
      console.debug('[DB] Migration v19: cited_source_ids column already exists, skipping', { error: e instanceof Error ? e.message : String(e) });
    }
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
      19, new Date().toISOString(),
    );
    console.log('[DB] Migration v19 applied: cited_source_ids on articles');
  }
}
