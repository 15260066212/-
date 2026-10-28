import { Hono } from 'hono';
import type { DatabaseAccess } from '../db.js';
import type { PlatformId } from '@zemingengine/shared';

/**
 * Maps internal PlatformId to harvester service platform identifiers.
 */
const PLATFORM_MAP: Record<PlatformId, string> = {
  weixin: 'wechat',
  zhihu: 'zhihu',
  toutiao: 'toutiaohao',
  csdn: 'csdn',
  juejin: 'juejin',
  sohu: 'sohuhao',
  netease: 'wangyihao',
  baike: 'baike',
};

/** Reverse map: harvester platform identifier → internal PlatformId. */
const REVERSE_PLATFORM_MAP: Record<string, PlatformId> = Object.fromEntries(
  Object.entries(PLATFORM_MAP).map(([k, v]) => [v, k as PlatformId]),
);

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
   * Body: { platform: PlatformId, accountName?: string }
   */
  app.post('/start', async (c) => {
    try {
      const { platform, accountName } = await c.req.json<{
        platform: PlatformId;
        accountName?: string;
      }>();
      if (!platform || !PLATFORM_MAP[platform]) {
        return c.json({ success: false, error: `Invalid platform: ${platform}` }, 400);
      }

      const harvesterPlatform = PLATFORM_MAP[platform];
      // accountName 必须透传：harvester 用它命名会话 profile
      // （chrome-{accountName}-{platform}），账号管理页按该名称匹配企业；
      // 丢失则一律落到 default，保存后永远显示未保存。
      const resp = await fetch(`${getHarvesterUrl()}/api/session/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: harvesterPlatform, accountName }),
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
      const queryPlatform = c.req.query('platform') as PlatformId | undefined;
      const accountId = c.req.query('accountId') ?? 'default';
      const brandIdStr = c.req.query('brandId');
      const brandId = brandIdStr ? Number(brandIdStr) : undefined;
      const accountName = c.req.query('accountName');

      const resp = await fetch(`${getHarvesterUrl()}/api/session/${sessionId}/cookies`);
      if (!resp.ok) {
        return c.json({ success: false, error: 'Session not found' }, 404);
      }

      const data = await resp.json();

      // Determine the internal platform ID:
      // 1. Use query param if provided and valid
      // 2. Otherwise reverse-map from harvester's platform field
      let platform: PlatformId | undefined = queryPlatform;
      if (platform && !PLATFORM_MAP[platform]) {
        platform = undefined;
      }
      if (!platform && data.platform && REVERSE_PLATFORM_MAP[data.platform]) {
        platform = REVERSE_PLATFORM_MAP[data.platform];
      }

      // If we have a valid platform and login confirmed, save cookies to credentials
      let savedToCredentials = false;
      if (platform && data.success && data.loggedIn) {
        const cred = {
          platform,
          accountId,
          brandId,
          accountName: accountName || data.accountName,
          type: 'cookie' as const,
          data: { cookie: data.cookieString },
          status: 'active' as const,
          lastValidatedAt: new Date().toISOString(),
        };
        db.credentials.upsertCredential(platform, cred);
        savedToCredentials = true;
      }

      // 保存成功后立即关闭会话：harvester 只有在 closeSession 时才会把临时
      // profile 目录持久化为 chrome-{accountName}-{platform}。不关会话的话，
      // 账号管理页（按 profile 列表判断）永远显示"未保存"。
      let profileSaved = data.profileSaved ?? false;
      let profilePath = data.profilePath ?? null;
      if (savedToCredentials) {
        try {
          const closeResp = await fetch(`${getHarvesterUrl()}/api/session/${sessionId}/close`, {
            method: 'POST',
          });
          if (closeResp.ok) {
            profileSaved = true;
          }
        } catch {
          // 关闭失败不影响本次 Cookie 保存结果
        }
      }

      return c.json({
        ...data,
        savedToCredentials,
        savedPlatform: platform ?? null,
        savedAccountId: savedToCredentials ? accountId : null,
        profileSaved,
        profilePath,
      });
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
