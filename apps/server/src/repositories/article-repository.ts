import type { DB } from '../db.js';
import type { Article, ArticleStatus } from '@zemingengine/shared';

export class ArticleRepository {
  constructor(private db: DB) {}

  insertArticle(article: Article): void {
    // Pre-write validation
    if (!article.title || (typeof article.title === 'string' && article.title.trim().length === 0)) {
      throw new Error(
        `Validation failed: title must be a non-empty string (received: ${JSON.stringify(article.title)})`,
      );
    }
    if (
      typeof article.wordCount !== 'number' ||
      !Number.isFinite(article.wordCount) ||
      article.wordCount < 0
    ) {
      throw new Error(
        `Validation failed: wordCount must be >= 0 (received: ${JSON.stringify(article.wordCount)})`,
      );
    }

    const stmt = this.db.prepare(`
      INSERT INTO articles (
        id, session_id, platform, content_type, title, content_markdown,
        content_html, content_plain, tags, summary, cover_image_desc,
        word_count, status, generation_round, generation_meta, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      article.id, article.sessionId, article.platform, article.contentType,
      article.title, article.contentMarkdown, article.contentHtml ?? null,
      article.contentPlain ?? null, JSON.stringify(article.tags), article.summary ?? null,
      article.coverImageDesc ?? null, article.wordCount, article.status,
      article.generationRound, article.generationMeta ? JSON.stringify(article.generationMeta) : null,
      article.createdAt, article.updatedAt
    );
  }

  updateArticle(id: string, updates: Partial<Article>): void {
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [key, val] of Object.entries(updates)) {
      if (val === undefined) continue;
      const dbKey = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
      fields.push(`${dbKey} = ?`);
      if (key === 'tags' && Array.isArray(val)) {
        values.push(JSON.stringify(val));
      } else if (key === 'generationMeta' && val) {
        values.push(JSON.stringify(val));
      } else {
        values.push(val);
      }
    }
    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);
    const sql = `UPDATE articles SET ${fields.join(', ')} WHERE id = ?`;
    this.db.prepare(sql).run(...values);
  }

  getArticle(id: string): Article | undefined {
    const row = this.db.prepare('SELECT * FROM articles WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapArticle(row) : undefined;
  }

  getArticlesBySession(sessionId: string): Article[] {
    const rows = this.db.prepare('SELECT * FROM articles WHERE session_id = ? ORDER BY created_at DESC').all(sessionId) as Record<string, unknown>[];
    return rows.map((r) => this.mapArticle(r));
  }

  getArticlesByStatus(status: ArticleStatus): Article[] {
    const rows = this.db.prepare('SELECT * FROM articles WHERE status = ? ORDER BY created_at DESC').all(status) as Record<string, unknown>[];
    return rows.map((r) => this.mapArticle(r));
  }

  /**
   * Query articles matching any of the given statuses.
   * Returns an empty array when no statuses are provided.
   */
  getArticlesByStatuses(statuses: ArticleStatus[]): Article[] {
    if (statuses.length === 0) return [];
    const placeholders = statuses.map(() => '?').join(',');
    const rows = this.db
      .prepare(`SELECT * FROM articles WHERE status IN (${placeholders}) ORDER BY created_at DESC`)
      .all(...statuses) as Record<string, unknown>[];
    return rows.map((r) => this.mapArticle(r));
  }

  private mapArticle(row: Record<string, unknown>): Article {
    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      platform: String(row.platform) as Article['platform'],
      contentType: String(row.content_type) as Article['contentType'],
      title: String(row.title),
      contentMarkdown: String(row.content_markdown),
      contentHtml: row.content_html ? String(row.content_html) : undefined,
      contentPlain: row.content_plain ? String(row.content_plain) : undefined,
      tags: JSON.parse(String(row.tags)),
      summary: row.summary ? String(row.summary) : undefined,
      coverImageDesc: row.cover_image_desc ? String(row.cover_image_desc) : undefined,
      wordCount: Number(row.word_count),
      status: String(row.status) as Article['status'],
      generationRound: Number(row.generation_round),
      reviewRound: Number(row.review_round ?? 0),
      publishUrl: row.publish_url ? String(row.publish_url) : undefined,
      generationMeta: row.generation_meta ? JSON.parse(String(row.generation_meta)) : undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
}
