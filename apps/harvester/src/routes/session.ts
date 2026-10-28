/**
 * Session management routes: start, status, cookies, close.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import {
  parseCookieString,
  filterCookiesByDomain,
  cookiesToString,
  isLoginRedirectUrl,
  getAuthCookieNames,
  PLATFORM_DOMAINS,
} from '../lib/cookie-utils.js';
import {
  CREDENTIALS_DIR,
  sessions,
  remoteSessions,
  closeSession,
  upsertCredential,
  getProxyOptions,
} from '../config/index.js';
import { injectStealth } from '../lib/stealth.js';
import { PLATFORM_URLS, PLATFORM_NAMES } from '../config/platforms.js';
import type { Express, Request, Response } from 'express';

export function registerSessionRoutes(app: Express): void {
  /**
   * POST /api/session/start
   */
  app.post('/api/session/start', async (req: Request, res: Response) => {
    const { platform, accountName } = req.body;

    if (!platform || !PLATFORM_URLS[platform]) {
      return res.status(400).json({
        success: false,
        error: `Invalid platform. Supported: ${Object.keys(PLATFORM_URLS).join(', ')}`,
      });
    }

    try {
      const accountKey = accountName || 'default';
      console.log(`[Session] Starting browser for platform: ${platform}, account: ${accountKey}`);

      // Each session gets its OWN temporary profile directory to allow
      // unlimited concurrent sessions even for the same platform.
      // Previously, profiles were shared by platform (e.g. chrome-default-toutiaohao),
      // which caused "Opening in existing browser session" errors when multiple
      // sessions tried to collect cookies for the same platform simultaneously.
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const profileKey = `${accountKey}-${platform}`;
      // Use a temp directory per session under the profiles dir
      const userDataDir = path.join(
        CREDENTIALS_DIR,
        'browser-profiles',
        'sessions',
        sessionId
      );
      fs.mkdirSync(userDataDir, { recursive: true });

      // Try to seed from a base profile if one exists (optional optimization)
      const baseProfileDir = path.join(CREDENTIALS_DIR, 'browser-profiles', `chrome-${profileKey}`);
      // Note: we don't copy the base profile to keep startup fast and avoid
      // lock conflicts. Each session starts fresh — the user logs in manually.

      const headless = process.env.RPA_HEADLESS !== 'false';
      console.log(`[Session] Launching browser (headless: ${headless}) for ${platform}`);
      const context = await chromium.launchPersistentContext(userDataDir, {
        headless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-blink-features=AutomationControlled',
          '--disable-infobars',
          '--disable-features=IsolateOrigins,site-per-process,BookmarkBar',
          '--hide-crash-restore-bubble',
          '--password-store=basic',
        ],
        viewport: null,
        locale: 'zh-CN',
        timezoneId: 'Asia/Shanghai',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ...getProxyOptions(),
      });

      // 注入统一反检测脚本（覆盖 webdriver、chrome runtime、WebGL、CDP 等）
      await injectStealth(context);

      const pages = context.pages();
      const page = pages[0] || await context.newPage();
      await page.setViewportSize({ width: 1280, height: 800 });

      const loginUrl = PLATFORM_URLS[platform];
      await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

      sessions.set(sessionId, {
        browser: null,
        context,
        page,
        platform,
        accountName: accountKey,
        loginUrl,
        userDataDir,
        createdAt: new Date(),
      });

      remoteSessions.set(sessionId, { page, context, platform, accountName: accountKey, userDataDir });

      console.log(`[Session] Created ${sessionId} for ${platform} (persistent: ${userDataDir})`);

      res.json({
        success: true,
        sessionId,
        platform,
        platformName: PLATFORM_NAMES[platform],
        loginUrl,
        noVncUrl: `/remote/${sessionId}`,
        remoteUrl: `/remote/${sessionId}`,
        persistentProfile: userDataDir,
        message: `浏览器已启动，请在 noVNC 页面中完成 ${PLATFORM_NAMES[platform]} 登录`,
      });
    } catch (error: unknown) {
      const err = error as Error;
      console.error('[Session] Failed to start browser:', err);
      res.status(500).json({
        success: false,
        error: `Failed to start browser: ${err.message}`,
      });
    }
  });

  /**
   * GET /api/session/:sessionId/status
   */
  app.get('/api/session/:sessionId/status', async (req: Request, res: Response) => {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);

    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    try {
      const cookies = await session.context.cookies();
      const domains = PLATFORM_DOMAINS[session.platform] || [];
      const hasAuth = cookies.some((c) => domains.some((d) => c.domain.includes(d)));

      let authCookieFound = false;
      const authCookieNames = getAuthCookieNames(session.platform);
      if (authCookieNames.length > 0) {
        authCookieFound = cookies.some((c) => authCookieNames.includes(c.name));
      } else {
        // Fallback: check if any cookie matches the platform domain
        authCookieFound = hasAuth;
      }

      res.json({
        success: true,
        sessionId,
        platform: session.platform,
        loggedIn: authCookieFound,
        cookieCount: cookies.length,
        elapsed: Date.now() - session.createdAt.getTime(),
      });
    } catch (error: unknown) {
      const err = error as Error;
      console.error('[Session] Failed to check status:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/session/:sessionId/cookies
   */
  app.get('/api/session/:sessionId/cookies', async (req: Request, res: Response) => {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);

    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    try {
      const allCookies = await session.context.cookies();
      const domains = PLATFORM_DOMAINS[session.platform] || [];
      const platformCookies = filterCookiesByDomain(allCookies, domains);
      const cookieString = cookiesToString(platformCookies);
      const structuredCookies = platformCookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        expires: c.expires,
        httpOnly: c.httpOnly,
        secure: c.secure,
        sameSite: c.sameSite,
      }));

      const authCookieNames = getAuthCookieNames(session.platform);
      const hasAuthCookie = platformCookies.some((c) => authCookieNames.includes(c.name));

      console.log(`[Session] Extracted ${platformCookies.length} cookies for ${session.platform}, auth: ${hasAuthCookie}`);

      let autoSaved = false;
      if (hasAuthCookie && cookieString) {
        const credKey = `${session.accountName || 'default'}:${session.platform}`;
        autoSaved = upsertCredential(credKey, {
          type: 'cookie',
          data: { cookie: cookieString },
          status: 'active',
          cookieCount: platformCookies.length,
          lastValidatedAt: new Date().toISOString(),
          platformName: PLATFORM_NAMES[session.platform],
          accountName: session.accountName || 'default',
          platform: session.platform,
        });
        if (autoSaved) {
          console.log(`[Credentials] Auto-saved cookies for ${session.platform}`);
        }
      }

      res.json({
        success: true,
        sessionId,
        platform: session.platform,
        platformName: PLATFORM_NAMES[session.platform],
        loggedIn: hasAuthCookie,
        cookieString,
        cookies: structuredCookies,
        cookieCount: platformCookies.length,
        extractedAt: new Date().toISOString(),
        autoSaved,
      });
    } catch (error: unknown) {
      const err = error as Error;
      console.error('[Session] Failed to extract cookies:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/session/:sessionId/all-cookies (调试用: 返回所有域名的所有Cookie)
   */
  app.get('/api/session/:sessionId/all-cookies', async (req: Request, res: Response) => {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);

    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    try {
      const allCookies = await session.context.cookies();
      res.json({
        success: true,
        sessionId,
        totalCount: allCookies.length,
        cookies: allCookies.map(c => ({
          name: c.name,
          value: c.value.substring(0, 50) + (c.value.length > 50 ? '...' : ''),
          domain: c.domain,
          path: c.path,
          httpOnly: c.httpOnly,
          secure: c.secure,
        })),
      });
    } catch (error: unknown) {
      const err = error as Error;
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/session/:sessionId/save-cookies — 手动保存 Cookie（无论是否检测到认证Cookie）
   * 当用户确认已登录但自动检测失败时使用
   */
  app.post('/api/session/:sessionId/save-cookies', async (req: Request, res: Response) => {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);

    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    try {
      const allCookies = await session.context.cookies();
      const domains = PLATFORM_DOMAINS[session.platform] || [];
      const platformCookies = filterCookiesByDomain(allCookies, domains);
      const cookieString = cookiesToString(platformCookies);

      if (!cookieString || platformCookies.length === 0) {
        return res.status(400).json({ success: false, error: 'No cookies found for this platform' });
      }

      const authCookieNames = getAuthCookieNames(session.platform);
      const hasAuthCookie = platformCookies.some((c) => authCookieNames.includes(c.name));

      const credKey = `${session.accountName || 'default'}:${session.platform}`;
      const saved = upsertCredential(credKey, {
        type: 'cookie',
        data: { cookie: cookieString },
        status: hasAuthCookie ? 'active' : 'unknown',
        cookieCount: platformCookies.length,
        lastValidatedAt: new Date().toISOString(),
        platformName: PLATFORM_NAMES[session.platform],
        accountName: session.accountName || 'default',
        platform: session.platform,
      });

      console.log(`[Credentials] Manually saved ${platformCookies.length} cookies for ${session.platform} (auth: ${hasAuthCookie}, saved: ${saved})`);

      res.json({
        success: saved,
        sessionId,
        platform: session.platform,
        platformName: PLATFORM_NAMES[session.platform],
        cookieCount: platformCookies.length,
        hasAuthCookie,
        status: hasAuthCookie ? 'active' : 'unknown',
        savedAt: new Date().toISOString(),
      });
    } catch (error: unknown) {
      const err = error as Error;
      console.error('[Session] Failed to save cookies:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/session/:sessionId/screenshot — 获取当前页面截图（调试用）
   */
  app.get('/api/session/:sessionId/screenshot', async (req: Request, res: Response) => {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);

    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    try {
      const page = session.page;
      const screenshot = await page.screenshot({ type: 'png', fullPage: false });
      const url = page.url();
      const title = await page.title();

      res.type('image/png');
      res.setHeader('X-Page-URL', encodeURIComponent(url));
      res.setHeader('X-Page-Title', encodeURIComponent(title));
      res.send(screenshot);
    } catch (error: unknown) {
      const err = error as Error;
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/session/:sessionId/navigate — 导航到指定 URL（调试用）
   */
  app.post('/api/session/:sessionId/navigate', async (req: Request, res: Response) => {
    const { sessionId } = req.params;
    const { url } = req.body;
    const session = sessions.get(sessionId);

    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ success: false, error: 'URL is required' });
    }

    try {
      await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const title = await session.page.title();
      res.json({
        success: true,
        url: session.page.url(),
        title,
      });
    } catch (error: unknown) {
      const err = error as Error;
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/session/:sessionId/close
   */
  app.post('/api/session/:sessionId/close', async (req: Request, res: Response) => {
    const { sessionId } = req.params;

    if (!sessions.has(sessionId)) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    try {
      await closeSession(sessionId);
      console.log(`[Session] Closed ${sessionId}`);
      res.json({ success: true, sessionId, message: 'Session closed' });
    } catch (error: unknown) {
      const err = error as Error;
      console.error('[Session] Failed to close session:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });
}
