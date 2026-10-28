import { Hono } from 'hono';
import type { PlatformCredentials, PlatformId } from '@zemingengine/shared';
import type { AppEnv, DatabaseAccess, User } from '../db.js';
import {
  validateSyncPayload,
  buildCredentialFromSyncPayload,
  isCredentialValid,
  DEFAULT_USER_ID,
  DEFAULT_ACCOUNT_ID,
} from '../services/credential-sync-service.js';

// --- Constants ---

const MASK_MIN_LENGTH = 4;
const MASK_PREFIX_CHARS = 2;
const MASK_SUFFIX_CHARS = 2;
const MASK_MAX_STARS = 20;
const MASK_SHORT_REPLACEMENT = '****';

// --- Helpers ---

function withErrorHandler<T>(handler: (c: any) => Promise<T> | T) {
  return async (c: any) => {
    try {
      return await handler(c);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return c.json({ success: false, error: message }, 500);
    }
  };
}

function getUserId(c: any): string {
  const user = c.get('user') as User | undefined;
  return user?.id ?? DEFAULT_USER_ID;
}

/**
 * Mask sensitive credential data for API responses.
 * Shows key names but replaces values with asterisks.
 */
function maskCredentialData(data: Record<string, string>): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value.length <= MASK_MIN_LENGTH) {
      masked[key] = MASK_SHORT_REPLACEMENT;
    } else {
      masked[key] =
        value.slice(0, MASK_PREFIX_CHARS) +
        '*'.repeat(Math.min(value.length - MASK_MIN_LENGTH, MASK_MAX_STARS)) +
        value.slice(-MASK_SUFFIX_CHARS);
    }
  }
  return masked;
}

function maskCredential(cred: PlatformCredentials): PlatformCredentials {
  return { ...cred, data: maskCredentialData(cred.data) };
}

export function createCredentialRoutes(db: DatabaseAccess): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  async function handleUpsert(
    c: any,
    platform: PlatformId,
    accountId: string,
    body: any,
    userId: string,
  ) {
    const cred = { ...body, platform, accountId };
    db.credentials.upsertCredential(platform, cred as PlatformCredentials, userId);
    const stored = db.credentials.getCredential(platform, userId, accountId);
    return c.json({
      success: true,
      data: stored ? maskCredential(stored) : null,
    });
  }

  function handleDelete(c: any, platform: string, accountId: string, userId: string) {
    db.credentials.deleteCredential(platform, userId, accountId);
    return c.json({ success: true, data: { deleted: true, accountId } });
  }

  // POST /sync - Harvester 同步凭证（内部接口）
  app.post(
    '/sync',
    withErrorHandler(async (c) => {
      const body = await c.req.json() as {
        platform: string;
        platformName?: string;
        accountId?: string;
        accountName?: string;
        cookie?: string;
        cookieCount?: number;
        status?: 'active' | 'expired' | 'invalid';
      };

      const validationError = validateSyncPayload(body);
      if (validationError) {
        return c.json({ success: false, error: validationError }, 400);
      }

      const userId = getUserId(c);
      const platform = body.platform as PlatformId;
      const accountId = body.accountId || DEFAULT_ACCOUNT_ID;

      const existing = db.credentials.getCredential(platform, userId, accountId) ?? null;

      const cred = buildCredentialFromSyncPayload(body, existing, platform, accountId);

      db.credentials.upsertCredential(platform, cred, userId);
      const stored = db.credentials.getCredential(platform, userId, accountId);

      return c.json({
        success: true,
        data: stored ? maskCredential(stored) : null,
      });
    }),
  );

  // GET / - 获取所有凭据
  app.get(
    '/',
    withErrorHandler((c) => {
      const userId = getUserId(c);
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
    }),
  );

  // GET /:platform - 获取指定平台的所有账号凭据
  app.get(
    '/:platform',
    withErrorHandler((c) => {
      const platform = c.req.param('platform');
      const userId = getUserId(c);
      const accountId = c.req.query('accountId') ?? DEFAULT_ACCOUNT_ID;

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
    }),
  );

  // PUT /:platform - 保存凭据（默认账号，向后兼容）
  app.put(
    '/:platform',
    withErrorHandler(async (c) => {
      const platform = c.req.param('platform') as PlatformId;
      const userId = getUserId(c);
      const body = await c.req.json() as PlatformCredentials;
      // If body has accountId, use it; otherwise default to 'default'
      const accountId = body.accountId || DEFAULT_ACCOUNT_ID;
      return handleUpsert(c, platform, accountId, body, userId);
    }),
  );

  // PUT /:platform/:accountId - 保存指定账号的凭据
  app.put(
    '/:platform/:accountId',
    withErrorHandler(async (c) => {
      const platform = c.req.param('platform') as PlatformId;
      const accountId = c.req.param('accountId');
      const userId = getUserId(c);
      const body = await c.req.json() as PlatformCredentials;
      return handleUpsert(c, platform, accountId, body, userId);
    }),
  );

  // POST /:platform/validate - 验证凭据（默认账号，向后兼容）
  app.post(
    '/:platform/validate',
    withErrorHandler((c) => {
      const platform = c.req.param('platform') as PlatformId;
      const accountId = c.req.query('accountId') ?? DEFAULT_ACCOUNT_ID;
      const userId = getUserId(c);
      const cred = db.credentials.getCredential(platform, userId, accountId);
      if (!cred) {
        return c.json({ success: false, error: 'Credentials not found' }, 404);
      }
      const valid = isCredentialValid(cred);
      const newStatus: PlatformCredentials['status'] = valid ? 'active' : 'invalid';
      const now = new Date().toISOString();
      db.credentials.upsertCredential(platform, { ...cred, status: newStatus, lastValidatedAt: now }, userId);
      return c.json({ success: true, data: { valid, status: newStatus, lastValidatedAt: now, accountId } });
    }),
  );

  // DELETE /:platform - 删除凭据（默认账号，向后兼容）
  app.delete(
    '/:platform',
    withErrorHandler((c) => {
      const platform = c.req.param('platform');
      const accountId = c.req.query('accountId') ?? DEFAULT_ACCOUNT_ID;
      const userId = getUserId(c);
      return handleDelete(c, platform, accountId, userId);
    }),
  );

  // DELETE /:platform/:accountId - 删除指定账号凭据
  app.delete(
    '/:platform/:accountId',
    withErrorHandler((c) => {
      const platform = c.req.param('platform');
      const accountId = c.req.param('accountId');
      const userId = getUserId(c);
      return handleDelete(c, platform, accountId, userId);
    }),
  );

  return app;
}
