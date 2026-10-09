import { Hono } from 'hono';
import type { DatabaseAccess } from '../db.js';
import type { ReloginManager } from '../session-health/relogin-manager.js';
import type { SelectorMonitor } from '../session-health/selector-monitor.js';
import type { CaptchaManager } from '../session-health/captcha-manager.js';

type Db = DatabaseAccess | import('../cached-db.js').CachedDatabaseAccess;

export function createMonitorRoutes(
  db: Db,
  _reloginManager: ReloginManager,
  selectorMonitor: SelectorMonitor,
  _captchaManager: CaptchaManager,
) {
  const app = new Hono();

  app.get('/overview', (c) => {
    try {
      const articles = db.articles.getArticlesByStatuses(['draft', 'reviewing', 'approved', 'published', 'failed']);
      const publishTasks = db.publish.getPublishTasksByStatuses(['pending', 'publishing', 'published', 'failed', 'retrying']);
      const sessions = db.sessions.getSessionsByUser('user_default');
      const recentLogs = db.publish.getRecentPublishLogs(20);

      const published = articles.filter((a) => a.status === 'published').length;
      const draft = articles.filter((a) => a.status === 'draft').length;

      const tasksPublished = publishTasks.filter((t) => t.status === 'published').length;
      const tasksFailed = publishTasks.filter((t) => t.status === 'failed').length;

      return c.json({
        success: true,
        data: {
          articles: { total: articles.length, published, draft },
          publishTasks: { total: publishTasks.length, published: tasksPublished, failed: tasksFailed },
          sessions: { total: sessions.length },
          pipelineRuns: { total: 0, running: 0, completed: 0 },
          recentLogs,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return c.json({ success: false, error: message }, 500);
    }
  });

  app.get('/charts/articles', (c) => {
    try {
      const articles = db.articles.getArticlesByStatuses(['draft', 'reviewing', 'approved', 'published', 'failed']);
      const now = Date.now();
      const days = 30;
      const timeline: { date: string; count: number }[] = [];

      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now - i * 24 * 60 * 60 * 1000);
        const dateStr = d.toISOString().slice(0, 10);
        const count = articles.filter((a) => a.createdAt.startsWith(dateStr)).length;
        timeline.push({ date: dateStr, count });
      }

      return c.json({ success: true, data: { timeline } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return c.json({ success: false, error: message }, 500);
    }
  });

  app.get('/charts/publish', (c) => {
    try {
      const tasks = db.publish.getPublishTasksByStatuses(['pending', 'publishing', 'published', 'failed', 'retrying']);
      const published = tasks.filter((t) => t.status === 'published').length;
      const failed = tasks.filter((t) => t.status === 'failed').length;
      const total = tasks.length;
      const successRate = total > 0 ? (published / total) * 100 : 0;

      const platformMap: Record<string, { platform: string; total: number; published: number; failed: number }> = {};
      for (const t of tasks) {
        const p = t.platform;
        if (!platformMap[p]) platformMap[p] = { platform: p, total: 0, published: 0, failed: 0 };
        platformMap[p].total++;
        if (t.status === 'published') platformMap[p].published++;
        if (t.status === 'failed') platformMap[p].failed++;
      }

      return c.json({
        success: true,
        data: {
          successRate,
          byPlatform: Object.values(platformMap),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return c.json({ success: false, error: message }, 500);
    }
  });

  app.get('/charts/reviews', (c) => {
    try {
      const articles = db.articles.getArticlesByStatuses(['draft', 'reviewing', 'approved', 'published', 'failed']);
      let totalReviews = 0;
      let passedReviews = 0;
      let scoreSum = 0;

      for (const article of articles) {
        const reviews = db.reviews.getReviewsByArticle(article.id);
        for (const r of reviews) {
          totalReviews++;
          if (r.passed) passedReviews++;
          scoreSum += r.overallScore;
        }
      }

      const passRate = totalReviews > 0 ? (passedReviews / totalReviews) * 100 : 0;
      const averageScore = totalReviews > 0 ? scoreSum / totalReviews : 0;

      const ranges = ['0-20', '20-40', '40-60', '60-80', '80-100'];
      const scoreDistribution = ranges.map((range) => {
        const [min, max] = range.split('-').map(Number);
        let count = 0;
        for (const article of articles) {
          const reviews = db.reviews.getReviewsByArticle(article.id);
          for (const r of reviews) {
            if (r.overallScore >= min && r.overallScore < max) count++;
          }
        }
        return { range, count };
      });

      return c.json({
        success: true,
        data: { averageScore, passRate, scoreDistribution },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return c.json({ success: false, error: message }, 500);
    }
  });

  app.get('/charts/publish-failures', (c) => {
    try {
      const logs = db.publish.getRecentPublishLogs(500);
      const errorLogs = logs.filter((l) => l.level === 'error');

      const failureTypeMap: Record<string, { type: string; category: string; count: number }> = {};
      for (const log of errorLogs) {
        const type = log.message.includes('network') ? 'network' :
                     log.message.includes('auth') ? 'auth' :
                     log.message.includes('rate') ? 'rate_limit' :
                     log.message.includes('content') ? 'content' :
                     log.message.includes('platform') ? 'platform' : 'unknown';
        if (!failureTypeMap[type]) {
          const category = type === 'network' ? '网络错误' :
                            type === 'auth' ? '认证失败' :
                            type === 'rate_limit' ? '频率限制' :
                            type === 'content' ? '内容问题' :
                            type === 'platform' ? '平台异常' : '其他';
          failureTypeMap[type] = { type, category, count: 0 };
        }
        failureTypeMap[type].count++;
      }

      const totalFailures = errorLogs.length;
      const byFailureType = Object.values(failureTypeMap).map((item) => ({
        ...item,
        percentage: totalFailures > 0 ? (item.count / totalFailures) * 100 : 0,
      })).sort((a, b) => b.count - a.count);

      const errorCountMap: Record<string, { error: string; count: number; type: string }> = {};
      for (const log of errorLogs) {
        const key = log.message.slice(0, 100);
        if (!errorCountMap[key]) {
          const type = log.message.includes('network') ? 'network' :
                       log.message.includes('auth') ? 'auth' :
                       log.message.includes('rate') ? 'rate_limit' :
                       log.message.includes('content') ? 'content' :
                       log.message.includes('platform') ? 'platform' : 'unknown';
          errorCountMap[key] = { error: log.message, count: 0, type };
        }
        errorCountMap[key].count++;
      }

      const topErrors = Object.values(errorCountMap)
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      const now = Date.now();
      const days = 30;
      const successRateTrend: { date: string; total: number; published: number; failed: number; successRate: number }[] = [];

      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now - i * 24 * 60 * 60 * 1000);
        const dateStr = d.toISOString().slice(0, 10);
        const dayLogs = logs.filter((t) => t.createdAt.startsWith(dateStr));
        const total = dayLogs.length;
        const published = dayLogs.filter((t) => t.level === 'info').length;
        const failed = dayLogs.filter((t) => t.level === 'error').length;
        const successRate = total > 0 ? (published / total) * 100 : 0;
        successRateTrend.push({ date: dateStr, total, published, failed, successRate });
      }

      const overallSuccessRate = successRateTrend.reduce((sum, d) => sum + d.successRate, 0) / days;

      return c.json({
        success: true,
        data: {
          totalFailures,
          byFailureType,
          topErrors,
          successRateTrend,
          overallSuccessRate,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return c.json({ success: false, error: message }, 500);
    }
  });

  app.get('/ai-info', (c) => {
    try {
      const provider = process.env.AI_PROVIDER || 'deepseek';
      const model = process.env.AI_MODEL || 'deepseek-chat';

      return c.json({
        success: true,
        data: {
          available: true,
          provider,
          model,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return c.json({ success: false, error: message }, 500);
    }
  });

  app.get('/selectors', (c) => {
    try {
      const status = selectorMonitor.getStatus();
      return c.json({ success: true, data: status });
    } catch {
      return c.json({ success: true, data: { status: 'ok' } });
    }
  });

  return app;
}
