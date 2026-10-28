import { Hono } from 'hono';
import { Publisher, classifyFailure } from '@zemingengine/publisher';
import { getPlatformLabel } from '@zemingengine/shared';
import type {
  Article,
  PlatformCredentials,
  PublishArticleRequest,
  PublishTask,
} from '@zemingengine/shared';
import type { AppEnv, DatabaseAccess } from '../db.js';
import { resolvePublishCredential, resolveAccountIdFromBody } from '../credential-resolver.js';

// === Helper functions ===

/** Build a review-gate error response, or null if the article has passed review. */
function buildReviewGateError(db: DatabaseAccess, articleId: string) {
  if (db.reviews.hasPassingReview(articleId)) return null;
  const latestReview = db.reviews.getLatestReviewStatus(articleId);
  const reviewStatus = latestReview
    ? `最新审核未通过（评分: ${latestReview.overallScore}, 第${latestReview.round}轮）`
    : '文章尚未审核';
  return `发布被阻止：${reviewStatus}。请先通过审核后再发布。`;
}

/** Format an unknown error into a message string. */
function formatError(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

export function createPublishRoutes(db: DatabaseAccess, publisher: Publisher): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // POST / - 发布文章：创建 PublishTask，调用 publisher.publishWithRetry，更新状态
  app.post('/', async (c) => {
    try {
      const body = await c.req.json<PublishArticleRequest>();
      const article = db.articles.getArticle(body.articleId);
      if (!article) {
        return c.json({ success: false, error: 'Article not found' }, 404);
      }

      const reviewError = buildReviewGateError(db, article.id);
      if (reviewError) {
        return c.json({ success: false, error: reviewError }, 403);
      }

      const platforms = body.platforms ?? [article.platform];
      const user = c.get('user');
      const userId = user?.id ?? 'user_default';
      const tasks: PublishTask[] = [];

      for (const platform of platforms) {
        const accountId = resolveAccountIdFromBody(body, platform, db, userId);
        const result = resolvePublishCredential(db, platform, userId, {
          accountId,
          brandId: body.brandId,
        });

        if (result.success === false) {
          const displayName = getPlatformLabel(platform);
          return c.json(
            { success: false, error: result.reason.replace(platform, displayName) },
            400,
          );
        }
        const credentials = result.credentials;

        const task = publisher.createTask({
          articleId: article.id,
          platform,
          scheduledAt: body.scheduledAt,
          userId,
          accountId: credentials.accountId,
        });

        db.publish.insertPublishTask(task);
        // 草稿尚未在平台落盘，先标记为 publishing，等异步任务确认后再置 draft_saved
        db.articles.updateArticle(article.id, { status: 'publishing' });
        void saveDraftArticleAsync(db, publisher, task, article, credentials);
        tasks.push(task);
      }

      return c.json({ success: true, data: tasks });
    } catch (error) {
      return c.json({ success: false, error: formatError(error) }, 500);
    }
  });

  // GET / - 按 articleId 查询发布任务列表
  app.get('/', (c) => {
    try {
      const articleId = c.req.query('articleId');
      if (!articleId) {
        return c.json(
          { success: false, error: 'articleId query parameter is required' },
          400,
        );
      }
      const tasks = db.publish.getPublishTasksByArticle(articleId);
      return c.json({ success: true, data: tasks });
    } catch (error) {
      return c.json({ success: false, error: formatError(error) }, 500);
    }
  });

  // GET /scheduled - 列出所有有 scheduledAt 的任务（按时间排序）
  app.get('/scheduled', (c) => {
    try {
      const tasks = db.publish.getAllScheduledTasks();
      return c.json({ success: true, data: tasks });
    } catch (error) {
      return c.json({ success: false, error: formatError(error) }, 500);
    }
  });

  // GET /queue/status - 返回队列状态统计
  app.get('/queue/status', (c) => {
    try {
      const status = db.publish.getQueueStatus();
      return c.json({ success: true, data: status });
    } catch (error) {
      return c.json({ success: false, error: formatError(error) }, 500);
    }
  });

  // GET /queue/detail - 返回队列详情（含任务列表）
  app.get('/queue/detail', (c) => {
    try {
      const detail = db.publish.getPublishQueueDetail();
      return c.json({ success: true, data: detail });
    } catch (error) {
      return c.json({ success: false, error: formatError(error) }, 500);
    }
  });

  // POST /batch - 批量发布：同一文章发布到多个平台，支持优先级和账号选择
  app.post('/batch', async (c) => {
    try {
      const body = await c.req.json<{
        articleId: string;
        platforms: string[];
        priority?: number;
        scheduledAt?: string;
        accountId?: string;
        accountIds?: Partial<Record<string, string>>;
        brandId?: number;
      }>();

      if (!body.articleId) {
        return c.json({ success: false, error: 'articleId is required' }, 400);
      }
      if (!body.platforms || body.platforms.length === 0) {
        return c.json({ success: false, error: 'platforms[] is required' }, 400);
      }

      const article = db.articles.getArticle(body.articleId);
      if (!article) {
        return c.json({ success: false, error: 'Article not found' }, 404);
      }

      const reviewError = buildReviewGateError(db, article.id);
      if (reviewError) {
        return c.json({ success: false, error: reviewError }, 403);
      }

      const user = c.get('user');
      const userId = user?.id ?? 'user_default';
      const priority = body.priority ?? 0;
      const tasks: PublishTask[] = [];
      const skipped: Array<{ platform: string; reason: string }> = [];

      for (const platform of body.platforms) {
        const accountId = resolveAccountIdFromBody(body, platform, db, userId);
        const result = resolvePublishCredential(db, platform, userId, {
          accountId,
          brandId: body.brandId,
        });

        if (result.success === false) {
          skipped.push({ platform, reason: result.reason });
          continue;
        }
        const credentials = result.credentials;

        const task = publisher.createTask({
          articleId: article.id,
          platform: platform as Article['platform'],
          scheduledAt: body.scheduledAt,
          userId,
          accountId: credentials.accountId,
        });

        const taskWithPriority = { ...task, priority };
        db.publish.insertPublishTask(taskWithPriority);
        db.articles.updateArticle(article.id, { status: 'draft_saved' });

        void saveDraftArticleAsync(db, publisher, taskWithPriority, article, credentials);
        tasks.push(taskWithPriority);
      }

      return c.json({
        success: true,
        data: {
          tasks,
          skipped,
          dispatched: tasks.length,
          total: body.platforms.length,
        },
      });
    } catch (error) {
      return c.json({ success: false, error: formatError(error) }, 500);
    }
  });

  // GET /:taskId - 查询发布任务
  app.get('/:taskId', (c) => {
    try {
      const taskId = c.req.param('taskId');
      const task = db.publish.getPublishTask(taskId);
      if (!task) {
        return c.json({ success: false, error: 'Publish task not found' }, 404);
      }
      return c.json({ success: true, data: task });
    } catch (error) {
      return c.json({ success: false, error: formatError(error) }, 500);
    }
  });

  // GET /:taskId/logs - 查询发布任务日志
  app.get('/:taskId/logs', (c) => {
    try {
      const taskId = c.req.param('taskId');
      const logs = db.publish.getLogsByTask(taskId);
      return c.json({ success: true, data: logs });
    } catch (error) {
      return c.json({ success: false, error: formatError(error) }, 500);
    }
  });

  // POST /:taskId/retry - 重试发布任务
  app.post('/:taskId/retry', async (c) => {
    try {
      const taskId = c.req.param('taskId');
      const task = db.publish.getPublishTask(taskId);
      if (!task) {
        return c.json({ success: false, error: 'Publish task not found' }, 404);
      }
      const article = db.articles.getArticle(task.articleId);
      if (!article) {
        return c.json({ success: false, error: 'Article not found' }, 404);
      }
      const accountId = task.accountId ?? 'default';
      const credentials = db.credentials.getCredential(task.platform, task.userId ?? 'user_default', accountId);
      if (!credentials) {
        const displayName = getPlatformLabel(task.platform);
        return c.json({ success: false, error: `${displayName}平台Cookie未采集，请先在「账号管理」中采集Cookie后再发布` }, 404);
      }

      db.publish.updatePublishTask(taskId, { status: 'retrying', errorMessage: undefined });
      const retryTask: PublishTask = { ...task, status: 'retrying' };

      void saveDraftArticleAsync(db, publisher, retryTask, article, credentials);

      return c.json({ success: true, data: db.publish.getPublishTask(taskId) });
    } catch (error) {
      return c.json({ success: false, error: formatError(error) }, 500);
    }
  });

  // POST /:taskId/verify - 手动触发发布后验证
  app.post('/:taskId/verify', async (c) => {
    try {
      const taskId = c.req.param('taskId');
      const task = db.publish.getPublishTask(taskId);
      if (!task) {
        return c.json({ success: false, error: 'Publish task not found' }, 404);
      }

      if (!task.platformPostUrl) {
        return c.json(
          { success: false, error: 'Task has no platformPostUrl to verify' },
          400,
        );
      }

      const verification = await verifyTaskPublication(db, publisher, task);

      db.publish.updatePublishTask(taskId, {
        verificationStatus: verification.verificationStatus,
        verificationMessage: verification.verificationMessage,
      });

      return c.json({
        success: true,
        data: {
          taskId,
          verificationStatus: verification.verificationStatus,
          verificationMessage: verification.verificationMessage,
        },
      });
    } catch (error) {
      return c.json({ success: false, error: formatError(error) }, 500);
    }
  });

  // POST /:taskId/confirm-published - 使用者手动在平台发布后，回到系统标记文章为已发布
  app.post('/:taskId/confirm-published', async (c) => {
    try {
      const taskId = c.req.param('taskId');
      const task = db.publish.getPublishTask(taskId);
      if (!task) {
        return c.json({ success: false, error: 'Publish task not found' }, 404);
      }

      // Only tasks currently in draft_saved state can be confirmed as published
      if (task.status !== 'draft_saved') {
        return c.json(
          { success: false, error: `Cannot confirm task with status: ${task.status}. Expected 'draft_saved'.` },
          400,
        );
      }

      // Optional: user can provide the final published URL
      let body: { postUrl?: string } = {};
      try {
        body = await c.req.json<{ postUrl?: string }>();
      } catch {
        body = {};
      }
      const publishedAt = new Date().toISOString();

      const updates: Partial<PublishTask> = {
        status: 'published',
        publishedAt,
      };
      if (body.postUrl) {
        updates.platformPostUrl = body.postUrl;
      }

      const article = db.articles.getArticle(task.articleId);

      db.runInTransaction(() => {
        db.publish.updatePublishTask(taskId, updates);
        if (article) {
          db.articles.updateArticle(article.id, {
            status: 'published',
            ...(body.postUrl ? { publishUrl: body.postUrl } : {}),
          });
        }
      });

      return c.json({
        success: true,
        data: {
          taskId,
          status: 'published',
          publishedAt,
          platformPostUrl: body.postUrl || task.platformPostUrl,
        },
      });
    } catch (error) {
      return c.json({ success: false, error: formatError(error) }, 500);
    }
  });

  // DELETE /:taskId - 取消未执行的定时任务
  app.delete('/:taskId', (c) => {
    try {
      const taskId = c.req.param('taskId');
      const task = db.publish.getPublishTask(taskId);
      if (!task) {
        return c.json({ success: false, error: 'Publish task not found' }, 404);
      }
      if (task.status !== 'pending') {
        return c.json(
          { success: false, error: `Cannot cancel task with status: ${task.status}` },
          400,
        );
      }
      db.publish.updatePublishTask(taskId, {
        status: 'failed',
        errorMessage: 'Cancelled by user',
      });
      return c.json({ success: true, data: db.publish.getPublishTask(taskId) });
    } catch (error) {
      return c.json({ success: false, error: formatError(error) }, 500);
    }
  });

  return app;
}

// 异步执行发布，使用 publishWithRetry 实现自动重试
async function publishArticleAsync(
  db: DatabaseAccess,
  publisher: Publisher,
  task: PublishTask,
  article: Article,
  credentials: PlatformCredentials,
): Promise<void> {
  try {
    const result = await publisher.publishWithRetry(
      task,
      article,
      credentials,
      (updates) => db.publish.updatePublishTask(task.id, updates),
    );

    if (result.success) {
      const updates: Partial<PublishTask> = {
        status: 'published',
        platformPostId: result.postId,
        platformPostUrl: result.postUrl,
        publishedAt: new Date().toISOString(),
      };

      // Persist post-publish verification results if available
      if (result.verificationStatus) {
        updates.verificationStatus = result.verificationStatus;
        updates.verificationMessage = result.verificationMessage;

        if (result.verificationStatus === 'failed') {
          // Verification failed, but the article may still be under review.
          // Record the verification failure without changing the publish status
          // (remains 'published' since the submission itself succeeded).
          console.warn(
            `[publishArticleAsync] Verification failed for task ${task.id}` +
              ` on ${task.platform}: ${result.verificationMessage ?? 'unknown reason'}`,
          );
        }
      }

      // Atomically update both the task and the article so the database
      // never reflects an inconsistent intermediate state.
      db.runInTransaction(() => {
        db.publish.updatePublishTask(task.id, updates);
        db.articles.updateArticle(article.id, { status: 'published' });
      });
    } else {
      const error = result.error ?? 'Unknown publish error';
      const analysis = classifyFailure(error);
      db.runInTransaction(() => {
        db.publish.updatePublishTask(task.id, {
          status: 'failed',
          errorMessage: error,
          failureType: analysis.type,
        });
        db.articles.updateArticle(article.id, { status: 'failed' });
      });
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error';
    const analysis = classifyFailure(error);
    db.runInTransaction(() => {
      db.publish.updatePublishTask(task.id, {
        status: 'failed',
        errorMessage: error,
        failureType: analysis.type,
      });
      db.articles.updateArticle(article.id, { status: 'failed' });
    });
  }
}

// 异步保存草稿：调用 saveDraftWithRetry，成功后任务与文章状态标记为 draft_saved
// （草稿已保存到平台，等待使用者手动发布后通过 confirm-published 标记为已发布）
async function saveDraftArticleAsync(
  db: DatabaseAccess,
  publisher: Publisher,
  task: PublishTask,
  article: Article,
  credentials: PlatformCredentials,
): Promise<void> {
  try {
    const result = await publisher.saveDraftWithRetry(
      task,
      article,
      credentials,
      (updates) => db.publish.updatePublishTask(task.id, updates),
    );

    if (result.success) {
      const updates: Partial<PublishTask> = {
        status: 'draft_saved',
        platformPostId: result.postId,
        platformPostUrl: result.postUrl,
        verificationStatus: result.verificationStatus ?? 'draft_saved',
        verificationMessage: result.verificationMessage,
      };

      db.runInTransaction(() => {
        db.publish.updatePublishTask(task.id, updates);
        db.articles.updateArticle(article.id, { status: 'draft_saved' });
      });
    } else {
      const error = result.error ?? 'Unknown draft-save error';
      const analysis = classifyFailure(error);
      db.runInTransaction(() => {
        db.publish.updatePublishTask(task.id, {
          status: 'failed',
          errorMessage: error,
          failureType: analysis.type,
        });
        db.articles.updateArticle(article.id, { status: 'failed' });
      });
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error';
    const analysis = classifyFailure(error);
    db.runInTransaction(() => {
      db.publish.updatePublishTask(task.id, {
        status: 'failed',
        errorMessage: error,
        failureType: analysis.type,
      });
      db.articles.updateArticle(article.id, { status: 'failed' });
    });
  }
}

/**
 * Verify a published article's accessibility.
 *
 * For API platforms (weixin): delegates to the adapter's verifyWithCredentials
 * method, which calls the WeChat API to check if the article is readable.
 *
 * For RPA platforms: uses fetch to check URL reachability — fetches the
 * postUrl and inspects the response status and body for error indicators.
 */
async function verifyTaskPublication(
  db: DatabaseAccess,
  publisher: Publisher,
  task: PublishTask,
): Promise<{
  verificationStatus: 'verified' | 'unverified' | 'failed';
  verificationMessage: string;
}> {
  const adapter = publisher.getAdapter(task.platform);

  // API platforms: use adapter-based verification if the adapter supports it
  if (adapter && adapter.getMethod() === 'api' && 'verifyWithCredentials' in adapter) {
    const accountId = task.accountId ?? 'default';
    const credentials = db.credentials.getCredential(task.platform, task.userId ?? 'user_default', accountId);
    if (!credentials) {
      return {
        verificationStatus: 'unverified',
        verificationMessage: `No credentials found for platform: ${task.platform}`,
      };
    }

    try {
      return await (adapter as any).verifyWithCredentials(credentials, task.platformPostId);
    } catch (err) {
      return {
        verificationStatus: 'unverified',
        verificationMessage: `Adapter verification error: ${err instanceof Error ? err.message : 'Unknown error'}`,
      };
    }
  }

  // RPA platforms: check URL reachability via fetch
  return verifyUrlReachability(task.platformPostUrl!);
}

/**
 * Check if a URL is reachable and does not contain error indicators.
 * Used for RPA-published articles where we don't have API access.
 */
async function verifyUrlReachability(
  postUrl: string,
): Promise<{
  verificationStatus: 'verified' | 'unverified' | 'failed';
  verificationMessage: string;
}> {
  try {
    const res = await fetch(postUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
      headers: {
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'User-Agent': 'Mozilla/5.0 (compatible; GEO-Verifier/1.0)',
      },
    });

    if (!res.ok) {
      return {
        verificationStatus: 'failed',
        verificationMessage: `URL returned HTTP ${res.status}: ${res.statusText}`,
      };
    }

    // Check response body for common error indicators
    const bodyText = await res.text();

    const errorIndicators = [
      '页面不存在',
      '内容已删除',
      '内容已被删除',
      '文章不存在',
      'Page not found',
      'Access denied',
      '404',
    ];

    for (const indicator of errorIndicators) {
      if (bodyText.includes(indicator)) {
        return {
          verificationStatus: 'failed',
          verificationMessage: `Page contains error indicator: ${indicator}`,
        };
      }
    }

    // If we got here, the page loaded without obvious errors
    return {
      verificationStatus: 'verified',
      verificationMessage: 'Article URL is reachable and accessible',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return {
      verificationStatus: 'unverified',
      verificationMessage: `URL reachability check failed: ${message}`,
    };
  }
}
