/**
 * RPA endpoints: check-session, refresh-cookies, relogin, validate-selectors, detect-captcha.
 */

const { chromium } = require('playwright');
const {
  parseCookieString,
  filterCookiesByDomain,
  cookiesToString,
  isLoginRedirectUrl,
  getAuthCookieNames,
  PLATFORM_DOMAINS,
} = require('../lib/cookie-utils');
const { computeSessionValidityScore } = require('../lib/session-scoring');
const { buildSelectorValidationSummary } = require('../lib/selector-validator');
const { classifyCaptchaType } = require('../lib/captcha-classifier');
const { classifyLoginError } = require('../lib/error-classifier');
const { fingerprintGenerator, fingerprintInjector } = require('../config');
const {
  PLATFORM_URLS,
  PLATFORM_NAMES,
  CHECK_URLS,
  PLATFORM_LOGIN_REDIRECTS,
  PLATFORM_LOGIN_TEXTS,
  PLATFORM_LOGGED_IN_SELECTORS,
  LOGIN_CONFIG,
} = require('../config/platforms');

function registerRpaRoutes(app) {

/**
 * POST /api/rpa/check-session
 * 程序化检测指定平台的 Cookie 会话是否有效。
 * Body: { platform: string, cookies?: string, storageState?: string, fingerprintData?: string }
 * Returns: { success: true, valid: boolean, reason: string, finalUrl: string, pageTitle: string, screenshot: string, checks: object }
 */
app.post('/api/rpa/check-session', async (req, res) => {
  const { platform, cookies: cookieStr, storageState: storageStateStr, fingerprintData: fingerprintDataStr } = req.body;

  // 校验平台参数
  if (!platform || !PLATFORM_URLS[platform]) {
    return res.status(400).json({
      success: false,
      error: `Invalid platform. Supported: ${Object.keys(PLATFORM_URLS).join(', ')}`,
    });
  }

  const hasCookie = cookieStr && typeof cookieStr === 'string' && cookieStr.trim() !== '';
  const hasStorageState = storageStateStr && typeof storageStateStr === 'string' && storageStateStr.trim() !== '';

  if (!hasCookie && !hasStorageState) {
    return res.status(400).json({
      success: false,
      error: 'Either cookies or storageState is required',
    });
  }

  let browser = null;
  let finalUrl = '';
  let pageTitle = '';
  let screenshot = '';
  const checks = {};

  try {
    console.log(
      `[RPA] Checking session validity for platform: ${platform} ` +
      `(storageState: ${hasStorageState}, fingerprint: ${!!fingerprintDataStr})`,
    );

    // Parse fingerprint if provided, otherwise generate a new one
    let browserFingerprint = null;
    if (fingerprintDataStr && typeof fingerprintDataStr === 'string') {
      try {
        browserFingerprint = JSON.parse(fingerprintDataStr);
      } catch (e) {
        console.warn(`[RPA] Failed to parse fingerprintData, generating new one:`, e.message);
        browserFingerprint = fingerprintGenerator.getFingerprint();
      }
    } else {
      browserFingerprint = fingerprintGenerator.getFingerprint();
    }

    // 启动无头浏览器
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
    });

    // Build context with fingerprint dimensions + UA
    const fp = browserFingerprint.fingerprint;
    const contextOptions = {
      viewport: { width: fp.screen.width, height: fp.screen.height },
      userAgent: fp.navigator.userAgent,
      deviceScaleFactor: fp.screen.devicePixelRatio,
      locale: 'zh-CN',
    };

    let context;
    if (hasStorageState) {
      // Full storageState restore (cookies + localStorage + IndexedDB)
      let storageStateObj;
      try {
        storageStateObj = JSON.parse(storageStateStr);
      } catch (e) {
        storageStateObj = null;
      }

      if (storageStateObj && Array.isArray(storageStateObj.cookies)) {
        contextOptions.storageState = storageStateObj;
        context = await browser.newContext(contextOptions);
      } else {
        // Fallback to cookie string if storageState parse fails
        context = await browser.newContext(contextOptions);
        const parsedCookies = parseCookieString(cookieStr || '', platform);
        if (parsedCookies.length > 0) {
          await context.addCookies(parsedCookies);
        }
      }
    } else {
      // Legacy: cookie string only
      const parsedCookies = parseCookieString(cookieStr, platform);
      if (parsedCookies.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Failed to parse cookies from the provided string',
        });
      }
      console.log(`[RPA] Parsed ${parsedCookies.length} cookies for ${platform}`);
      context = await browser.newContext(contextOptions);
      await context.addCookies(parsedCookies);
    }

    // Inject full browser fingerprint (navigator, screen, WebGL, etc.)
    await fingerprintInjector.attachFingerprintToPlaywright(context, browserFingerprint);

    const page = await context.newPage();
    const checkUrl = CHECK_URLS[platform];

    // 导航到检测页面
    await page.goto(checkUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // 等待页面稳定 - 先等 networkidle，超时后降级等待 domcontentloaded
    try {
      await page.waitForLoadState('networkidle', { timeout: 8000 });
    } catch (e) {
      // networkidle 超时不视为错误，额外等待2秒让SPA渲染
      await page.waitForTimeout(2000);
    }

    finalUrl = page.url();
    pageTitle = await page.title().catch(() => '');

    console.log(`[RPA] ${platform} final URL: ${finalUrl}`);
    console.log(`[RPA] ${platform} page title: ${pageTitle}`);

    // --- 检测方法 1: URL 跳转检测 ---
    const platformRedirects = PLATFORM_LOGIN_REDIRECTS[platform] || ['login', 'passport', 'signin', 'register'];
    const isLoginUrl = isLoginRedirectUrl(finalUrl, platformRedirects);
    checks.urlRedirect = { result: isLoginUrl ? 'login_page' : 'ok', detail: finalUrl };

    // --- 检测方法 2: 认证 Cookie 检测 ---
    const allCookies = await context.cookies();
    const authCookieNames = getAuthCookieNames(platform);
    const hasAuthCookie = allCookies.some((c) => authCookieNames.includes(c.name));
    checks.authCookie = { result: hasAuthCookie ? 'present' : 'missing', detail: `auth cookies: ${authCookieNames.join(', ')}` };

    // --- 检测方法 3: 页面文本检测 ---
    let pageText = '';
    try {
      pageText = await page.textContent('body', { timeout: 5000 });
    } catch (e) {
      pageText = '';
    }
    const platformTexts = PLATFORM_LOGIN_TEXTS[platform] || ['请登录', '立即登录', '登录 / 注册', '登录/注册'];
    const hasLoginText = platformTexts.some((p) => pageText.includes(p));
    checks.loginText = { result: hasLoginText ? 'found' : 'not_found', detail: platformTexts.join('|') };

    // --- 检测方法 4: 平台特定元素检测 ---
    const loggedInSelectors = PLATFORM_LOGGED_IN_SELECTORS[platform] || [];
    let hasLoggedInElement = false;
    let matchedSelector = '';
    if (loggedInSelectors.length > 0) {
      for (const selector of loggedInSelectors) {
        try {
          const el = await page.$(selector);
          if (el) {
            hasLoggedInElement = true;
            matchedSelector = selector;
            break;
          }
        } catch (e) {
          // selector not found, continue
        }
      }
    }
    checks.loggedInElement = {
      result: hasLoggedInElement ? 'found' : 'not_found',
      detail: matchedSelector || loggedInSelectors.join(', '),
    };

    // --- 截图作为证据 ---
    try {
      screenshot = await page.screenshot({ type: 'jpeg', quality: 50, fullPage: false });
      screenshot = `data:image/jpeg;base64,${screenshot.toString('base64')}`;
    } catch (e) {
      console.warn(`[RPA] Screenshot failed: ${e.message}`);
    }

    // --- 综合评分判断 ---
    const { valid, score, reason } = computeSessionValidityScore({
      isLoginUrl,
      hasAuthCookie,
      hasLoginText,
      hasLoggedInElement,
      matchedSelector,
    });

    console.log(`[RPA] ${platform} session valid: ${valid}, score: ${score}, reason: ${reason}`);

    res.json({
      success: true,
      valid,
      reason,
      finalUrl,
      pageTitle,
      screenshot: screenshot || undefined,
      checks,
    });
  } catch (error) {
    console.error('[RPA] Failed to check session:', error);
    res.status(500).json({
      success: false,
      error: `Failed to check session: ${error.message}`,
    });
  } finally {
    // 确保浏览器始终被关闭
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        console.error('[RPA] Error closing browser:', e.message);
      }
    }
  }
});

// === Cookie Refresh Endpoint ===
// Visits a platform page with existing cookies / storageState / fingerprint,
// lets the platform issue fresh Set-Cookie headers, extracts the updated
// browser state (cookies + localStorage + fingerprint), and returns them.
//
// Request body (all optional, but at least one auth method required):
//   - platform: string (required)
//   - cookies: legacy cookie string
//   - storageState: full Playwright storageState JSON string (preferred)
//   - fingerprintData: browser fingerprint JSON string from fingerprint-suite
//
// Response includes:
//   - refreshedCookies: legacy cookie string (backward compatible)
//   - refreshedStorageState: full storageState JSON string
//   - refreshedFingerprintData: echo of the input fingerprint (consistent across refreshes)
app.post('/api/rpa/refresh-cookies', async (req, res) => {
  const { platform, cookies: cookieStr, storageState: storageStateStr, fingerprintData: fingerprintDataStr } = req.body;

  if (!platform || !PLATFORM_URLS[platform]) {
    return res.status(400).json({
      success: false,
      error: `Invalid platform. Supported: ${Object.keys(PLATFORM_URLS).join(', ')}`,
    });
  }

  const hasCookie = cookieStr && typeof cookieStr === 'string' && cookieStr.trim() !== '';
  const hasStorageState = storageStateStr && typeof storageStateStr === 'string' && storageStateStr.trim() !== '';

  if (!hasCookie && !hasStorageState) {
    return res.status(400).json({
      success: false,
      error: 'Either cookies or storageState is required',
    });
  }

  let browser = null;
  try {
    console.log(
      `[RPA] Refreshing cookies for platform: ${platform} ` +
      `(storageState: ${hasStorageState}, fingerprint: ${!!fingerprintDataStr})`,
    );

    // Parse fingerprint if provided, otherwise generate a new one
    let browserFingerprint = null;
    if (fingerprintDataStr && typeof fingerprintDataStr === 'string') {
      try {
        browserFingerprint = JSON.parse(fingerprintDataStr);
        console.log(`[RPA] Using persisted fingerprint for ${platform}`);
      } catch (e) {
        console.warn(`[RPA] Failed to parse fingerprintData, generating new one:`, e.message);
        browserFingerprint = fingerprintGenerator.getFingerprint();
      }
    } else {
      browserFingerprint = fingerprintGenerator.getFingerprint();
    }

    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    // Build context options: prefer storageState, fallback to cookie string
    const fp = browserFingerprint.fingerprint;
    const contextOptions = {
      viewport: { width: fp.screen.width, height: fp.screen.height },
      userAgent: fp.navigator.userAgent,
      deviceScaleFactor: fp.screen.devicePixelRatio,
      locale: 'zh-CN',
    };

    let context;
    if (hasStorageState) {
      // Full storageState restore (cookies + localStorage + IndexedDB)
      let storageStateObj;
      try {
        storageStateObj = JSON.parse(storageStateStr);
      } catch (e) {
        // Fallback: treat as legacy cookie string if JSON parse fails
        storageStateObj = null;
      }

      if (storageStateObj && Array.isArray(storageStateObj.cookies)) {
        contextOptions.storageState = storageStateObj;
        context = await browser.newContext(contextOptions);
      } else {
        context = await browser.newContext(contextOptions);
        const parsedCookies = parseCookieString(cookieStr || '', platform);
        if (parsedCookies.length > 0) {
          await context.addCookies(parsedCookies);
        }
      }
    } else {
      // Legacy: cookie string only
      context = await browser.newContext(contextOptions);
      const parsedCookies = parseCookieString(cookieStr, platform);
      if (parsedCookies.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Failed to parse cookies from the provided string',
        });
      }
      await context.addCookies(parsedCookies);
    }

    // Inject full browser fingerprint (navigator, screen, WebGL, etc.)
    await fingerprintInjector.attachFingerprintToPlaywright(context, browserFingerprint);

    const page = await context.newPage();
    const checkUrl = CHECK_URLS[platform];

    // Navigate to platform page - this triggers Set-Cookie refresh
    await page.goto(checkUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    try {
      await page.waitForLoadState('networkidle', { timeout: 10000 });
    } catch {
      await page.waitForTimeout(3000);
    }

    // Also visit the main domain to trigger root-domain cookie refresh
    const mainUrl = PLATFORM_URLS[platform];
    if (mainUrl && !mainUrl.includes(checkUrl.split('/')[2])) {
      try {
        await page.goto(mainUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(2000);
      } catch {
        // Non-critical, continue
      }
    }

    // Extract all cookies from the context (including refreshed ones)
    const allCookies = await context.cookies();
    const platformDomains = PLATFORM_DOMAINS[platform] || [];

    // Filter cookies to platform-relevant domains
    const filteredCookies = filterCookiesByDomain(allCookies, platformDomains);

    // Convert to cookie header string (legacy format)
    const refreshedCookieStr = cookiesToString(filteredCookies);

    // Extract full storageState (cookies + localStorage + IndexedDB origins)
    const storageState = await context.storageState();

    // Check if auth cookies are still present
    const authCookieNames = getAuthCookieNames(platform);
    const hasAuthCookie = filteredCookies.some((c) => authCookieNames.includes(c.name));

    // Detect if redirected to login
    const finalUrl = page.url();
    const platformRedirects = PLATFORM_LOGIN_REDIRECTS[platform] || ['login', 'passport', 'signin', 'register'];
    const isLoginUrl = isLoginRedirectUrl(finalUrl, platformRedirects);

    const valid = hasAuthCookie && !isLoginUrl;

    console.log(
      `[RPA] Cookie refresh for ${platform}: valid=${valid}, ` +
      `cookies=${filteredCookies.length}, hasAuth=${hasAuthCookie}, ` +
      `origins=${storageState.origins?.length || 0}`,
    );

    res.json({
      success: true,
      valid,
      // Legacy: plain cookie string (backward compatible)
      refreshedCookies: refreshedCookieStr,
      cookieCount: filteredCookies.length,
      // New: full storageState (cookies + localStorage + IndexedDB)
      refreshedStorageState: JSON.stringify(storageState),
      // New: fingerprint (echoed back for persistence — same fingerprint is reused)
      refreshedFingerprintData: JSON.stringify(browserFingerprint),
      hasAuthCookie,
      finalUrl,
      isLoginUrl,
      reason: valid
        ? 'Cookies refreshed successfully'
        : isLoginUrl
          ? 'Redirected to login page - cookies may be expired'
          : 'Auth cookie missing after refresh',
    });

    await context.close();
  } catch (error) {
    console.error('[RPA] Failed to refresh cookies:', error);
    res.status(500).json({
      success: false,
      error: `Failed to refresh cookies: ${error.message}`,
    });
  } finally {
    if (browser) {
      try { await browser.close(); } catch (e) {
        console.error('[RPA] Error closing browser:', e.message);
      }
    }
  }
});

// === Auto Relogin Configuration ===

/**
 * Per-platform login form selectors and flow configuration.
 * Only platforms with username/password login forms are included.
 * Platforms requiring QR code or SMS verification are NOT supported for auto-relogin.
 */
const LOGIN_CONFIG = {
  csdn: {
    loginUrl: 'https://passport.csdn.net/login',
    usernameSelector: 'input[type="text"], input[name="username"], input[placeholder*="手机"], input[placeholder*="邮箱"]',
    passwordSelector: 'input[type="password"], input[name="password"]',
    submitSelector: 'button[type="submit"], button:has-text("登录"), .btn-login, .btn-primary',
    switchToPasswordSelector: '.btn-group a:has-text("账号登录"), .tab-group a:has-text("账号登录"), a:has-text("账号登录")',
    successUrl: 'csdn.net',
    successSelectors: ['#csdn-toolbar', '.toolbar-search', '.blog-content'],
    captchaSelectors: ['.geetest', '.captcha', '#captcha', '.verify-wrap'],
    maxWaitMs: 20000,
  },
  juejin: {
    loginUrl: 'https://juejin.cn/login',
    usernameSelector: 'input[placeholder*="手机"], input[type="tel"], input[name="phone"]',
    passwordSelector: 'input[type="password"]',
    submitSelector: 'button:has-text("登录"), button.btn-login, .login-btn',
    switchToPasswordSelector: '.switch-account, a:has-text("密码登录"), .login-type:has-text("密码登录")',
    successUrl: 'juejin.cn',
    successSelectors: ['.drafts', '.publish-panel', '.entry-publish-form', '.user-avatar'],
    captchaSelectors: ['.geetest', '.captcha', '#captcha'],
    maxWaitMs: 20000,
  },
  bilibili: {
    loginUrl: 'https://passport.bilibili.com/login',
    usernameSelector: 'input[placeholder*="手机"], input[type="text"], input[name="username"]',
    passwordSelector: 'input[type="password"]',
    submitSelector: 'button:has-text("登录"), .btn-login, #login-btn',
    switchToPasswordSelector: '.login-tab:has-text("密码登录"), a:has-text("密码登录")',
    successUrl: 'bilibili.com',
    successSelectors: ['.home-container', '.user-avatar', '.h-body'],
    captchaSelectors: ['.geetest', '.captcha', '#captcha', '.nc_wrapper'],
    maxWaitMs: 20000,
  },
};

/**
 * POST /api/rpa/relogin
 *
 * Attempts automatic login for platforms with username/password forms.
 * Returns new cookies on success, or error type on failure (captcha, wrong password, etc).
 *
 * Request body:
 *   - platform: string (csdn, juejin, bilibili)
 *   - username: string
 *   - password: string
 *
 * Response:
 *   - success: boolean
 *   - cookies: string (cookie header string, only on success)
 *   - cookieCount: number
 *   - error: string (on failure)
 *   - errorType: 'captcha' | 'invalid_credentials' | 'network' | 'unsupported' | 'unknown'
 *   - screenshot: string (base64 data URI)
 *   - finalUrl: string
 */
app.post('/api/rpa/relogin', async (req, res) => {
  const { platform, username, password } = req.body;

  if (!platform || !LOGIN_CONFIG[platform]) {
    return res.status(400).json({
      success: false,
      error: `Platform '${platform}' does not support auto-relogin. Supported: ${Object.keys(LOGIN_CONFIG).join(', ')}`,
      errorType: 'unsupported',
    });
  }

  if (!username || !password) {
    return res.status(400).json({
      success: false,
      error: 'Username and password are required',
      errorType: 'invalid_credentials',
    });
  }

  const config = LOGIN_CONFIG[platform];
  let browser = null;
  let screenshot = '';

  try {
    console.log(`[RPA] Attempting auto-relogin for ${platform} (user: ${username})`);

    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.5493.5 Safari/537.36',
    });

    const page = await context.newPage();

    // Step 1: Navigate to login page
    console.log(`[RPA] Navigating to ${config.loginUrl}`);
    await page.goto(config.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for page to fully render
    try {
      await page.waitForLoadState('networkidle', { timeout: 8000 });
    } catch {
      await page.waitForTimeout(2000);
    }

    // Step 2: Switch to password login mode if needed (some platforms default to QR code)
    if (config.switchToPasswordSelector) {
      try {
        const switchBtn = await page.$(config.switchToPasswordSelector);
        if (switchBtn) {
          await switchBtn.click();
          await page.waitForTimeout(1000);
          console.log(`[RPA] Switched to password login mode for ${platform}`);
        }
      } catch (e) {
        console.log(`[RPA] No switch needed for ${platform} (or switch failed: ${e.message})`);
      }
    }

    // Step 3: Fill username and password
    const usernameInput = await page.$(config.usernameSelector);
    if (!usernameInput) {
      screenshot = await takeScreenshot(page);
      const finalUrl = page.url();
      await browser.close();
      return res.json({
        success: false,
        error: `Username input not found. The login page structure may have changed.`,
        errorType: 'unknown',
        screenshot,
        finalUrl,
      });
    }

    await usernameInput.click({ clickCount: 3 }); // Clear existing
    await usernameInput.fill(username);
    await page.waitForTimeout(500);

    const passwordInput = await page.$(config.passwordSelector);
    if (!passwordInput) {
      screenshot = await takeScreenshot(page);
      const finalUrl = page.url();
      await browser.close();
      return res.json({
        success: false,
        error: `Password input not found. The login page structure may have changed.`,
        errorType: 'unknown',
        screenshot,
        finalUrl,
      });
    }

    await passwordInput.click({ clickCount: 3 });
    await passwordInput.fill(password);
    await page.waitForTimeout(500);

    // Step 4: Check for captcha before submitting
    let captchaDetected = false;
    for (const captchaSel of config.captchaSelectors) {
      try {
        const captchaEl = await page.$(captchaSel);
        if (captchaEl && await captchaEl.isVisible()) {
          captchaDetected = true;
          break;
        }
      } catch {}
    }

    if (captchaDetected) {
      screenshot = await takeScreenshot(page);
      const finalUrl = page.url();
      await browser.close();
      console.log(`[RPA] Captcha detected for ${platform} - manual intervention required`);
      return res.json({
        success: false,
        error: 'Captcha detected during login. Manual intervention required.',
        errorType: 'captcha',
        screenshot,
        finalUrl,
      });
    }

    // Step 5: Click submit
    const submitBtn = await page.$(config.submitSelector);
    if (!submitBtn) {
      // Try pressing Enter on password field
      await passwordInput.press('Enter');
      console.log(`[RPA] Submit button not found, pressed Enter on password field for ${platform}`);
    } else {
      await submitBtn.click();
      console.log(`[RPA] Clicked submit button for ${platform}`);
    }

    // Step 6: Wait for navigation or result
    try {
      await page.waitForURL((url) => {
        const urlStr = url.toString();
        return urlStr.includes(config.successUrl) && !urlStr.includes('login');
      }, { timeout: config.maxWaitMs });
    } catch {
      // Navigation timeout - check for captcha or error messages
      await page.waitForTimeout(2000);
    }

    // Step 7: Check for captcha after submit
    for (const captchaSel of config.captchaSelectors) {
      try {
        const captchaEl = await page.$(captchaSel);
        if (captchaEl && await captchaEl.isVisible()) {
          captchaDetected = true;
          break;
        }
      } catch {}
    }

    if (captchaDetected) {
      screenshot = await takeScreenshot(page);
      const finalUrl = page.url();
      await browser.close();
      console.log(`[RPA] Post-submit captcha detected for ${platform}`);
      return res.json({
        success: false,
        error: 'Captcha appeared after login attempt. Manual intervention required.',
        errorType: 'captcha',
        screenshot,
        finalUrl,
      });
    }

    // Step 8: Verify login success
    const finalUrl = page.url();
    const isOnSuccessPage = finalUrl.includes(config.successUrl) && !finalUrl.includes('login');

    let loggedInElement = false;
    for (const sel of config.successSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          loggedInElement = true;
          break;
        }
      } catch {}
    }

    // Also check auth cookies
    const allCookies = await context.cookies();
    const authCookieNames = getAuthCookieNames(platform);
    const hasAuthCookie = allCookies.some((c) => authCookieNames.includes(c.name));

    if (isOnSuccessPage || loggedInElement || hasAuthCookie) {
      // Login successful! Extract cookies
      const domains = PLATFORM_DOMAINS[platform] || [];
      const filteredCookies = domains.length > 0
        ? filterCookiesByDomain(allCookies, domains)
        : allCookies;

      const cookieStr = cookiesToString(filteredCookies);

      // Auto-save to local credentials
      upsertCredential(platform, {
        type: 'cookie',
        data: { cookieString: cookieStr },
        status: 'active',
        cookieCount: filteredCookies.length,
        lastValidatedAt: new Date().toISOString(),
        platformName: PLATFORM_NAMES[platform],
      });

      console.log(`[RPA] Relogin successful for ${platform} (${filteredCookies.length} cookies)`);

      // Sync credentials to main server
      try {
        const syncRes = await fetch(`${MAIN_SERVER_URL}/api/credentials/${platform}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'cookie',
            data: { cookieString: cookieStr },
          }),
        });
        if (syncRes.ok) {
          console.log(`[RPA] Synced relogged credentials for ${platform} to main server`);
        }
      } catch (e) {
        console.warn(`[RPA] Failed to sync credentials: ${e.message}`);
      }

      res.json({
        success: true,
        cookies: cookieStr,
        cookieCount: filteredCookies.length,
        finalUrl,
        hasAuthCookie,
        loggedInElement,
      });
    } else {
      // Login failed - check for error messages
      let pageText = '';
      try {
        pageText = await page.textContent('body', { timeout: 5000 });
      } catch {}

      const errorType = classifyLoginError(pageText);
      const errorMessage = errorType !== 'unknown'
        ? `Login failed: ${errorType}`
        : `Login failed. URL: ${finalUrl}`;

      screenshot = await takeScreenshot(page);
      console.log(`[RPA] Relogin failed for ${platform}: ${errorMessage} (${errorType})`);

      res.json({
        success: false,
        error: errorMessage,
        errorType,
        screenshot,
        finalUrl,
      });
    }
  } catch (error) {
    console.error(`[RPA] Relogin error for ${platform}:`, error);
    res.status(500).json({
      success: false,
      error: `Relogin failed: ${error.message}`,
      errorType: error.message.includes('net::ERR') || error.message.includes('Timeout') ? 'network' : 'unknown',
    });
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        console.error('[RPA] Error closing browser:', e.message);
      }
    }
  }
});

/**
 * Take a screenshot and return as base64 data URI.
 */
async function takeScreenshot(page) {
  try {
    const buf = await page.screenshot({ type: 'jpeg', quality: 50, fullPage: false });
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch (e) {
    console.warn(`[RPA] Screenshot failed: ${e.message}`);
    return '';
  }
}

/**
 * POST /api/rpa/validate-selectors
 *
 * Validates CSS selectors against a live platform page to detect
 * structural changes before they cause publish failures.
 *
 * Request body:
 *   - platform: string (platform name)
 *   - url: string (URL to navigate to)
 *   - selectors: Array<{ selector: string, purpose: string }>
 *
 * Response:
 *   - success: boolean
 *   - platform: string
 *   - finalUrl: string
 *   - results: Array<{ selector, purpose, found, count, visible }>
 *   - summary: { total, found, missing, byPurpose }
 *   - screenshot: string (base64)
 */
app.post('/api/rpa/validate-selectors', async (req, res) => {
  const { platform, url, selectors } = req.body;

  if (!platform || !url || !Array.isArray(selectors) || selectors.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'platform, url, and selectors[] are required',
    });
  }

  let browser = null;

  try {
    console.log(`[RPA] Validating ${selectors.length} selectors for ${platform} at ${url}`);

    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.5493.5 Safari/537.36',
    });

    const page = await context.newPage();

    // Navigate to the target page
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e) {
      return res.json({
        success: false,
        platform,
        error: `Failed to navigate to ${url}: ${e.message}`,
        errorType: 'network',
      });
    }

    // Wait for page to settle
    try {
      await page.waitForLoadState('networkidle', { timeout: 8000 });
    } catch {
      await page.waitForTimeout(2000);
    }

    const finalUrl = page.url();
    let pageTitle = '';
    try {
      pageTitle = await page.title();
    } catch {}

    // Validate each selector
    const results = [];
    const seenSelectors = new Set();

    for (const { selector, purpose } of selectors) {
      // Deduplicate identical selectors
      const key = `${selector}`;
      if (seenSelectors.has(key)) continue;
      seenSelectors.add(key);

      try {
        const elements = await page.$$(selector);
        let visible = false;
        if (elements.length > 0) {
          // Check if at least one element is visible
          for (const el of elements) {
            try {
              if (await el.isVisible()) {
                visible = true;
                break;
              }
            } catch {}
          }
        }

        results.push({
          selector,
          purpose: purpose || 'unknown',
          found: elements.length > 0,
          count: elements.length,
          visible,
        });
      } catch (e) {
        results.push({
          selector,
          purpose: purpose || 'unknown',
          found: false,
          count: 0,
          visible: false,
          error: e.message,
        });
      }
    }

    // Build summary
    const summary = buildSelectorValidationSummary(results);

    const screenshot = await takeScreenshot(page);

    console.log(`[RPA] Selector validation for ${platform}: ${summary.found}/${summary.total} found, ${summary.brokenPurposes.length} broken purposes`);

    res.json({
      success: true,
      platform,
      finalUrl,
      pageTitle,
      results,
      summary,
      screenshot,
    });
  } catch (error) {
    console.error(`[RPA] Selector validation error for ${platform}:`, error);
    res.status(500).json({
      success: false,
      platform,
      error: `Validation failed: ${error.message}`,
      errorType: error.message.includes('net::ERR') || error.message.includes('Timeout') ? 'network' : 'unknown',
    });
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        console.error('[RPA] Error closing browser:', e.message);
      }
    }
  }
});

/**
 * POST /api/rpa/detect-captcha
 *
 * Detects captcha elements on a page during RPA operations.
 * Uses both platform-specific and generic captcha selectors.
 *
 * Request body:
 *   - platform: string
 *   - url: string (page to check)
 *   - cookies: string (optional, for authenticated pages)
 *
 * Response:
 *   - detected: boolean
 *   - captchaType: string
 *   - selector: string
 *   - allMatches: Array<{ selector, type, found, visible }>
 *   - screenshot: string
 */
app.post('/api/rpa/detect-captcha', async (req, res) => {
  const { platform, url, cookies } = req.body;

  if (!platform || !url) {
    return res.status(400).json({
      success: false,
      error: 'platform and url are required',
    });
  }

  // Platform-specific captcha selectors
  const PLATFORM_CAPTCHA_SELECTORS = {
    csdn: ['.geetest', '.captcha', '#captcha', '.verify-wrap', '.geetest_widget', '.geetest_slider_button'],
    zhihu: ['.geetest', '.Captcha', '#js-captcha', '.sign-container .captcha', '.verify-modal'],
    baijiahao: ['.geetest', '.captcha', '#captcha', '.verify-wrap', '.nc_wrapper'],
    toutiaohao: ['.captcha', '#captcha', '.geetest', '.verify-modality', '.captcha_container'],
    juejin: ['.geetest', '.captcha', '#captcha', '.JCaptcha'],
    xiaohongshu: ['.captcha', '#captcha', '.geetest', '.verify-container', '.captcha-modal'],
    bilibili: ['.geetest', '.captcha', '#captcha', '.nc_wrapper', '.geetest_widget'],
    sohuhao: ['.captcha', '#captcha', '.geetest'],
    wangyihao: ['.captcha', '#captcha', '.geetest', '.nc-container'],
    zhidao: ['.captcha', '#captcha', '.geetest', '.verifyCode'],
    wechat: [],
  };

  // Generic selectors that apply to all platforms
  const GENERIC_SELECTORS = [
    '.geetest_panel',
    '.geetest_widget',
    '.geetest_slider',
    'iframe[src*="captcha"]',
    'iframe[src*="verify"]',
    'img[src*="captcha"]',
    'img[src*="verify"]',
    'canvas[id*="captcha"]',
    '[class*="captcha"][class*="modal"]',
    '[class*="verify"][class*="modal"]',
    '[id*="captchaModal"]',
  ];

  const platformSelectors = PLATFORM_CAPTCHA_SELECTORS[platform] || [];
  const allSelectors = [...platformSelectors, ...GENERIC_SELECTORS];

  let browser = null;

  try {
    console.log(`[RPA] Detecting captcha for ${platform} at ${url}`);

    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.5493.5 Safari/537.36',
    });

    // Set cookies if provided (for authenticated pages)
    if (cookies) {
      const cookiePairs = cookies.split(';').map((c) => c.trim()).filter(Boolean);
      const cookieObjects = cookiePairs.map((pair) => {
        const [name, ...valueParts] = pair.split('=');
        return {
          name: name.trim(),
          value: valueParts.join('=').trim(),
          domain: new URL(url).hostname,
          path: '/',
        };
      });
      if (cookieObjects.length > 0) {
        await context.addCookies(cookieObjects);
      }
    }

    const page = await context.newPage();

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e) {
      return res.json({
        success: false,
        platform,
        error: `Failed to navigate to ${url}: ${e.message}`,
        errorType: 'network',
      });
    }

    // Wait for page to settle
    try {
      await page.waitForLoadState('networkidle', { timeout: 5000 });
    } catch {
      await page.waitForTimeout(2000);
    }

    // Check all captcha selectors
    const matches = [];
    let captchaDetected = false;
    let detectedType = 'none';
    let detectedSelector = '';

    for (const selector of allSelectors) {
      try {
        const elements = await page.$$(selector);
        if (elements.length > 0) {
          let visible = false;
          for (const el of elements) {
            try {
              if (await el.isVisible()) {
                visible = true;
                break;
              }
            } catch {}
          }

          // Classify captcha type from selector
          const type = classifyCaptchaType(selector);

          matches.push({ selector, type, found: true, count: elements.length, visible });

          if (visible && !captchaDetected) {
            captchaDetected = true;
            detectedType = type;
            detectedSelector = selector;
          }
        }
      } catch {}
    }

    const screenshot = await takeScreenshot(page);
    const finalUrl = page.url();

    console.log(`[RPA] Captcha detection for ${platform}: ${captchaDetected ? 'DETECTED' : 'none'} (${matches.length} matches)`);

    res.json({
      success: true,
      platform,
      detected: captchaDetected,
      captchaType: detectedType,
      selector: detectedSelector,
      allMatches: matches,
      finalUrl,
      screenshot,
    });
  } catch (error) {
    console.error(`[RPA] Captcha detection error for ${platform}:`, error);
    res.status(500).json({
      success: false,
      platform,
      error: `Detection failed: ${error.message}`,
    });
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        console.error('[RPA] Error closing browser:', e.message);
      }
    }
  }
});

// === Publish Endpoint ===

}

module.exports = { registerRpaRoutes };
