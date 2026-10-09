import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { Publisher, RPAEngine } from '@zemingengine/publisher';
import type { PublishLog } from '@zemingengine/shared';
import { isAIAvailable } from '@zemingengine/ai-engine';
import type { AppEnv } from './db.js';
import { CachedDatabaseAccess } from './cached-db.js';
import { SessionPoolAdapter } from './session-pool-adapter.js';
import { SessionHealthChecker, ReloginManager, SelectorMonitor, CaptchaManager } from './session-health/index.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { rateLimiter } from './middleware/rate-limit.js';
import { createSessionRoutes } from './routes/session.js';
import { createMessageRoutes } from './routes/message.js';
import { createScrapeRoutes } from './routes/scrape.js';
import { createImportRoutes } from './routes/import.js';
import { createManualRoutes } from './routes/manual.js';
import { createArticleRoutes } from './routes/article.js';
import { createReviewRoutes } from './routes/review.js';
import { createPublishRoutes } from './routes/publish.js';
import { createPipelineRoutes } from './routes/pipeline.js';
import { createCredentialRoutes } from './routes/credentials.js';
import { createCookieHarvesterRoutes } from './routes/cookie-harvester.js';
import { createMonitorRoutes } from './routes/monitor.js';
import { createCompetitorMonitorRoutes } from './routes/competitor-monitor.js';
import { createOptimizationPlanRoutes } from './routes/optimization-plan.js';
import { createUserRoutes } from './routes/user.js';
import { createAuthRoutes } from './routes/auth.js';

export interface ServiceContainer {
  db: CachedDatabaseAccess;
  app: Hono<AppEnv>;
  publisher: Publisher;
  sessionPool: SessionPoolAdapter;
  reloginManager: ReloginManager;
  selectorMonitor: SelectorMonitor;
  captchaManager: CaptchaManager;
}

/** Create and wire all services, mount routes, return the container. */
export function createServices(): ServiceContainer {
  const db = CachedDatabaseAccess.create();
  const app = new Hono<AppEnv>();

  app.use('*', logger());

  const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? 'http://localhost:5174,http://127.0.0.1:5174')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.use('*', cors({
    origin: allowedOrigins,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
    credentials: true,
  }));

  app.use('/api/*', rateLimiter());
  app.use('*', createAuthMiddleware(db));

  const sessionPool = new SessionPoolAdapter(db);
  const rpaEngine = new RPAEngine(sessionPool);
  const publisher = Publisher.createDefault(rpaEngine);
  const reloginManager = new ReloginManager(db);
  const selectorMonitor = new SelectorMonitor(db);
  const captchaManager = new CaptchaManager(db);

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

  // Health & cache endpoints
  app.get('/api/health', (c) => {
    const dbHealth = db.healthCheck();
    const cacheStats = db.getCache().stats();
    return c.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      aiEnabled: isAIAvailable(),
      database: {
        healthy: dbHealth.healthy,
        tables: dbHealth.details.tables,
        tableExists: dbHealth.details.tableExists,
        walSize: dbHealth.details.walSize,
      },
      cache: {
        entries: cacheStats.entries,
        hits: cacheStats.hits,
        misses: cacheStats.misses,
        hitRate: cacheStats.hitRate,
        evictions: cacheStats.evictions,
      },
    });
  });

  app.get('/api/cache/stats', (c) => {
    const stats = db.getCache().stats();
    return c.json({ success: true, data: stats });
  });

  app.delete('/api/cache', (c) => {
    db.getCache().clear();
    console.log('[Server] Cache cleared by request');
    return c.json({ success: true, message: 'Cache cleared' });
  });

  // Mount routes
  app.route('/api/monitor', createMonitorRoutes(db, reloginManager, selectorMonitor, captchaManager));
  app.route('/api/auth', createAuthRoutes(db));
  app.route('/api/users', createUserRoutes(db));
  app.route('/api/session', createSessionRoutes(db));
  app.route('/api/session', createMessageRoutes(db));
  app.route('/api/session', createScrapeRoutes(db));
  app.route('/api/session', createImportRoutes(db));
  app.route('/api/session', createManualRoutes(db));
  app.route('/api/articles', createArticleRoutes(db));
  app.route('/api/reviews', createReviewRoutes(db));
  app.route('/api/publish', createPublishRoutes(db, publisher));
  app.route('/api/pipeline', createPipelineRoutes(db));
  app.route('/api/credentials', createCredentialRoutes(db));
  app.route('/api/cookie-harvester', createCookieHarvesterRoutes(db));
  app.route('/api/competitor-monitor', createCompetitorMonitorRoutes());
  app.route('/api/optimization', createOptimizationPlanRoutes(db));

  return { db, app, publisher, sessionPool, reloginManager, selectorMonitor, captchaManager };
}
