import { Hono } from 'hono';
import type { PlatformCredentials, PlatformId } from '@zemingengine/shared';
import type { AppEnv, DatabaseAccess, User } from '../db.js';

/**
 * Mask sensitive credential data for API responses.
 * Shows key names but replaces values with asterisks.
 */
function maskCredentialData(data: Record<string, string>): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value.length <= 4) {
      masked[key] = '****';
    } else {
      masked[key] = value.slice(0, 2) + '*'.repeat(Math.min(value.length - 4, 20)) + value.slice(-2);
    }
  }
  return masked;
}

function maskCredential(cred: PlatformCredentials): PlatformCredentials {
  return { ...cred, data: maskCredentialData(cred.data) };
}

export function createCredentialRoutes(db: DatabaseAccess): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // GET / - 获取所有凭据（支持按 brandId / platform 筛选）
  app.get('/', (c) => {
    try {
      const user = c.get('user') as User | undefined;
      const userId = user?.id ?? 'user_default';
      const brandId = c.req.query('brandId');
      const platform = c.req.query('platform');

      let credentials: PlatformCredentials[];
      if (brandId) {
        credentials = db.credentials.getCredentialsByBrand(Number(brandId), userId);
      } else if (platform) {
        credentials = db.credentials.getCredentialsByPlatform(platform, userId);
      } else {
        credentials = db.credentials.getAllCredentials(userId);
      }

      const masked = credentials.map((cred) => maskCredential(cred));
      return c.json({ success: true, data: masked });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return c.json({ success: false, error: message }, 500);
    }
  });

  // GET /:platform - 获取指定平台的所有账号凭据
  app.get('/:platform', (c) => {
    try {
      const platform = c.req.param('platform');
      const user = c.get('user') as User | undefined;
      const userId = user?.id ?? 'user_default';
      const accountId = c.req.query('accountId') ?? 'default';

      // Backward compat: if no accountId query, return all accounts for the platform
      if (!c.req.query('accountId')) {
        const all = db.credentials.getCredentialsByPlatform(platform, userId);
        if (all.length === 0) {
          return c.json({ success: false, error: 'Credentials not found' }, 404);
        }
        return c.json({
          success: true,
          data: all.map((cred) => maskCredential(cred)),
        });
      }

      const cred = db.credentials.getCredential(platform, userId, accountId);
      if (!cred) {
        return c.json({ success: false, error: 'Credentials not found' }, 404);
      }
      return c.json({
        success: true,
        data: maskCredential(cred),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return c.json({ success: false, error: message }, 500);
    }
  });

  // PUT /:platform - 保存凭据（默认账号，向后兼容）
  app.put('/:platform', async (c) => {
    try {
      const platform = c.req.param('platform') as PlatformId;
      const user = c.get('user') as User | undefined;
      const userId = user?.id ?? 'user_default';
      const body = await c.req.json<PlatformCredentials>();
      // If body has accountId, use it; otherwise default to 'default'
      const accountId = body.accountId || 'default';
      const cred: PlatformCredentials = { ...body, platform, accountId };
      db.credentials.upsertCredential(platform, cred, userId);
      const stored = db.credentials.getCredential(platform, userId, accountId);
      return c.json({
        success: true,
        data: stored ? maskCredential(stored) : stored,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return c.json({ success: false, error: message }, 500);
    }
  });

  // PUT /:platform/:accountId - 保存指定账号的凭据
  app.put('/:platform/:accountId', async (c) => {
    try {
      const platform = c.req.param('platform') as PlatformId;
      const accountId = c.req.param('accountId');
      const user = c.get('user') as User | undefined;
      const userId = user?.id ?? 'user_default';
      const body = await c.req.json<PlatformCredentials>();
      const cred: PlatformCredentials = { ...body, platform, accountId };
      db.credentials.upsertCredential(platform, cred, userId);
      const stored = db.credentials.getCredential(platform, userId, accountId);
      return c.json({
        success: true,
        data: stored ? maskCredential(stored) : stored,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return c.json({ success: false, error: message }, 500);
    }
  });

  // POST /:platform/validate - 验证凭据（默认账号，向后兼容）
  app.post('/:platform/validate', (c) => {
    try {
      const platform = c.req.param('platform') as PlatformId;
      const accountId = c.req.query('accountId') ?? 'default';
      const user = c.get('user') as User | undefined;
      const userId = user?.id ?? 'user_default';
      const cred = db.credentials.getCredential(platform, userId, accountId);
      if (!cred) {
        return c.json({ success: false, error: 'Credentials not found' }, 404);
      }
      const valid = Boolean(cred.data && Object.keys(cred.data).length > 0);
      const newStatus: PlatformCredentials['status'] = valid ? 'active' : 'invalid';
      const now = new Date().toISOString();
      db.credentials.upsertCredential(platform, { ...cred, status: newStatus, lastValidatedAt: now }, userId);
      return c.json({ success: true, data: { valid, status: newStatus, lastValidatedAt: now, accountId } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return c.json({ success: false, error: message }, 500);
    }
  });

  // DELETE /:platform - 删除凭据（默认账号，向后兼容）
  app.delete('/:platform', (c) => {
    try {
      const platform = c.req.param('platform');
      const accountId = c.req.query('accountId') ?? 'default';
      const user = c.get('user') as User | undefined;
      const userId = user?.id ?? 'user_default';
      db.credentials.deleteCredential(platform, userId, accountId);
      return c.json({ success: true, data: { deleted: true, accountId } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return c.json({ success: false, error: message }, 500);
    }
  });

  // DELETE /:platform/:accountId - 删除指定账号凭据
  app.delete('/:platform/:accountId', (c) => {
    try {
      const platform = c.req.param('platform');
      const accountId = c.req.param('accountId');
      const user = c.get('user') as User | undefined;
      const userId = user?.id ?? 'user_default';
      db.credentials.deleteCredential(platform, userId, accountId);
      return c.json({ success: true, data: { deleted: true, accountId } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return c.json({ success: false, error: message }, 500);
    }
  });

  return app;
}
