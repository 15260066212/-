import type { DB } from '../db.js';
import type { SessionData } from '@zemingengine/shared';

export interface SessionListItem {
  id: string;
  stage: string;
  enterpriseName?: string;
  createdAt: string;
  updatedAt: string;
}

export class SessionRepository {
  constructor(private db: DB) {}

  /**
   * Wrap a function in a better-sqlite3 transaction.
   */
  private wrapTransaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /**
   * Delete a session and all of its associated data atomically.
   *
   * Cascades to: articles (by session_id), reviews (by article_id),
   * publish_tasks (by article_id), publish_logs (by task_id), and
   * pipeline_runs (by session_id). All deletions run inside a single
   * transaction so the session is either fully removed with its
   * dependents or left untouched.
   */
  deleteSessionCascade(sessionId: string): void {
    this.wrapTransaction(() => {
      // Collect article ids belonging to this session before deletion
      const articleRows = this.db
        .prepare('SELECT id FROM articles WHERE session_id = ?')
        .all(sessionId) as { id: string }[];
      const articleIds = articleRows.map((r) => r.id);

      if (articleIds.length > 0) {
        // Collect publish task ids for those articles
        const placeholders = articleIds.map(() => '?').join(',');
        const taskRows = this.db
          .prepare(`SELECT id FROM publish_tasks WHERE article_id IN (${placeholders})`)
          .all(...articleIds) as { id: string }[];
        const taskIds = taskRows.map((r) => r.id);

        if (taskIds.length > 0) {
          const taskPlaceholders = taskIds.map(() => '?').join(',');
          // Delete publish logs for those tasks first
          this.db
            .prepare(`DELETE FROM publish_logs WHERE task_id IN (${taskPlaceholders})`)
            .run(...taskIds);
        }

        // Delete publish tasks, reviews for those articles
        this.db
          .prepare(`DELETE FROM publish_tasks WHERE article_id IN (${placeholders})`)
          .run(...articleIds);
        this.db
          .prepare(`DELETE FROM reviews WHERE article_id IN (${placeholders})`)
          .run(...articleIds);
      }

      // Delete articles belonging to the session
      this.db.prepare('DELETE FROM articles WHERE session_id = ?').run(sessionId);

      // Delete pipeline runs referencing the session
      this.db.prepare('DELETE FROM pipeline_runs WHERE session_id = ?').run(sessionId);

      // Finally, delete the session itself
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    });
  }

  upsertSession(id: string, data: SessionData, userId?: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, data, current_stage, created_at, updated_at, user_id)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        data = excluded.data,
        current_stage = excluded.current_stage,
        updated_at = excluded.updated_at,
        user_id = COALESCE(excluded.user_id, sessions.user_id)
    `);
    const now = new Date().toISOString();
    stmt.run(id, JSON.stringify(data), data.currentStage, now, now, userId ?? null);
  }

  getSession(id: string): SessionData | undefined {
    const row = this.db.prepare('SELECT data FROM sessions WHERE id = ?').get(id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) as SessionData : undefined;
  }

  deleteSession(id: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }

  /** Get all sessions belonging to a specific user. */
  getSessionsByUser(userId: string): SessionListItem[] {
    const rows = this.db
      .prepare('SELECT id, data, current_stage, created_at, updated_at FROM sessions WHERE user_id = ? ORDER BY created_at DESC')
      .all(userId) as Record<string, unknown>[];
    return this.toListItems(rows);
  }

  /** Get every session regardless of owner (admin only). */
  getAllSessions(): SessionListItem[] {
    const rows = this.db
      .prepare('SELECT id, data, current_stage, created_at, updated_at FROM sessions ORDER BY created_at DESC')
      .all() as Record<string, unknown>[];
    return this.toListItems(rows);
  }

  private toListItems(rows: Record<string, unknown>[]): SessionListItem[] {
    return rows.map((r) => {
      let enterpriseName: string | undefined;
      try {
        const data = JSON.parse(String(r.data));
        enterpriseName = data?.enterprise?.fullName || data?.enterprise?.shortName;
      } catch {
        // data may not be valid JSON in edge cases
      }
      return {
        id: String(r.id),
        stage: String(r.current_stage),
        enterpriseName,
        createdAt: String(r.created_at),
        updatedAt: String(r.updated_at),
      };
    });
  }
}
