/**
 * Platform listing, session listing, credentials CRUD, and health check.
 */

import {
  sessions,
  loadCredentials,
  getCredential,
  upsertCredential,
  deleteCredential,
  getAllCredentials,
  mainServerClient,
} from '../config/index.js';
import { createCookieCredential } from '../lib/credential-model.js';
import { PLATFORM_URLS, PLATFORM_NAMES } from '../config/platforms.js';
import type { Express, Request, Response } from 'express';

export function registerInfoRoutes(app: Express): void {
  /**
   * GET /api/platforms
   */
  app.get('/api/platforms', (req: Request, res: Response) => {
    const creds = loadCredentials();
    const platforms = Object.entries(PLATFORM_URLS).map(([id, url]) => ({
      id,
      name: PLATFORM_NAMES[id],
      loginUrl: url,
      hasCredentials: !!(creds[id] && creds[id].status === 'active'),
    }));

    res.json({ success: true, platforms, count: platforms.length });
  });

  /**
   * GET /api/sessions
   */
  app.get('/api/sessions', (req: Request, res: Response) => {
    const activeSessions = Array.from(sessions.entries()).map(([id, s]) => ({
      sessionId: id,
      platform: s.platform,
      platformName: PLATFORM_NAMES[s.platform],
      createdAt: s.createdAt.toISOString(),
      elapsed: Date.now() - s.createdAt.getTime(),
    }));

    res.json({ success: true, sessions: activeSessions, count: activeSessions.length });
  });

  /**
   * GET /api/credentials
   */
  app.get('/api/credentials', (req: Request, res: Response) => {
    const creds = loadCredentials();
    const list = Object.values(creds).map((c) => ({
      platform: c.platform,
      platformName: c.platformName || PLATFORM_NAMES[c.platform] || c.platform,
      type: c.type,
      status: c.status,
      cookieCount: c.cookieCount || 0,
      updatedAt: c.updatedAt,
      lastValidatedAt: c.lastValidatedAt,
      hasCookie: !!(c.data && c.data.cookie),
    }));

    res.json({ success: true, data: list, count: list.length });
  });

  /**
   * GET /api/credentials/:platform
   */
  app.get('/api/credentials/:platform', (req: Request, res: Response) => {
    const { platform } = req.params;
    const cred = getCredential(platform);
    if (!cred) {
      return res.status(404).json({ success: false, error: 'Credentials not found' });
    }
    res.json({ success: true, data: cred });
  });

  /**
   * PUT /api/credentials/:platform
   */
  app.put('/api/credentials/:platform', (req: Request, res: Response) => {
    const { platform } = req.params;
    if (!PLATFORM_URLS[platform]) {
      return res.status(400).json({ success: false, error: `Invalid platform: ${platform}` });
    }

    const { type, data, status } = req.body;
    const saved = upsertCredential(platform, {
      type: type || 'cookie',
      data: data || {},
      status: status || 'active',
      cookieCount: (data && data.cookie) ? data.cookie.split(';').length : 0,
      lastValidatedAt: new Date().toISOString(),
      platformName: PLATFORM_NAMES[platform],
    });

    if (saved) {
      res.json({ success: true, data: { platform, status: status || 'active', saved: true } });
    } else {
      res.status(500).json({ success: false, error: 'Failed to save credentials' });
    }
  });

  /**
   * DELETE /api/credentials/:platform
   */
  app.delete('/api/credentials/:platform', (req: Request, res: Response) => {
    const { platform } = req.params;
    const deleted = deleteCredential(platform);
    if (deleted) {
      res.json({ success: true, data: { deleted: true } });
    } else {
      res.status(404).json({ success: false, error: 'Credentials not found' });
    }
  });

  /**
   * POST /api/credentials/sync
   *
   * 把本地全部 Cookie 凭据推送到主 server。
   * 走 POST /api/credentials/sync（带 accountId 的 ACL 接口）；
   * 旧实现用 PUT /api/credentials/{key}，key 形如 `default:csdn` 会被主 server 判为非法平台名。
   */
  app.post('/api/credentials/sync', async (req: Request, res: Response) => {
    try {
      const creds = getAllCredentials();
      const payloads = Object.values(creds)
        .filter((cred) => cred.data?.cookie)
        .map((cred) =>
          createCookieCredential({
            platform: cred.platform,
            platformName: cred.platformName || PLATFORM_NAMES[cred.platform],
            accountName: cred.accountName || 'default',
            cookie: cred.data!.cookie,
            cookieCount: cred.cookieCount || 0,
            status: (cred.status as 'active' | 'expired' | 'invalid') || 'active',
          }),
        );

      const missing = Object.values(creds)
        .filter((cred) => !cred.data?.cookie)
        .map((cred) => ({ platform: cred.platform, success: false, error: 'No cookie data' }));

      const result = await mainServerClient.syncAllCredentials(payloads);
      const results = [...result.results, ...missing];
      const succeeded = results.filter((r) => r.success).length;

      console.log(`[Sync] ${succeeded}/${results.length} credentials synced to main server`);
      res.json({ success: true, synced: succeeded, total: results.length, results });
    } catch (error: unknown) {
      const err = error as Error;
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * GET /health
   */
  app.get('/health', (req: Request, res: Response) => {
    const creds = loadCredentials();
    res.json({
      success: true,
      status: 'healthy',
      activeSessions: sessions.size,
      savedCredentials: Object.keys(creds).length,
      uptime: process.uptime(),
    });
  });
}
