import { Hono } from 'hono';
import type { DatabaseAccess } from '../db.js';
import type { PlatformId } from '@zemingengine/shared';

/**
 * Maps internal PlatformId to harvester service platform identifiers.
 */
const PLATFORM_MAP: Record<PlatformId, string> = {
  weixin: 'wechat',
  zhihu: 'zhihu',
  baijia: 'baijiahao',
  toutiao: 'toutiaohao',
  csdn: 'csdn',
  juejin: 'juejin',
  bilibili: 'bilibili',
  sohu: 'sohuhao',
  netease: 'wangyihao',
  zhidao: 'zhidao',
  baike: 'baike',
};

function getHarvesterUrl(): string {
  return process.env.HARVESTER_URL || 'http://harvester:3003';
}

export function createCookieHarvesterRoutes(db: DatabaseAccess): Hono {
  const app = new Hono();

  /**
   * GET /platforms - List supported platforms for cookie harvesting.
   */
  app.get('/platforms', async (c) => {
    try {
      const resp = await fetch(`${getHarvesterUrl()}/api/platforms`);
      if (!resp.ok) {
        return c.json({ success: false, error: 'Harvester service unavailable' }, 502);
      }
      const data = await resp.json();
      return c.json(data);
    } catch {
      return c.json({ success: false, error: 'Cannot connect to harvester service' }, 502);
    }
  });

  /**
   * POST /start - Start a browser session for a platform login.
   * Body: { platform: PlatformId }
   */
  app.post('/start', async (c) => {
    try {
      const { platform } = await c.req.json<{ platform: PlatformId }>();
      if (!platform || !PLATFORM_MAP[platform]) {
        return c.json({ success: false, error: `Invalid platform: ${platform}` }, 400);
      }

      const harvesterPlatform = PLATFORM_MAP[platform];
      const resp = await fetch(`${getHarvesterUrl()}/api/session/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: harvesterPlatform }),
      });

      if (!resp.ok) {
        const err = await resp.text();
        return c.json({ success: false, error: `Harvester error: ${err}` }, 502);
      }

      const data = await resp.json();
      return c.json(data);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return c.json({ success: false, error: msg }, 500);
    }
  });

  /**
   * GET /status/:sessionId - Check login status.
   */
  app.get('/status/:sessionId', async (c) => {
    try {
      const sessionId = c.req.param('sessionId');
      const resp = await fetch(`${getHarvesterUrl()}/api/session/${sessionId}/status`);
      if (!resp.ok) {
        return c.json({ success: false, error: 'Session not found' }, 404);
      }
      const data = await resp.json();
      return c.json(data);
    } catch {
      return c.json({ success: false, error: 'Cannot connect to harvester service' }, 502);
    }
  });

  /**
   * GET /cookies/:sessionId - Extract cookies and save to credentials.
   * Query: ?platform=PlatformId&accountId=xxx&brandId=1&accountName=xxx
   */
  app.get('/cookies/:sessionId', async (c) => {
    try {
      const sessionId = c.req.param('sessionId');
      const platform = c.req.query('platform') as PlatformId;
      const accountId = c.req.query('accountId') ?? 'default';
      const brandIdStr = c.req.query('brandId');
      const brandId = brandIdStr ? Number(brandIdStr) : undefined;
      const accountName = c.req.query('accountName');

      const resp = await fetch(`${getHarvesterUrl()}/api/session/${sessionId}/cookies`);
      if (!resp.ok) {
        return c.json({ success: false, error: 'Session not found' }, 404);
      }

      const data = await resp.json();

      // If platform is provided and login confirmed, save cookies to credentials
      if (platform && PLATFORM_MAP[platform] && data.success && data.loggedIn) {
        const cred = {
          platform,
          accountId,
          brandId,
          accountName,
          type: 'cookie' as const,
          data: { cookie: data.cookieString },
          status: 'active' as const,
          lastValidatedAt: new Date().toISOString(),
        };
        db.credentials.upsertCredential(platform, cred);
        return c.json({
          ...data,
          savedToCredentials: true,
          savedPlatform: platform,
          savedAccountId: accountId,
          // Profile auto-save info (harvester saves session profile automatically)
          profileSaved: data.profileSaved ?? false,
          profilePath: data.profilePath ?? null,
        });
      }

      return c.json(data);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return c.json({ success: false, error: msg }, 500);
    }
  });

  /**
   * POST /close/:sessionId - Close browser session.
   */
  app.post('/close/:sessionId', async (c) => {
    try {
      const sessionId = c.req.param('sessionId');
      const resp = await fetch(`${getHarvesterUrl()}/api/session/${sessionId}/close`, {
        method: 'POST',
      });
      if (!resp.ok) {
        return c.json({ success: false, error: 'Session not found' }, 404);
      }
      const data = await resp.json();
      return c.json(data);
    } catch {
      return c.json({ success: false, error: 'Cannot connect to harvester service' }, 502);
    }
  });

  /**
   * GET /sessions - List active sessions.
   */
  app.get('/sessions', async (c) => {
    try {
      const resp = await fetch(`${getHarvesterUrl()}/api/sessions`);
      if (!resp.ok) {
        return c.json({ success: false, error: 'Harvester service unavailable' }, 502);
      }
      const data = await resp.json();
      return c.json(data);
    } catch {
      return c.json({ success: false, error: 'Cannot connect to harvester service' }, 502);
    }
  });

  /**
   * GET /health - Check harvester service health.
   */
  app.get('/health', async (c) => {
    try {
      const resp = await fetch(`${getHarvesterUrl()}/health`);
      if (!resp.ok) {
        return c.json({ success: false, status: 'unhealthy' }, 502);
      }
      const data = await resp.json();
      return c.json(data);
    } catch (err) {
      console.error('[cookie-harvester] health check failed:', getHarvesterUrl(), err instanceof Error ? err.message : err);
      return c.json({ success: false, status: 'unreachable' }, 502);
    }
  });

  return app;
}
