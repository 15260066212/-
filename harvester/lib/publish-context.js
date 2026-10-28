/**
 * Profile-first publish context creator.
 * Strategy: try persistent profile first → verify login → fallback to cookie injection.
 *
 * CommonJS version for server deployment.
 */

const { chromium } = require('playwright');
const {
  profileExists,
  launchAccountProfile,
  saveContextToAccountProfile,
} = require('./account-profiles');
const { CHECK_URLS, PLATFORM_LOGIN_REDIRECTS, PLATFORM_LOGGED_IN_SELECTORS } = require('../config/platforms');
const { isLoginRedirectUrl, getAuthCookieNames, parseCookieString } = require('./cookie-utils');

/**
 * Verify if the current context is logged in to the platform.
 * Uses 3 checks: URL redirect + selector match + auth cookie presence.
 */
async function verifyLoginState(context, platform) {
  const checkUrl = CHECK_URLS[platform];
  if (!checkUrl) return { verified: false, reason: 'No check URL' };

  try {
    const page = await context.newPage();
    await page.goto(checkUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const currentUrl = page.url();

    // Check 1: URL redirect detection
    const isLogin = isLoginRedirectUrl(currentUrl, PLATFORM_LOGIN_REDIRECTS[platform] || []);
    if (isLogin) {
      await page.close();
      return { verified: false, reason: 'Redirected to login page', url: currentUrl };
    }

    // Check 2: Selector-based detection
    const selectors = PLATFORM_LOGGED_IN_SELECTORS[platform] || [];
    let selectorMatch = false;
    for (const sel of selectors) {
      try {
        const loc = page.locator(sel).first();
        if (await loc.isVisible({ timeout: 1500 })) {
          selectorMatch = true;
          break;
        }
      } catch { /* try next */ }
    }

    // Check 3: Auth cookie detection
    const cookies = await context.cookies();
    const authNames = getAuthCookieNames(platform);
    const hasAuthCookies = authNames.length > 0 && authNames.some(name =>
      cookies.some(c => c.name === name && c.value && c.value.length > 0)
    );

    await page.close();

    const verified = selectorMatch || hasAuthCookies;
    return {
      verified,
      reason: verified ? 'Login confirmed' : 'No login indicators found',
      url: currentUrl,
      selectorMatch,
      hasAuthCookies,
    };
  } catch (e) {
    return { verified: false, reason: e.message };
  }
}

/**
 * Create an authenticated browser context for publishing.
 * Strategy: Profile first, cookie fallback.
 *
 * @param {Object} options
 * @param {string} options.platform - Platform key
 * @param {string} options.accountName - Account name (for profile lookup)
 * @param {boolean} [options.headless=true] - Headless mode
 * @param {string} [options.cookieString] - Cookie string for fallback
 * @param {string} [options.storageState] - Storage state JSON string
 * @returns {Promise<{context: Object, mode: 'profile'|'cookie'|'new', loginVerified: boolean, verification: Object, cleanup: Function}>}
 */
async function createAuthenticatedContext({
  platform,
  accountName,
  headless = true,
  cookieString = '',
  storageState = '',
}) {
  // ─── Strategy 1: Try persistent account profile first ───
  if (accountName && profileExists(platform, accountName)) {
    console.log(`[PublishContext] Trying account profile for ${platform}/${accountName}...`);
    try {
      const { context, cleanup } = await launchAccountProfile(platform, accountName, { headless });
      const verification = await verifyLoginState(context, platform);

      if (verification.verified) {
        console.log(`[PublishContext] ✅ Profile mode: login verified`);
        return {
          context,
          mode: 'profile',
          loginVerified: true,
          verification,
          cleanup,
        };
      }

      console.log(`[PublishContext] ⚠️  Profile mode: login not verified (${verification.reason}), trying cookie fallback...`);
      await cleanup();
    } catch (e) {
      console.log(`[PublishContext] ⚠️  Profile mode failed: ${e.message}, trying cookie fallback...`);
    }
  }

  // ─── Strategy 2: Cookie injection fallback ───
  if (cookieString || storageState) {
    console.log(`[PublishContext] Trying cookie injection mode...`);
    try {
      const browser = await chromium.launch({
        headless,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-dev-shm-usage',
          '--no-sandbox',
        ],
      });

      let context;
      if (storageState) {
        try {
          const stateObj = typeof storageState === 'string' ? JSON.parse(storageState) : storageState;
          context = await browser.newContext({ storageState: stateObj });
        } catch {
          context = await browser.newContext();
        }
      } else {
        context = await browser.newContext();
      }

      // Inject cookies if provided
      if (cookieString) {
        const cookies = parseCookieString(cookieString, platform);
        if (cookies.length > 0) {
          await context.addCookies(cookies);
          console.log(`[PublishContext] Injected ${cookies.length} cookies`);
        }
      }

      const verification = await verifyLoginState(context, platform);
      console.log(`[PublishContext] Cookie mode: login ${verification.verified ? 'verified' : 'not verified'} (${verification.reason})`);

      // If successful and we have an account name, save as profile for next time
      if (verification.verified && accountName) {
        console.log(`[PublishContext] Saving successful cookie session as account profile...`);
        const saved = await saveContextToAccountProfile(context, platform, accountName, CHECK_URLS[platform]);
        if (saved) {
          console.log(`[PublishContext] ✅ Profile saved for future use`);
        }
      }

      const cleanup = async () => {
        try { await context.close(); } catch { /* ignore */ }
        try { await browser.close(); } catch { /* ignore */ }
      };

      return {
        context,
        mode: 'cookie',
        loginVerified: verification.verified,
        verification,
        cleanup,
      };
    } catch (e) {
      console.error(`[PublishContext] Cookie mode failed: ${e.message}`);
      throw e;
    }
  }

  // ─── Strategy 3: No auth available, return fresh context ───
  console.log(`[PublishContext] ⚠️  No profile or cookie available, returning fresh context`);
  const browser = await chromium.launch({
    headless,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox',
    ],
  });
  const context = await browser.newContext();

  const cleanup = async () => {
    try { await context.close(); } catch { /* ignore */ }
    try { await browser.close(); } catch { /* ignore */ }
  };

  return {
    context,
    mode: 'fresh',
    loginVerified: false,
    verification: { verified: false, reason: 'No auth provided' },
    cleanup,
  };
}

module.exports = {
  createAuthenticatedContext,
  verifyLoginState,
};
