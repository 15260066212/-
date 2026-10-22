import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import { resolve } from 'node:path';
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
import { createProfileRoutes } from './routes/profiles.js';
import { createMonitorRoutes } from './routes/monitor.js';
import { createCompetitorMonitorRoutes } from './routes/competitor-monitor.js';
import { createOptimizationPlanRoutes } from './routes/optimization-plan.js';
import { createUserRoutes } from './routes/user.js';
import { createAuthRoutes } from './routes/auth.js';
import { createNodeRoutes } from './routes/nodes.js';
import { NodeRegistry } from './node-registry.js';

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
  // strict: false 让 /foo 和 /foo/ 都能匹配到同一个路由
  // 避免带尾部斜杠的请求落到静态文件中间件导致 500 错误
  const app = new Hono<AppEnv>({ strict: false });

  // Node registry (cloud deployment control)
  const nodeRegistry = new NodeRegistry();

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
    } catch (err) {
      console.warn('[ServiceContainer] Failed to insert publish log (non-critical)', { error: err instanceof Error ? err.message : String(err) });
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
  // 任务书规范端点别名：/api/article/* 与 /api/articles/* 同一处理器
  app.route('/api/article', createArticleRoutes(db));
  app.route('/api/reviews', createReviewRoutes(db));
  app.route('/api/publish', createPublishRoutes(db, publisher));
  app.route('/api/pipeline', createPipelineRoutes(db));
  app.route('/api/credentials', createCredentialRoutes(db));
  app.route('/api/cookie-harvester', createCookieHarvesterRoutes(db));
  app.route('/api/profiles', createProfileRoutes(db));
  app.route('/api/nodes', createNodeRoutes(nodeRegistry));
  app.route('/api/competitor-monitor', createCompetitorMonitorRoutes());
  app.route('/api/optimization', createOptimizationPlanRoutes(db));
  // 前端构建产物调用的是 /api/optimization-plan/*；缺这条别名会 404 返回纯文本，
  // 前端 resp.json() 解析失败后统一提示"无法连接到服务器"。
  app.route('/api/optimization-plan', createOptimizationPlanRoutes(db));

  const webDist = resolve(import.meta.dirname, '../../web/dist');
  app.use('/*', async (c, next) => {
    await next();
    try {
      c.res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    } catch {
      // 响应已中止或 status 非法时 @hono/node-server 构造 res 会抛
      // RangeError（uncaught 直接杀进程导致 pm2 重启），这里吞掉仅跳过 header
    }
  });
  app.use('/*', serveStatic({ root: webDist }));
  app.get('/*', (c) => c.header('Cache-Control', 'no-store, no-cache, must-revalidate'), serveStatic({ path: `${webDist}/index.html` }));

  return { db, app, publisher, sessionPool, reloginManager, selectorMonitor, captchaManager };
}
