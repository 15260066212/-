/**
 * RPA routes: refresh-cookies, check-session, relogin.
 *
 * The CookieWarmer in the main server calls POST /api/rpa/refresh-cookies
 * to keep browser sessions alive. This module implements that endpoint
 * and related RPA utilities.
 */

const { chromium } = require('playwright');
const {
  CREDENTIALS_DIR,
  sessions,
  remoteSessions,
  closeSession,
  upsertCredential,
  getCredential,
  getAllCredentials,
  fingerprintGenerator,
  fingerprintInjector,
} = require('../config');
const { PLATFORM_URLS, PLATFORM_NAMES, CHECK_URLS, PLATFORM_LOGIN_REDIRECTS, PLATFORM_LOGGED_IN_SELECTORS } = require('../config/platforms');
const {
  parseCookieString,
  filterCookiesByDomain,
  cookiesToString,
  isLoginRedirectUrl,
  getAuthCookieNames,
  PLATFORM_DOMAINS,
} = require('../lib/cookie-utils');
const fs = require('fs');
const path = require('path');

function registerRpaRoutes(app) {
  /**
   * POST /api/rpa/refresh-cookies
   *
   * Refreshes cookies for a given platform by launching a browser,
   * loading existing cookies, visiting the platform's check URL,
   * extracting fresh cookies, and saving them back.
   *
   * Body: { platform: string, cookies?: string, storageState?: string, fingerprintData?: object }
   * Returns: { success: boolean, cookies?: string, cookieCount?: number, error?: string }
   */
  app.post('/api/rpa/refresh-cookies', async (req, res) => {
    const { platform, cookies: cookieString, storageState, fingerprintData } = req.body;

    if (!platform || !PLATFORM_URLS[platform]) {
      return res.status(400).json({
        success: false,
        error: `Invalid platform. Supported: ${Object.keys(PLATFORM_URLS).join(', ')}`,
      });
    }

    console.log(`[RPA] Refreshing cookies for platform: ${platform}`);

    let browser = null;
    try {
      const browserOptions = {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-blink-features=AutomationControlled',
          '--disable-infobars',
          '--password-store=basic',
        ],
      };

      browser = await chromium.launch(browserOptions);
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
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
      });

      const page = await context.newPage();

      // Load existing cookies if provided
      if (cookieString) {
        const cookieArray = parseCookieString(cookieString);
        if (cookieArray.length > 0) {
          const domains = PLATFORM_DOMAINS[platform] || [];
          const platformCookies = filterCookiesByDomain(cookieArray, domains);
          if (platformCookies.length > 0) {
            const targetDomain = domains[0] || '.zhihu.com';
            await page.goto(`https://${targetDomain.replace(/^\./, '')}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await context.addCookies(platformCookies.map(c => ({
              name: c.name,
              value: c.value,
              domain: c.domain || targetDomain,
              path: c.path || '/',
              httpOnly: c.httpOnly ?? false,
              secure: c.secure ?? false,
              sameSite: c.sameSite || 'Lax',
            })));
          }
        }
      }

      // Also try loading from storageState if provided
      if (storageState) {
        try {
          const state = typeof storageState === 'string' ? JSON.parse(storageState) : storageState;
          if (state.cookies) {
            await context.addCookies(state.cookies);
          }
        } catch (e) {
          console.log(`[RPA] Failed to parse storageState: ${e.message}`);
        }
      }

      // Try loading cookies from saved credentials
      const credKey = `default:${platform}`;
      const savedCred = getCredential(credKey);
      if (savedCred && savedCred.data && savedCred.data.cookie) {
        const savedCookieArray = parseCookieString(savedCred.data.cookie);
        const domains = PLATFORM_DOMAINS[platform] || [];
        const platformSavedCookies = filterCookiesByDomain(savedCookieArray, domains);
        if (platformSavedCookies.length > 0) {
          const targetDomain = domains[0] || '.zhihu.com';
          await page.goto(`https://${targetDomain.replace(/^\./, '')}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
          await context.addCookies(platformSavedCookies.map(c => ({
            name: c.name,
            value: c.value,
            domain: c.domain || targetDomain,
            path: c.path || '/',
            httpOnly: c.httpOnly ?? false,
            secure: c.secure ?? false,
            sameSite: c.sameSite || 'Lax',
          })));
        }
      }

      // Visit the platform's check URL to refresh cookies
      const checkUrl = CHECK_URLS[platform] || PLATFORM_URLS[platform];
      console.log(`[RPA] Visiting ${checkUrl} for ${platform}`);
      await page.goto(checkUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);

      const currentUrl = page.url();
      const loginRedirectPatterns = PLATFORM_LOGIN_REDIRECTS[platform] || ['login'];
      const isRedirected = isLoginRedirectUrl(currentUrl, loginRedirectPatterns);

      if (isRedirected) {
        console.log(`[RPA] Session expired for ${platform} (redirected to: ${currentUrl})`);
        await browser.close();

        // Update credential status to expired
        if (savedCred) {
          upsertCredential(credKey, {
            ...savedCred,
            status: 'expired',
            lastValidatedAt: new Date().toISOString(),
          });
        }

        return res.json({
          success: false,
          expired: true,
          error: `Session expired for ${platform}`,
          redirectUrl: currentUrl,
        });
      }

      // Extract fresh cookies
      const allCookies = await context.cookies();
      const domains = PLATFORM_DOMAINS[platform] || [];
      const platformCookies = filterCookiesByDomain(allCookies, domains);
      const freshCookieString = cookiesToString(platformCookies);

      // Check if auth cookies are present
      const authCookieNames = getAuthCookieNames(platform);
      const hasAuthCookie = platformCookies.some(c => authCookieNames.includes(c.name));

      console.log(`[RPA] Cookie refresh for ${platform}: ${platformCookies.length} cookies, auth: ${hasAuthCookie}`);

      // Save refreshed cookies
      if (hasAuthCookie && freshCookieString) {
        upsertCredential(credKey, {
          type: 'cookie',
          data: { cookie: freshCookieString },
          status: 'active',
          cookieCount: platformCookies.length,
          lastValidatedAt: new Date().toISOString(),
          platformName: PLATFORM_NAMES[platform],
          accountName: 'default',
          platform: platform,
        });
        console.log(`[RPA] Saved refreshed cookies for ${platform}`);
      }

      await browser.close();

      return res.json({
        success: hasAuthCookie,
        expired: !hasAuthCookie,
        cookies: freshCookieString,
        cookieCount: platformCookies.length,
        hasAuthCookie,
        platform,
        checkedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error(`[RPA] Cookie refresh failed for ${platform}:`, error.message);
      if (browser) {
        try { await browser.close(); } catch (e) {}
      }
      return res.status(500).json({
        success: false,
        error: `Cookie refresh failed: ${error.message}`,
      });
    }
  });

  /**
   * POST /api/rpa/check-session
   *
   * Checks if a session is still valid for the given platform.
   * Does not launch a browser — only checks saved credential status.
   *
   * Body: { platform: string }
   */
  app.post('/api/rpa/check-session', async (req, res) => {
    const { platform } = req.body;

    if (!platform) {
      return res.status(400).json({ success: false, error: 'Platform is required' });
    }

    const credKey = `default:${platform}`;
    const cred = getCredential(credKey);

    if (!cred) {
      return res.json({
        success: true,
        platform,
        status: 'not_found',
        message: `No credentials found for ${platform}`,
      });
    }

    const lastValidated = cred.lastValidatedAt ? new Date(cred.lastValidatedAt) : null;
    const hoursSinceValidation = lastValidated
      ? (Date.now() - lastValidated.getTime()) / (1000 * 60 * 60)
      : null;

    return res.json({
      success: true,
      platform,
      status: cred.status || 'unknown',
      cookieCount: cred.cookieCount || 0,
      lastValidatedAt: cred.lastValidatedAt,
      hoursSinceValidation,
      accountName: cred.accountName || 'default',
    });
  });

  /**
   * POST /api/rpa/relogin
   *
   * Attempts to re-login for platforms that support automatic login.
   * Currently only csdn, juejin, bilibili support auto-relogin.
   *
   * Body: { platform: string, username?: string, password?: string }
   */
  app.post('/api/rpa/relogin', async (req, res) => {
    const { platform, username, password } = req.body;

    if (!platform) {
      return res.status(400).json({ success: false, error: 'Platform is required' });
    }

    const autoLoginPlatforms = ['csdn', 'juejin', 'bilibili'];
    if (!autoLoginPlatforms.includes(platform)) {
      return res.json({
        success: false,
        manualLoginRequired: true,
        error: `Automatic re-login not supported for ${platform}. Please use the session start API to log in manually.`,
        supportedPlatforms: autoLoginPlatforms,
      });
    }

    // For platforms that support auto-relogin, we would need the credentials
    // from the credentials store and the LOGIN_CONFIG from platforms.js
    return res.json({
      success: false,
      error: 'Auto-relogin not yet implemented. Please use POST /api/session/start to start a browser session for manual login.',
      platform,
    });
  });

  /**
   * GET /api/rpa/credentials/:platform
   *
   * Returns the credential status for a given platform.
   */
  app.get('/api/rpa/credentials/:platform', (req, res) => {
    const { platform } = req.params;
    const credKey = `default:${platform}`;
    const cred = getCredential(credKey);

    if (!cred) {
      return res.json({
        success: true,
        platform,
        status: 'not_found',
      });
    }

    // Don't return the actual cookie value for security
    res.json({
      success: true,
      platform,
      status: cred.status,
      cookieCount: cred.cookieCount,
      lastValidatedAt: cred.lastValidatedAt,
      accountName: cred.accountName,
      platformName: cred.platformName,
    });
  });

  /**
   * GET /api/rpa/credentials
   *
   * Returns the status of all credentials.
   */
  app.get('/api/rpa/credentials', (req, res) => {
    const allCreds = getAllCredentials();
    const result = {};

    for (const [key, cred] of Object.entries(allCreds)) {
      result[key] = {
        status: cred.status,
        cookieCount: cred.cookieCount,
        lastValidatedAt: cred.lastValidatedAt,
        accountName: cred.accountName,
        platform: cred.platform,
        platformName: cred.platformName,
      };
    }

    res.json({
      success: true,
      credentials: result,
    });
  });
}

module.exports = { registerRpaRoutes };
