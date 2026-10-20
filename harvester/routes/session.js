/**
 * Session management routes: start, status, cookies, close.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright');
const {
  parseCookieString,
  filterCookiesByDomain,
  cookiesToString,
  isLoginRedirectUrl,
  getAuthCookieNames,
  PLATFORM_DOMAINS,
} = require('../lib/cookie-utils');
const {
  CREDENTIALS_DIR,
  sessions,
  remoteSessions,
  closeSession,
  upsertCredential,
  fingerprintGenerator,
  fingerprintInjector,
} = require('../config');
const { PLATFORM_URLS, PLATFORM_NAMES } = require('../config/platforms');

function registerSessionRoutes(app) {
  /**
   * POST /api/session/start
   */
  app.post('/api/session/start', async (req, res) => {
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
      });

      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        window.chrome = { runtime: {}, app: {}, csi: {}, loadTimes: () => {} };
        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5].map(i => ({ name: `Plugin ${i}`, filename: `plugin${i}.so` })),
        });
        Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
          parameters.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission })
            : originalQuery(parameters)
        );
      });

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

      remoteSessions.set(sessionId, { page, context, platform });

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
    } catch (error) {
      console.error('[Session] Failed to start browser:', error);
      res.status(500).json({
        success: false,
        error: `Failed to start browser: ${error.message}`,
      });
    }
  });

  /**
   * GET /api/session/:sessionId/status
   */
  app.get('/api/session/:sessionId/status', async (req, res) => {
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
      switch (session.platform) {
        case 'zhihu':
          authCookieFound = cookies.some((c) => c.name === 'z_c0');
          break;
        case 'baijiahao':
        case 'zhidao':
          authCookieFound = cookies.some((c) => c.name === 'BDUSS' || c.name === 'STOKEN');
          break;
        case 'toutiaohao':
          authCookieFound = cookies.some((c) => c.name === 'sessionid' || c.name === 's_v_web_id');
          break;
        case 'csdn':
          authCookieFound = cookies.some((c) => c.name === 'UserName' || c.name === 'UserToken' || c.name === 'C_SESSION');
          break;
        case 'juejin':
          authCookieFound = cookies.some((c) => c.name === 'sessionid' || c.name === 'sessionid_ss');
          break;
        case 'bilibili':
          authCookieFound = cookies.some((c) => c.name === 'SESSDATA' || c.name === 'bili_jct');
          break;
        case 'xiaohongshu':
          authCookieFound = cookies.some((c) => c.name === 'web_session' || c.name === 'a1');
          break;
        case 'sohuhao':
          authCookieFound = cookies.some((c) => c.name === 'SUV' || c.name === 'IPLOC');
          break;
        case 'wangyihao':
          authCookieFound = cookies.some((c) => c.name === 'NTES_CMT_USER_INFO' || c.name === 'P_INFO');
          break;
        case 'wechat':
          authCookieFound = cookies.some((c) => c.name === 'slave_user' || c.name === 'slave_sid');
          break;
        default:
          authCookieFound = hasAuth;
      }

      // Mark session as logged in for profile persistence on close
      if (authCookieFound) {
        session.loggedIn = true;
      }

      res.json({
        success: true,
        sessionId,
        platform: session.platform,
        loggedIn: authCookieFound,
        cookieCount: cookies.length,
        elapsed: Date.now() - session.createdAt.getTime(),
      });
    } catch (error) {
      console.error('[Session] Failed to check status:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/session/:sessionId/cookies
   */
  app.get('/api/session/:sessionId/cookies', async (req, res) => {
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

      // Mark session as logged in for profile persistence on close
      if (hasAuthCookie) {
        session.loggedIn = true;
      }

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

      // Compute where the persistent profile will be saved (on session close)
      const profileDirName = `chrome-${session.accountName || 'default'}-${session.platform}`;
      const profilePath = hasAuthCookie ? profileDirName : null;
      // Profile will be persisted when session is closed (see closeSession in config/index.js)
      const profileWillSave = hasAuthCookie;

      res.json({
        success: true,
        sessionId,
        platform: session.platform,
        platformName: PLATFORM_NAMES[session.platform],
        accountName: session.accountName || 'default',
        loggedIn: hasAuthCookie,
        cookieString,
        cookies: structuredCookies,
        cookieCount: platformCookies.length,
        extractedAt: new Date().toISOString(),
        autoSaved,
        profileSaved: profileWillSave,
        profilePath,
      });
    } catch (error) {
      console.error('[Session] Failed to extract cookies:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/session/:sessionId/close
   */
  app.post('/api/session/:sessionId/close', async (req, res) => {
    const { sessionId } = req.params;

    if (!sessions.has(sessionId)) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    try {
      await closeSession(sessionId);
      console.log(`[Session] Closed ${sessionId}`);
      res.json({ success: true, sessionId, message: 'Session closed' });
    } catch (error) {
      console.error('[Session] Failed to close session:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });
}

module.exports = { registerSessionRoutes };
