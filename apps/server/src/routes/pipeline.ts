import { Hono } from 'hono';
import { ContentGenerator } from '@zemingengine/content-generator';
import { ContentReviewer } from '@zemingengine/content-reviewer';
import { Publisher } from '@zemingengine/publisher';
import type {
  Article,
  ArticleContentType,
  ArticleSummary,
  PipelineRequest,
  PipelineStatus,
  PipelineRun,
  PublishLog,
} from '@zemingengine/shared';
import type { DatabaseAccess } from '../db.js';
import { executePublishWithHandling } from '../publish-utils.js';
import { appendContactFooter } from '../article-footer.js';

const MAX_ROUNDS = 3;

/** Format an unknown error into a message string. */
function formatError(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

/** Tracks active pipeline runs for cancellation. */
const activeRuns = new Map<string, { cancelled: boolean }>();

/** Stores real-time user feedback per sessionId, consumed by the pipeline generator. */
const pipelineFeedback = new Map<string, string>();

/** Stores supplemented keywords per sessionId, consumed by the pipeline generator. */
const pipelineKeywords = new Map<string, string[]>();

export function createPipelineRoutes(db: DatabaseAccess): Hono {
  const app = new Hono();
  const generator = new ContentGenerator();
  const reviewer = new ContentReviewer();
  const publisher = Publisher.createDefault();

  // Wire up log callback to persist publish logs to DB
  publisher.logCallback = (entry) => {
    const log: PublishLog = {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      taskId: entry.taskId,
      level: entry.level,
      message: entry.message,
      metadata: entry.metadata,
      createdAt: new Date().toISOString(),
    };
    try {
      db.publish.insertPublishLog(log);
    } catch {
      // Logging should never break the publish flow
    }
  };

  // POST /start - 启动流水线（异步）：立即返回 runId，后台执行生成+审核+发布
  app.post('/start', async (c) => {
    try {
      const body = await c.req.json<PipelineRequest>();
      const session = db.sessions.getSession(body.sessionId);
      if (!session) {
        return c.json({ success: false, error: 'Session not found' }, 404);
      }

      const articlesPerPlatform = getArticlesPerPlatform(body.planDuration);
      const totalArticles = body.planArticles?.length || (body.platforms.length * articlesPerPlatform);

      // Create pipeline run record
      const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const run: PipelineRun = {
        id: runId,
        sessionId: body.sessionId,
        status: 'running',
        totalArticles,
        completedArticles: 0,
        startedAt: new Date().toISOString(),
      };
      db.pipeline.insertPipelineRun(run);

      // Track for cancellation
      const runState = { cancelled: false };
      activeRuns.set(runId, runState);

      // Start background processing (non-blocking)
      void executePipeline(db, generator, reviewer, publisher, body, runId, runState);

      return c.json({ success: true, data: { runId, status: 'running' } });
    } catch (error) {
      return c.json({ success: false, error: formatError(error) }, 500);
    }
  });

  // POST /cancel/:runId - 取消正在运行的流水线
  app.post('/cancel/:runId', (c) => {
    const runId = c.req.param('runId');
    const runState = activeRuns.get(runId);

    if (!runState) {
      return c.json({ success: false, error: 'Pipeline run not found or already completed' }, 404);
    }

    runState.cancelled = true;
    db.pipeline.updatePipelineRun(runId, { status: 'cancelled', completedAt: new Date().toISOString() });

    return c.json({ success: true, data: { runId, status: 'cancelled' } });
  });

  // POST /feedback/:sessionId - 提交实时文章反馈（流水线运行中也可使用）
  app.post('/feedback/:sessionId', async (c) => {
    const sessionId = c.req.param('sessionId');
    const body = await c.req.json<{ feedback?: string }>();
    const feedback = body.feedback?.trim();
    if (!feedback) {
      return c.json({ success: false, error: '反馈内容不能为空' }, 400);
    }
    // Append to existing feedback so multiple submissions accumulate
    const existing = pipelineFeedback.get(sessionId);
    const combined = existing ? `${existing}\n${feedback}` : feedback;
    pipelineFeedback.set(sessionId, combined);
    console.log(`[Pipeline] Feedback received for ${sessionId}: ${feedback.substring(0, 100)}`);
    return c.json({ success: true, data: { sessionId, feedback: combined } });
  });

  // GET /feedback/:sessionId - 获取当前反馈
  app.get('/feedback/:sessionId', (c) => {
    const sessionId = c.req.param('sessionId');
    const feedback = pipelineFeedback.get(sessionId) ?? '';
    return c.json({ success: true, data: { sessionId, feedback } });
  });

  // DELETE /feedback/:sessionId - 清除反馈
  app.delete('/feedback/:sessionId', (c) => {
    const sessionId = c.req.param('sessionId');
    pipelineFeedback.delete(sessionId);
    return c.json({ success: true });
  });

  // POST /keywords/:sessionId - 补充关键词（流水线运行中也可使用）
  app.post('/keywords/:sessionId', async (c) => {
    const sessionId = c.req.param('sessionId');
    const body = await c.req.json<{ keywords?: string[]; keyword?: string }>();
    const rawKeywords = body.keywords ?? (body.keyword ? [body.keyword] : []);
    const newKeywords = rawKeywords
      .map((k) => k.trim())
      .filter((k) => k.length > 0);
    if (newKeywords.length === 0) {
      return c.json({ success: false, error: '关键词不能为空' }, 400);
    }
    const existing = pipelineKeywords.get(sessionId) ?? [];
    const merged = [...new Set([...existing, ...newKeywords])];
    pipelineKeywords.set(sessionId, merged);
    console.log(`[Pipeline] Keywords supplemented for ${sessionId}: ${newKeywords.join(', ')}`);
    return c.json({ success: true, data: { sessionId, keywords: merged } });
  });

  // GET /keywords/:sessionId - 获取已补充的关键词
  app.get('/keywords/:sessionId', (c) => {
    const sessionId = c.req.param('sessionId');
    const keywords = pipelineKeywords.get(sessionId) ?? [];
    return c.json({ success: true, data: { sessionId, keywords } });
  });

  // DELETE /keywords/:sessionId - 清除补充的关键词
  app.delete('/keywords/:sessionId', (c) => {
    const sessionId = c.req.param('sessionId');
    pipelineKeywords.delete(sessionId);
    return c.json({ success: true });
  });

  // GET /run/:runId - 获取特定流水线运行的状态
  app.get('/run/:runId', (c) => {
    const runId = c.req.param('runId');
    const run = db.pipeline.getPipelineRun(runId);
    if (!run) {
      return c.json({ success: false, error: 'Pipeline run not found' }, 404);
    }
    return c.json({ success: true, data: run });
  });

  // GET /status/:sessionId - 获取流水线状态（含运行进度）
  app.get('/status/:sessionId', (c) => {
    try {
      const sessionId = c.req.param('sessionId');
      const articles = db.articles.getArticlesBySession(sessionId);
      const latestRun = db.pipeline.getLatestPipelineRunBySession(sessionId);

      const summaries: ArticleSummary[] = articles.map((a) => {
        const review = db.reviews.getLatestReview(a.id);
        const tasks = db.publish.getPublishTasksByArticle(a.id);
        const publishedTask = tasks.find((t) => t.status === 'published');
        return {
          id: a.id,
          platform: a.platform,
          title: a.title,
          status: a.status,
          reviewScore: review?.overallScore,
          publishUrl: publishedTask?.platformPostUrl,
          createdAt: a.createdAt,
        };
      });

      const status: PipelineStatus = {
        sessionId,
        totalArticles: summaries.length,
        draft: summaries.filter((a) => a.status === 'draft').length,
        reviewing: summaries.filter((a) => a.status === 'reviewing').length,
        approved: summaries.filter((a) => a.status === 'approved').length,
        publishing: summaries.filter((a) => a.status === 'publishing').length,
        published: summaries.filter((a) => a.status === 'published').length,
        draft_saved: summaries.filter((a) => a.status === 'draft_saved').length,
        failed: summaries.filter((a) => a.status === 'failed').length,
        articles: summaries,
        run: latestRun,
      };

      return c.json({ success: true, data: status });
    } catch (error) {
      return c.json({ success: false, error: formatError(error) }, 500);
    }
  });

  return app;
}

/** Build the article execution list from planArticles or platforms × contentTypes. */
function buildArticleList(
  request: PipelineRequest,
  articlesPerPlatform: number,
): Array<{ platform: string; contentType: ArticleContentType; topic?: string; keyword?: string; contentSupplement?: string }> {
  const list: Array<{ platform: string; contentType: ArticleContentType; topic?: string; keyword?: string; contentSupplement?: string }> = [];
  const supplement = (request as any).contentSupplement as string | undefined;

  if (request.planArticles && request.planArticles.length > 0) {
    for (const pa of request.planArticles) {
      list.push({ platform: pa.platform, contentType: pa.contentType, topic: pa.topic, keyword: pa.keyword, contentSupplement: supplement });
    }
  } else {
    const contentTypes = request.contentTypes?.length ? request.contentTypes : [request.contentType];
    for (const platform of request.platforms) {
      for (let i = 0; i < articlesPerPlatform; i++) {
        list.push({ platform, contentType: contentTypes[i % contentTypes.length], contentSupplement: supplement });
      }
    }
  }

  return list;
}

/** Generate an article with up to MAX_ROUNDS review-regeneration attempts. */
async function generateArticleWithRetry(
  generator: ContentGenerator,
  reviewer: ContentReviewer,
  db: DatabaseAccess,
  request: PipelineRequest,
  item: { platform: string; contentType: ArticleContentType; topic?: string; keyword?: string; contentSupplement?: string },
  session: any,
  runState: { cancelled: boolean },
): Promise<Article | undefined> {
  let latestArticle: Article | undefined;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    if (runState.cancelled) return latestArticle;

    const reviewFeedback = latestArticle
      ? (() => {
          const r = reviewer.review(latestArticle, session);
          return { issues: r.issues, suggestions: r.suggestions, overallScore: r.overallScore };
        })()
      : undefined;

    const supplementedKeywords = pipelineKeywords.get(request.sessionId) ?? [];
    const baseKeywords = item.keyword ? [item.keyword] : [];
    const mergedKeywords = [...new Set([...baseKeywords, ...supplementedKeywords])];

    const result = await generator.generate(
      {
        sessionId: request.sessionId,
        platform: item.platform as any,
        contentType: item.contentType,
        topic: item.topic,
        keywords: mergedKeywords.length > 0 ? mergedKeywords : undefined,
        contentSupplement: item.contentSupplement,
        pipelineFeedback: pipelineFeedback.get(request.sessionId),
        generationRound: round,
        reviewFeedback,
      },
      session,
    );

    // Append enterprise contact info to article footer
    result.article = appendContactFooter(result.article, session.enterprise);
    db.articles.insertArticle(result.article);
    latestArticle = result.article;

    const review = reviewer.review(result.article, session);
    db.reviews.insertReview(review);

    if (review.passed) {
      db.articles.updateArticle(result.article.id, { status: 'approved' });
      return db.articles.getArticle(result.article.id);
    }

    db.articles.updateArticle(result.article.id, { status: 'reviewing' });
  }

  // All rounds exhausted — mark as manual_edit instead of leaving in reviewing
  // (consistent with POST /api/review/:articleId behavior)
  if (latestArticle) {
    db.articles.updateArticle(latestArticle.id, { status: 'manual_edit' });
    return db.articles.getArticle(latestArticle.id);
  }

  return latestArticle;
}

/**
 * Execute the full pipeline in the background.
 * Generates articlesPerPlatform articles per platform, cycling through content types.
 */
async function executePipeline(
  db: DatabaseAccess,
  generator: ContentGenerator,
  reviewer: ContentReviewer,
  publisher: Publisher,
  request: PipelineRequest,
  runId: string,
  runState: { cancelled: boolean },
): Promise<void> {
  const session = db.sessions.getSession(request.sessionId);
  if (!session) {
    db.pipeline.updatePipelineRun(runId, { status: 'failed', errorMessage: 'Session not found', completedAt: new Date().toISOString() });
    activeRuns.delete(runId);
    return;
  }

  const articlesPerPlatform = getArticlesPerPlatform(request.planDuration);
  const articleList = buildArticleList(request, articlesPerPlatform);
  let completed = 0;

  try {
    for (let idx = 0; idx < articleList.length; idx++) {
      if (runState.cancelled) {
        db.pipeline.updatePipelineRun(runId, { completedArticles: completed });
        activeRuns.delete(runId);
        return;
      }

      const item = articleList[idx];
      db.pipeline.updatePipelineRun(runId, { currentPlatform: item.platform, currentRound: idx + 1 });

      const latestArticle = await generateArticleWithRetry(
        generator, reviewer, db, request, item, session, runState,
      );

      if (runState.cancelled) {
        db.pipeline.updatePipelineRun(runId, { completedArticles: completed });
        activeRuns.delete(runId);
        return;
      }

      if (latestArticle && request.autoPublish) {
        const approved = db.articles.getArticle(latestArticle.id);
        if (approved && approved.status === 'approved') {
          await publishForPipeline(db, publisher, approved, request.scheduledAt);
        }
      }

      completed++;
      db.pipeline.updatePipelineRun(runId, { completedArticles: completed });
    }

    db.pipeline.updatePipelineRun(runId, { status: 'completed', completedAt: new Date().toISOString() });
  } catch (error) {
    db.pipeline.updatePipelineRun(runId, {
      status: 'failed',
      errorMessage: formatError(error),
      completedArticles: completed,
      completedAt: new Date().toISOString(),
    });
  } finally {
    activeRuns.delete(runId);
  }
}

function getArticlesPerPlatform(duration?: string): number {
  switch (duration) {
    case 'year': return 1200;
    case 'half-year': return 400;
    case 'quarter': return 160;
    default: return 1;
  }
}

// 流水线内部的发布流程：使用 createTask + publishWithRetry
async function publishForPipeline(
  db: DatabaseAccess,
  publisher: Publisher,
  article: Article,
  scheduledAt?: string,
): Promise<void> {
  const credentials = db.credentials.getCredential(article.platform);
  if (!credentials) {
    db.articles.updateArticle(article.id, { status: 'failed' });
    return;
  }

  // Use publisher.createTask to determine method (api/rpa) automatically.
  // Pass scheduledAt so the task records the intended publish time.
  const task = publisher.createTask({
    articleId: article.id,
    platform: article.platform,
    scheduledAt,
  });

  db.publish.insertPublishTask(task);
  db.articles.updateArticle(article.id, { status: 'publishing' });

  await executePublishWithHandling(
    db, publisher, task, article, credentials,
  );
}
