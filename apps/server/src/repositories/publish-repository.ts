import type { DB } from '../db.js';
import type { PublishTask, PublishTaskStatus, PublishLog } from '@zemingengine/shared';

export class PublishRepository {
  constructor(private db: DB) {}

  insertPublishTask(task: PublishTask): void {
    const stmt = this.db.prepare(`
      INSERT INTO publish_tasks (
        id, article_id, platform, account_id, status, method,
        platform_post_id, platform_post_url, error_message, failure_type,
        retry_count, max_retries, scheduled_at, published_at, created_at, updated_at, user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      task.id, task.articleId, task.platform, task.accountId ?? 'default', task.status, task.method,
      task.platformPostId ?? null, task.platformPostUrl ?? null,
      task.errorMessage ?? null, task.failureType ?? null,
      task.retryCount, task.maxRetries,
      task.scheduledAt ?? null, task.publishedAt ?? null,
      task.createdAt, task.updatedAt, task.userId ?? 'user_default'
    );
  }

  updatePublishTask(id: string, updates: Partial<PublishTask>): void {
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [key, val] of Object.entries(updates)) {
      if (val === undefined) continue;
      const dbKey = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
      fields.push(`${dbKey} = ?`);
      values.push(val);
    }
    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);
    const sql = `UPDATE publish_tasks SET ${fields.join(', ')} WHERE id = ?`;
    this.db.prepare(sql).run(...values);
  }

  getPublishTask(id: string): PublishTask | undefined {
    const row = this.db.prepare('SELECT * FROM publish_tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapPublishTask(row) : undefined;
  }

  getPendingPublishTasks(): PublishTask[] {
    const rows = this.db.prepare(
      "SELECT * FROM publish_tasks WHERE status IN ('pending', 'retrying') ORDER BY priority DESC, created_at ASC",
    ).all() as Record<string, unknown>[];
    return rows.map((r) => this.mapPublishTask(r));
  }

  getPublishTasksByArticle(articleId: string): PublishTask[] {
    const rows = this.db.prepare('SELECT * FROM publish_tasks WHERE article_id = ? ORDER BY created_at DESC').all(articleId) as Record<string, unknown>[];
    return rows.map((r) => this.mapPublishTask(r));
  }

  /**
   * Query publish tasks matching any of the given statuses.
   * Returns an empty array when no statuses are provided.
   */
  getPublishTasksByStatuses(statuses: PublishTaskStatus[]): PublishTask[] {
    if (statuses.length === 0) return [];
    const placeholders = statuses.map(() => '?').join(',');
    const rows = this.db
      .prepare(`SELECT * FROM publish_tasks WHERE status IN (${placeholders}) ORDER BY created_at ASC`)
      .all(...statuses) as Record<string, unknown>[];
    return rows.map((r) => this.mapPublishTask(r));
  }

  /** Get all tasks that have a scheduledAt and are in 'pending' status, ordered by scheduled time. */
  getScheduledPublishTasks(): PublishTask[] {
    const rows = this.db.prepare(
      "SELECT * FROM publish_tasks WHERE scheduled_at IS NOT NULL AND status = 'pending' ORDER BY scheduled_at ASC",
    ).all() as Record<string, unknown>[];
    return rows.map((r) => this.mapPublishTask(r));
  }

  /** Get all tasks that have a scheduledAt (any status), ordered by scheduled time. */
  getAllScheduledTasks(): PublishTask[] {
    const rows = this.db.prepare(
      'SELECT * FROM publish_tasks WHERE scheduled_at IS NOT NULL ORDER BY scheduled_at ASC',
    ).all() as Record<string, unknown>[];
    return rows.map((r) => this.mapPublishTask(r));
  }

  /** Get tasks in 'publishing' status whose updated_at is older than the given threshold (ms). */
  getStalePublishingTasks(staleMs: number): PublishTask[] {
    const cutoff = new Date(Date.now() - staleMs).toISOString();
    const rows = this.db.prepare(
      "SELECT * FROM publish_tasks WHERE status = 'publishing' AND updated_at < ?",
    ).all(cutoff) as Record<string, unknown>[];
    return rows.map((r) => this.mapPublishTask(r));
  }

  /** Get queue status statistics grouped by task status. */
  getQueueStatus(): {
    pending: number;
    publishing: number;
    published: number;
    failed: number;
    retrying: number;
    total: number;
  } {
    const rows = this.db.prepare(
      'SELECT status, COUNT(*) as count FROM publish_tasks GROUP BY status',
    ).all() as { status: string; count: number }[];
    const result = { pending: 0, publishing: 0, published: 0, failed: 0, retrying: 0, total: 0 };
    for (const row of rows) {
      switch (row.status) {
        case 'pending':
          result.pending = row.count;
          break;
        case 'publishing':
          result.publishing = row.count;
          break;
        case 'published':
          result.published = row.count;
          break;
        case 'failed':
          result.failed = row.count;
          break;
        case 'retrying':
          result.retrying = row.count;
          break;
      }
      result.total += row.count;
    }
    return result;
  }

  private mapPublishTask(row: Record<string, unknown>): PublishTask {
    return {
      id: String(row.id),
      articleId: String(row.article_id),
      platform: String(row.platform) as PublishTask['platform'],
      accountId: row.account_id ? String(row.account_id) : undefined,
      status: String(row.status) as PublishTask['status'],
      method: String(row.method) as PublishTask['method'],
      userId: row.user_id ? String(row.user_id) : undefined,
      platformPostId: row.platform_post_id ? String(row.platform_post_id) : undefined,
      platformPostUrl: row.platform_post_url ? String(row.platform_post_url) : undefined,
      errorMessage: row.error_message ? String(row.error_message) : undefined,
      failureType: row.failure_type ? String(row.failure_type) : undefined,
      verificationStatus: row.verification_status
        ? (String(row.verification_status) as PublishTask['verificationStatus'])
        : undefined,
      verificationMessage: row.verification_message
        ? String(row.verification_message)
        : undefined,
      retryCount: Number(row.retry_count),
      maxRetries: Number(row.max_retries),
      scheduledAt: row.scheduled_at ? String(row.scheduled_at) : undefined,
      publishedAt: row.published_at ? String(row.published_at) : undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      priority: Number(row.priority ?? 0),
      cooldownUntil: row.cooldown_until ? String(row.cooldown_until) : undefined,
    };
  }

  /** Get recent publish stats for a specific platform (last N tasks). */
  getPlatformPublishHealth(platform: string, limit: number = 20): {
    platform: string;
    total: number;
    published: number;
    failed: number;
    successRate: number;
    recentFailures: number;
    avgRetryCount: number;
    lastPublishedAt: string | null;
    lastError: string | null;
  } {
    const rows = this.db.prepare(
      `SELECT status, retry_count, error_message, published_at
       FROM publish_tasks WHERE platform = ?
       ORDER BY created_at DESC LIMIT ?`,
    ).all(platform, Math.max(1, limit)) as { status: string; retry_count: number; error_message: string | null; published_at: string | null }[];

    const total = rows.length;
    const published = rows.filter((r) => r.status === 'published').length;
    const failed = rows.filter((r) => r.status === 'failed').length;
    const recentFailures = rows.filter((r) => r.status === 'failed').length;
    const avgRetryCount = total > 0
      ? Math.round((rows.reduce((sum, r) => sum + r.retry_count, 0) / total) * 10) / 10
      : 0;
    const lastPublished = rows.find((r) => r.status === 'published');
    const lastFailed = rows.find((r) => r.status === 'failed');

    return {
      platform,
      total,
      published,
      failed,
      successRate: total > 0 ? Math.round((published / total) * 1000) / 10 : 0,
      recentFailures,
      avgRetryCount,
      lastPublishedAt: lastPublished?.published_at ?? null,
      lastError: lastFailed?.error_message ?? null,
    };
  }

  /** Get publish health for all platforms. */
  getAllPlatformPublishHealth(): Array<ReturnType<PublishRepository['getPlatformPublishHealth']>> {
    const platforms = this.db.prepare(
      'SELECT DISTINCT platform FROM publish_tasks ORDER BY platform',
    ).all() as { platform: string }[];
    return platforms.map((p) => this.getPlatformPublishHealth(p.platform));
  }

  /** Get publish queue details with task info. */
  getPublishQueueDetail(): {
    pending: PublishTask[];
    publishing: PublishTask[];
    retrying: PublishTask[];
    counts: { pending: number; publishing: number; published: number; failed: number; retrying: number; total: number };
  } {
    const pendingRows = this.db.prepare(
      "SELECT * FROM publish_tasks WHERE status = 'pending' ORDER BY priority DESC, created_at ASC LIMIT 20",
    ).all() as Record<string, unknown>[];
    const publishingRows = this.db.prepare(
      "SELECT * FROM publish_tasks WHERE status = 'publishing' ORDER BY updated_at DESC",
    ).all() as Record<string, unknown>[];
    const retryingRows = this.db.prepare(
      "SELECT * FROM publish_tasks WHERE status = 'retrying' ORDER BY priority DESC, created_at ASC LIMIT 20",
    ).all() as Record<string, unknown>[];

    return {
      pending: pendingRows.map((r) => this.mapPublishTask(r)),
      publishing: publishingRows.map((r) => this.mapPublishTask(r)),
      retrying: retryingRows.map((r) => this.mapPublishTask(r)),
      counts: this.getQueueStatus(),
    };
  }

  // === Publish Logs ===
  insertPublishLog(log: PublishLog): void {
    const stmt = this.db.prepare(`
      INSERT INTO publish_logs (id, task_id, level, message, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(log.id, log.taskId, log.level, log.message, log.metadata ? JSON.stringify(log.metadata) : null, log.createdAt);
  }

  getLogsByTask(taskId: string): PublishLog[] {
    const rows = this.db.prepare('SELECT * FROM publish_logs WHERE task_id = ? ORDER BY created_at DESC').all(taskId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      taskId: String(r.task_id),
      level: String(r.level) as PublishLog['level'],
      message: String(r.message),
      metadata: r.metadata ? JSON.parse(String(r.metadata)) : undefined,
      createdAt: String(r.created_at),
    }));
  }

  /**
   * Get the most recent publish logs across all tasks, newest first.
   * @param limit maximum number of logs to return (must be >= 0)
   */
  getRecentPublishLogs(limit: number): PublishLog[] {
    const safeLimit = Math.max(0, Math.floor(limit));
    if (safeLimit === 0) return [];
    const rows = this.db
      .prepare('SELECT * FROM publish_logs ORDER BY created_at DESC LIMIT ?')
      .all(safeLimit) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      taskId: String(r.task_id),
      level: String(r.level) as PublishLog['level'],
      message: String(r.message),
      metadata: r.metadata ? JSON.parse(String(r.metadata)) : undefined,
      createdAt: String(r.created_at),
    }));
  }
}
