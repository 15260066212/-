/**
 * Authenticated browser context launcher for publishing.
 *
 * Strategy: profile-first, cookie-as-fallback
 * 1. Try launching with the account's persistent profile (most reliable)
 * 2. If profile has valid login state, use it directly
 * 3. If no profile or profile session expired, fall back to cookie injection
 * 4. After successful publish with cookie injection, optionally save as profile
 *
 * This replaces the old pattern of always launching a fresh browser + addCookies.
 */

import type { BrowserContext, Page } from 'playwright';
import {
  launchAccountProfile,
  closeProfileContext,
  profileExists,
  getAccountProfileDir,
} from './account-profiles.js';
import { parseCookieString, PLATFORM_DOMAINS, isLoginRedirectUrl, getAuthCookieNames } from './cookie-utils.js';
import { CHECK_URLS, PLATFORM_LOGGED_IN_SELECTORS, PLATFORM_LOGIN_REDIRECTS } from '../config/platforms.js';
import { getProxyOptions } from '../config/index.js';
import { injectStealth } from './stealth.js';

export interface AuthContextOptions {
  platform: string;
  accountName: string;
  headless?: boolean;
  cookieString?: string;
  storageState?: string;
  /** If true and we had to fall back to cookies, save the session into the profile after verification */
  saveToProfile?: boolean;
  viewport?: { width: number; height: number };
  userAgent?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Navigation timeout for login state verification (ms). */
const VERIFY_NAV_TIMEOUT_MS = 20000;
/** Timeout for selector visibility check during login verification (ms). */
const VERIFY_SELECTOR_TIMEOUT_MS = 3000;
/** Navigation timeout for profile init during save (ms). */
const SAVE_NAV_TIMEOUT_MS = 15000;
/** Browser launch arguments for anti-detection and stability. */
const BROWSER_LAUNCH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-dev-shm-usage',
  '--no-sandbox',
];

export interface AuthContextResult {
  context: BrowserContext;
  /** Whether we're using a persistent profile (true) or cookie-injected fresh context (false) */
  mode: 'profile' | 'cookie';
  /** Whether the login state was verified (not just launched) */
  loginVerified: boolean;
  /** Cleanup function — caller MUST call this when done */
  cleanup: () => Promise<void>;
  profileDir?: string;
}

/**
 * Create an authenticated browser context for publishing.
 *
 * Priority: persistent profile → cookie injection → fail
 */
export async function createAuthenticatedContext(
  options: AuthContextOptions,
): Promise<AuthContextResult> {
  const {
    platform,
    accountName,
    headless = true,
    cookieString = '',
    storageState = '',
    saveToProfile = true,
    viewport = { width: 1280, height: 800 },
    userAgent,
  } = options;

  // ─── Attempt 1: Persistent profile ────────────────────────────────────────
  const hasProfile = profileExists(platform, accountName);

  if (hasProfile) {
    try {
      const { context, profileDir } = await launchAccountProfile(platform, accountName, {
        headless,
        viewport,
        userAgent,
      });

      // Verify login state
      const loggedIn = await verifyLoginState(context, platform);
      if (loggedIn) {
        return {
          context,
          mode: 'profile',
          loginVerified: true,
          profileDir,
          cleanup: async () => {
            await closeProfileContext(context);
          },
        };
      }

      // Profile exists but login state not verified — close and try cookies
      await closeProfileContext(context);
    } catch {
      /* profile launch failed, fall through to cookies */
    }
  }

  // ─── Attempt 2: Cookie injection ──────────────────────────────────────────
  if (cookieString || storageState) {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({
      headless,
      args: BROWSER_LAUNCH_ARGS,
      ...getProxyOptions(),
    });

    const context = await browser.newContext({
      viewport,
      userAgent,
      locale: 'zh-CN',
    });
    await injectStealth(context);

    // Inject cookies
    if (storageState) {
      try {
        const state = JSON.parse(storageState);
        if (state.cookies) {
          await context.addCookies(state.cookies);
        }
      } catch { /* invalid storageState, try cookie string */ }
    }

    if (cookieString) {
      const domain = PLATFORM_DOMAINS[platform]?.[0]
        ? `.${PLATFORM_DOMAINS[platform][0].replace(/^\./, '')}`
        : '';
      const cookies = parseCookieString(cookieString, domain);
      if (cookies.length > 0) {
        await context.addCookies(cookies);
      }
    }

    return {
      context,
      mode: 'cookie',
      loginVerified: false, // not verified yet, caller can check
      cleanup: async () => {
        try {
          await context.close();
          await browser.close();
        } catch { /* ignore */ }
      },
    };
  }

  // ─── Both failed ──────────────────────────────────────────────────────────
  throw new Error(
    `No valid authentication for ${platform}/${accountName}. ` +
    'Neither profile nor cookie credentials available.',
  );
}

/**
 * Verify login state for a context by navigating to the platform's check URL.
 * Returns true if the user appears to be logged in.
 */
export async function verifyLoginState(
  context: BrowserContext,
  platform: string,
): Promise<boolean> {
  const checkUrl = CHECK_URLS[platform];
  if (!checkUrl) return false;

  let page: Page | null = null;
  try {
    page = await context.newPage();
    await page.goto(checkUrl, { waitUntil: 'domcontentloaded', timeout: VERIFY_NAV_TIMEOUT_MS });
    const currentUrl = page.url();

    if (isLoginRedirectUrl(currentUrl, PLATFORM_LOGIN_REDIRECTS[platform] || [])) {
      return false;
    }

    const selectors = PLATFORM_LOGGED_IN_SELECTORS[platform] || [];
    if (selectors.length === 0) {
      return true; // no selectors defined, trust URL check
    }

    // Try selector-based detection first (most reliable on headed mode)
    for (const sel of selectors) {
      try {
        if (await page.locator(sel).first().isVisible({ timeout: VERIFY_SELECTOR_TIMEOUT_MS })) {
          return true;
        }
      } catch { /* try next */ }
    }

    // Fallback: check if auth cookies are present and URL didn't redirect to login
    // This handles headless mode where pages may not fully render but cookies work
    const authCookieNames = getAuthCookieNames(platform);
    if (authCookieNames.length > 0) {
      const cookies = await context.cookies();
      const hasAllAuthCookies = authCookieNames.every(name =>
        cookies.some(c => c.name === name && c.value && c.value.length > 0)
      );
      if (hasAllAuthCookies) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  } finally {
    if (page) {
      try { await page.close(); } catch { /* ignore */ }
    }
  }
}

/**
 * Save the current context's cookies into an account profile.
 * This converts a cookie-based session into a persistent profile.
 */
export async function saveContextToProfile(
  context: BrowserContext,
  platform: string,
  accountName: string,
): Promise<string | null> {
  try {
    const profileDir = getAccountProfileDir(platform, accountName);

    // Get current cookies
    const cookies = await context.cookies();
    if (cookies.length === 0) return null;

    // Launch persistent profile and inject cookies
    // This creates the profile directory structure
    const { chromium } = await import('playwright');
    const persistentContext = await chromium.launchPersistentContext(profileDir, {
      headless: true,
      ...getProxyOptions(),
    });
    await injectStealth(persistentContext);

    try {
      await persistentContext.addCookies(cookies);
      // Visit the platform once to ensure profile is properly initialized
      const checkUrl = CHECK_URLS[platform];
      if (checkUrl) {
        const page = await persistentContext.newPage();
        try {
          await page.goto(checkUrl, { waitUntil: 'domcontentloaded', timeout: SAVE_NAV_TIMEOUT_MS });
        } catch { /* ignore nav errors */ }
        await page.close();
      }
    } finally {
      await closeProfileContext(persistentContext);
    }

    return profileDir;
  } catch {
    return null;
  }
}
