import type { DB } from '../db.js';
import type { PipelineRun } from '@zemingengine/shared';

export class PipelineRepository {
  constructor(private db: DB) {}

  insertPipelineRun(run: PipelineRun): void {
    const stmt = this.db.prepare(`
      INSERT INTO pipeline_runs (
        id, session_id, status, total_articles, completed_articles,
        current_platform, current_round, error_message, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      run.id, run.sessionId, run.status, run.totalArticles,
      run.completedArticles, run.currentPlatform ?? null,
      run.currentRound ?? null, run.errorMessage ?? null,
      run.startedAt, run.completedAt ?? null,
    );
  }

  updatePipelineRun(id: string, updates: Partial<PipelineRun>): void {
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [key, val] of Object.entries(updates)) {
      if (val === undefined) continue;
      const dbKey = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
      fields.push(`${dbKey} = ?`);
      values.push(val);
    }
    const sql = `UPDATE pipeline_runs SET ${fields.join(', ')} WHERE id = ?`;
    values.push(id);
    this.db.prepare(sql).run(...values);
  }

  getPipelineRun(id: string): PipelineRun | undefined {
    const row = this.db.prepare('SELECT * FROM pipeline_runs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapPipelineRun(row) : undefined;
  }

  getLatestPipelineRunBySession(sessionId: string): PipelineRun | undefined {
    const row = this.db.prepare(
      'SELECT * FROM pipeline_runs WHERE session_id = ? ORDER BY started_at DESC LIMIT 1',
    ).get(sessionId) as Record<string, unknown> | undefined;
    return row ? this.mapPipelineRun(row) : undefined;
  }

  private mapPipelineRun(row: Record<string, unknown>): PipelineRun {
    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      status: String(row.status) as PipelineRun['status'],
      totalArticles: Number(row.total_articles),
      completedArticles: Number(row.completed_articles),
      currentPlatform: row.current_platform ? String(row.current_platform) : undefined,
      currentRound: row.current_round !== null ? Number(row.current_round) : undefined,
      errorMessage: row.error_message ? String(row.error_message) : undefined,
      startedAt: String(row.started_at),
      completedAt: row.completed_at ? String(row.completed_at) : undefined,
    };
  }
}
