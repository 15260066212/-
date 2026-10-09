import dotenv from 'dotenv';
dotenv.config({ override: true });
import { serve } from '@hono/node-server';
import { isAIAvailable } from '@zemingengine/ai-engine';
import type { DatabaseAccess } from './db.js';
import { createServices } from './service-container.js';
import {
  startAllSchedulers,
  stopAllSchedulers,
} from './scheduler/index.js';
import { SessionHealthChecker } from './session-health/index.js';

const { db, app, publisher, reloginManager, selectorMonitor } = createServices();

const port = Number(process.env.PORT ?? 3000);

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`芯图引擎：GEO server running at http://localhost:${info.port}`);
  console.log(`AI Engine: ${isAIAvailable() ? 'Enabled' : 'Disabled (set OPENAI_API_KEY to enable)'}`);

  const healthChecker = new SessionHealthChecker(db, reloginManager);

  selectorMonitor.start();

  startAllSchedulers({
    db,
    publisher,
    healthChecker,
    executePlanTask: (task) => executePlanTask(db, task),
  });
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use.`);
    console.error(`Set a different PORT in apps/server/.env, then restart pnpm dev.`);
    process.exit(1);
  }

  console.error(err);
  process.exit(1);
});

/** Execute a single scheduled plan task: generate + review + update status. */
async function executePlanTask(db: DatabaseAccess, task: any): Promise<void> {
  console.log(`[PlanScheduler] Executing task ${task.id}: ${task.platform} / ${task.topic}`);

  const { ContentGenerator } = await import('@zemingengine/content-generator');
  const { ContentReviewer } = await import('@zemingengine/content-reviewer');

  const session = db.sessions.getSession(task.session_id);
  if (!session) {
    db.plans.updateScheduledTaskStatus(task.id, 'failed', { errorMessage: 'Session not found' });
    return;
  }

  const generator = new ContentGenerator({ fallbackMode: true });
  const reviewer = new ContentReviewer();

  const result = await generator.generate({
    sessionId: task.session_id,
    platform: task.platform,
    contentType: task.content_type,
    topic: task.topic,
    keywords: task.keyword ? [task.keyword] : undefined,
    contentSupplement: task.content_supplement || undefined,
    generationRound: 1,
  }, session);

  db.articles.insertArticle(result.article);

  const review = reviewer.review(result.article, session);
  db.reviews.insertReview(review);

  if (review.passed) {
    db.articles.updateArticle(result.article.id, { status: 'approved' });
  } else {
    db.articles.updateArticle(result.article.id, { status: 'reviewing' });
  }

  db.plans.updateScheduledTaskStatus(task.id, 'completed', { articleId: result.article.id });
  console.log(`[PlanScheduler] Task ${task.id} completed: article ${result.article.id}`);
}

async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`[Server] Received ${signal}, shutting down gracefully...`);

  stopAllSchedulers();
  selectorMonitor.stop();

  try {
    await publisher.close();
  } catch (err) {
    console.error('[Server] Error closing publisher/RPA engine:', err instanceof Error ? err.message : err);
  }

  try {
    db.close();
    console.log('[Server] Database closed');
  } catch (err) {
    console.error('[Server] Error closing database:', err instanceof Error ? err.message : err);
  }

  process.exit(0);
}

process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
