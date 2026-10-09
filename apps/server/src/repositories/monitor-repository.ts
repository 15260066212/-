import type { DB } from '../db.js';
import type {
  MonitorArticleStats,
  MonitorPublishTaskStats,
  MonitorPipelineRunStats,
  MonitorCredentialStats,
  ArticleTimelinePoint,
  PlatformCount,
  StatusCount,
  PublishPlatformStat,
  PublishTimelinePoint,
  ReviewChartdata,
  ScoreDistributionItem,
  FailureTypeStat,
  SuccessRateTrendPoint,
  PublishFailureAnalysis,
} from '@zemingengine/shared';

export class MonitorRepository {
  constructor(private db: DB) {}

  /**
   * Count articles grouped by status. Returns the total across all statuses
   * plus a per-status breakdown.
   */
  getArticleStats(): MonitorArticleStats {
    const rows = this.db
      .prepare('SELECT status, COUNT(*) as count FROM articles GROUP BY status')
      .all() as { status: string; count: number }[];
    const result: MonitorArticleStats = {
      total: 0, draft: 0, reviewing: 0, approved: 0,
      publishing: 0, published: 0, failed: 0,
    };
    for (const row of rows) {
      switch (row.status) {
        case 'draft': result.draft = row.count; break;
        case 'reviewing': result.reviewing = row.count; break;
        case 'approved': result.approved = row.count; break;
        case 'publishing': result.publishing = row.count; break;
        case 'published': result.published = row.count; break;
        case 'failed': result.failed = row.count; break;
      }
      result.total += row.count;
    }
    return result;
  }

  /**
   * Count articles created per day for the last `days` days (inclusive of
   * today). Returns an ordered list (oldest first).
   */
  getArticleTimeline(days: number): ArticleTimelinePoint[] {
    const safeDays = Math.max(0, Math.floor(days));
    const rows = this.db
      .prepare(
        `SELECT DATE(created_at) as date, COUNT(*) as count
         FROM articles
         WHERE created_at >= DATE('now', '-' || ? || ' days')
         GROUP BY DATE(created_at)
         ORDER BY date ASC`,
      )
      .all(safeDays) as { date: string; count: number }[];
    return rows.map((r) => ({ date: r.date, count: r.count }));
  }

  /** Count articles grouped by platform. */
  getArticlesByPlatformStats(): PlatformCount[] {
    const rows = this.db
      .prepare(
        'SELECT platform, COUNT(*) as count FROM articles GROUP BY platform ORDER BY count DESC',
      )
      .all() as { platform: string; count: number }[];
    return rows.map((r) => ({ platform: r.platform, count: r.count }));
  }

  /** Count articles grouped by status (ordered by count desc). */
  getArticlesByStatusStats(): StatusCount[] {
    const rows = this.db
      .prepare(
        'SELECT status, COUNT(*) as count FROM articles GROUP BY status ORDER BY count DESC',
      )
      .all() as { status: string; count: number }[];
    return rows.map((r) => ({ status: r.status, count: r.count }));
  }

  /**
   * Count publish tasks grouped by platform, including total, published, and
   * failed counts per platform.
   */
  getPublishStatsByPlatform(): PublishPlatformStat[] {
    const rows = this.db
      .prepare(
        `SELECT platform,
           COUNT(*) as total,
           SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) as published,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
         FROM publish_tasks
         GROUP BY platform
         ORDER BY total DESC`,
      )
      .all() as { platform: string; total: number; published: number; failed: number }[];
    return rows.map((r) => ({
      platform: r.platform,
      total: Number(r.total),
      published: Number(r.published),
      failed: Number(r.failed),
    }));
  }

  /**
   * Count published and failed publish tasks per day for the last `days` days.
   * Grouped by the task's creation date.
   */
  getPublishTimeline(days: number): PublishTimelinePoint[] {
    const safeDays = Math.max(0, Math.floor(days));
    const rows = this.db
      .prepare(
        `SELECT DATE(created_at) as date,
           SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) as published,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
         FROM publish_tasks
         WHERE created_at >= DATE('now', '-' || ? || ' days')
         GROUP BY DATE(created_at)
         ORDER BY date ASC`,
      )
      .all(safeDays) as { date: string; published: number; failed: number }[];
    return rows.map((r) => ({
      date: r.date,
      published: Number(r.published),
      failed: Number(r.failed),
    }));
  }

  /**
   * Compute review statistics: average overall score, pass rate, and a
   * score distribution across five buckets (0-60, 60-70, 70-80, 80-90,
   * 90-100). Returns zeros when no reviews exist.
   */
  getReviewStats(): ReviewChartdata {
    const rows = this.db
      .prepare('SELECT overall_score, passed FROM reviews')
      .all() as { overall_score: number; passed: number }[];

    const ranges: { range: string; min: number; max: number; count: number }[] = [
      { range: '0-60', min: 0, max: 60, count: 0 },
      { range: '60-70', min: 60, max: 70, count: 0 },
      { range: '70-80', min: 70, max: 80, count: 0 },
      { range: '80-90', min: 80, max: 90, count: 0 },
      { range: '90-100', min: 90, max: 101, count: 0 },
    ];

    if (rows.length === 0) {
      return {
        averageScore: 0,
        passRate: 0,
        scoreDistribution: ranges.map((r) => ({ range: r.range, count: r.count })),
      };
    }

    let sumScore = 0;
    let passedCount = 0;
    for (const row of rows) {
      const score = Number(row.overall_score);
      sumScore += score;
      if (row.passed) passedCount++;
      for (const r of ranges) {
        if (score >= r.min && score < r.max) {
          r.count++;
          break;
        }
      }
    }

    const averageScore = sumScore / rows.length;
    const passRate = (passedCount / rows.length) * 100;

    const scoreDistribution: ScoreDistributionItem[] = ranges.map((r) => ({
      range: r.range,
      count: r.count,
    }));

    return {
      averageScore: Math.round(averageScore * 10) / 10,
      passRate: Math.round(passRate * 10) / 10,
      scoreDistribution,
    };
  }

  /** Total number of sessions. */
  getSessionCount(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM sessions')
      .get() as { count: number };
    return Number(row.count) || 0;
  }

  /** Count pipeline runs grouped by status. */
  getPipelineRunStats(): MonitorPipelineRunStats {
    const rows = this.db
      .prepare('SELECT status, COUNT(*) as count FROM pipeline_runs GROUP BY status')
      .all() as { status: string; count: number }[];
    const result: MonitorPipelineRunStats = {
      total: 0, running: 0, completed: 0, failed: 0, cancelled: 0,
    };
    for (const row of rows) {
      switch (row.status) {
        case 'running': result.running = row.count; break;
        case 'completed': result.completed = row.count; break;
        case 'failed': result.failed = row.count; break;
        case 'cancelled': result.cancelled = row.count; break;
      }
      result.total += row.count;
    }
    return result;
  }

  /** Count credentials grouped by status. */
  getCredentialStats(): MonitorCredentialStats {
    const rows = this.db
      .prepare('SELECT status, COUNT(*) as count FROM platform_credentials GROUP BY status')
      .all() as { status: string; count: number }[];
    const result: MonitorCredentialStats = {
      total: 0, active: 0, expired: 0, invalid: 0,
    };
    for (const row of rows) {
      switch (row.status) {
        case 'active': result.active = row.count; break;
        case 'expired': result.expired = row.count; break;
        case 'invalid': result.invalid = row.count; break;
      }
      result.total += row.count;
    }
    return result;
  }

  /** Count publish tasks grouped by status (used for overview aggregation). */
  getPublishTaskStats(): MonitorPublishTaskStats {
    const rows = this.db
      .prepare('SELECT status, COUNT(*) as count FROM publish_tasks GROUP BY status')
      .all() as { status: string; count: number }[];
    const result: MonitorPublishTaskStats = {
      total: 0, pending: 0, publishing: 0, published: 0, failed: 0, retrying: 0,
    };
    for (const row of rows) {
      switch (row.status) {
        case 'pending': result.pending = row.count; break;
        case 'publishing': result.publishing = row.count; break;
        case 'published': result.published = row.count; break;
        case 'failed': result.failed = row.count; break;
        case 'retrying': result.retrying = row.count; break;
      }
      result.total += row.count;
    }
    return result;
  }

  /**
   * Comprehensive failure analysis: groups failures by type, platform,
   * provides daily success rate trends, and surfaces the most common errors.
   */
  getPublishFailureAnalysis(days: number = 30): PublishFailureAnalysis {
    const safeDays = Math.max(1, Math.floor(days));

    // 1. Failures grouped by failure_type
    const failureRows = this.db
      .prepare(
        `SELECT failure_type, COUNT(*) as count
         FROM publish_tasks
         WHERE status = 'failed' AND failure_type IS NOT NULL
         GROUP BY failure_type
         ORDER BY count DESC`,
      )
      .all() as { failure_type: string; count: number }[];

    const totalFailures = failureRows.reduce((sum, r) => sum + r.count, 0);
    const categoryLabels: Record<string, string> = {
      network: '网络错误',
      auth: '认证失败',
      rate_limit: '频率限制',
      content: '内容违规',
      platform: '平台异常',
      unknown: '未知错误',
    };
    const byFailureType: FailureTypeStat[] = failureRows.map((r) => ({
      type: r.failure_type,
      category: categoryLabels[r.failure_type] ?? r.failure_type,
      count: r.count,
      percentage: totalFailures > 0 ? Math.round((r.count / totalFailures) * 1000) / 10 : 0,
    }));

    // 2. Platform breakdown (reuse getPublishStatsByPlatform)
    const byPlatform = this.getPublishStatsByPlatform();

    // 3. Daily success rate trend
    const trendRows = this.db
      .prepare(
        `SELECT DATE(created_at) as date,
           COUNT(*) as total,
           SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) as published,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
         FROM publish_tasks
         WHERE created_at >= DATE('now', '-' || ? || ' days')
         GROUP BY DATE(created_at)
         ORDER BY date ASC`,
      )
      .all(safeDays) as { date: string; total: number; published: number; failed: number }[];

    const successRateTrend: SuccessRateTrendPoint[] = trendRows.map((r) => ({
      date: r.date,
      total: Number(r.total),
      published: Number(r.published),
      failed: Number(r.failed),
      successRate: r.total > 0 ? Math.round((Number(r.published) / r.total) * 1000) / 10 : 0,
    }));

    // 4. Overall success rate
    const taskStats = this.getPublishTaskStats();
    const completed = taskStats.published + taskStats.failed;
    const overallSuccessRate = completed > 0
      ? Math.round((taskStats.published / completed) * 1000) / 10
      : 0;

    // 5. Top error messages
    const errorRows = this.db
      .prepare(
        `SELECT error_message, failure_type, COUNT(*) as count
         FROM publish_tasks
         WHERE status = 'failed' AND error_message IS NOT NULL
         GROUP BY error_message
         ORDER BY count DESC
         LIMIT ?`,
      )
      .all(10) as { error_message: string; failure_type: string; count: number }[];

    const topErrors = errorRows.map((r) => ({
      error: String(r.error_message).slice(0, 200),
      count: Number(r.count),
      type: r.failure_type ?? 'unknown',
    }));

    return {
      byFailureType,
      byPlatform,
      successRateTrend,
      overallSuccessRate,
      totalFailures,
      topErrors,
    };
  }
}
