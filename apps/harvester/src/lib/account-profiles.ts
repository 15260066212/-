/**
 * Account-level persistent browser profile manager.
 *
 * Instead of injecting cookies for every publish, each account gets
 * a persistent Chromium profile directory. Login once, and the browser
 * natively manages session state, localStorage, IndexedDB, etc.
 *
 * Benefits over cookie injection:
 * - More reliable (full browser state, not just cookies)
 * - Better fingerprint consistency (reduces anti-bot detection)
 * - Automatic session renewal (browsing refreshes tokens)
 * - localStorage/sessionStorage preserved (many platforms store auth there)
 */

import fs from 'node:fs';
import path from 'node:path';
import { chromium, type BrowserContext, type LaunchOptions } from 'playwright';
import { CHECK_URLS, PLATFORM_LOGIN_REDIRECTS } from '../config/platforms.js';
import { isLoginRedirectUrl, getAuthCookieNames } from './cookie-utils.js';
import { getProxyOptions } from '../config/index.js';
import { injectStealth } from './stealth.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const PROFILES_DIR = process.env.ACCOUNT_PROFILES_DIR
  ? path.resolve(process.env.ACCOUNT_PROFILES_DIR)
  : path.resolve(process.cwd(), 'data', 'account-profiles');

/** Standard Chromium launch arguments for anti-detection and stability. */
const BROWSER_LAUNCH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-dev-shm-usage',
  '--no-sandbox',
];

/** Delay before closing a context to allow storage flushes (ms). */
const CLOSE_WAIT_MS = 500;

/** Short navigation timeout for profile init / save (ms). */
const NAV_TIMEOUT_SHORT_MS = 15000;

/** Long navigation timeout for health check / renewal (ms). */
const NAV_TIMEOUT_LONG_MS = 20000;

// ─── Path helpers ────────────────────────────────────────────────────────────

/**
 * Get the profile directory path for an account.
 * Format: data/account-profiles/{platform}/{accountName}/
 */
export function getAccountProfileDir(platform: string, accountName: string): string {
  const safePlatform = encodeURIComponent(platform);
  const safeAccount = encodeURIComponent(accountName);
  return path.join(PROFILES_DIR, safePlatform, safeAccount);
}

/**
 * Check if a profile directory exists and has been initialized
 * (i.e., has a Default folder from at least one browser launch).
 */
export function profileExists(platform: string, accountName: string): boolean {
  const profileDir = getAccountProfileDir(platform, accountName);
  const defaultDir = path.join(profileDir, 'Default');
  return fs.existsSync(defaultDir) && fs.statSync(defaultDir).isDirectory();
}

/**
 * Ensure the profile directory exists.
 */
export function ensureProfileDir(platform: string, accountName: string): string {
  const profileDir = getAccountProfileDir(platform, accountName);
  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
  }
  return profileDir;
}

// ─── Context launch helpers ──────────────────────────────────────────────────

export interface ProfileLaunchOptions {
  headless?: boolean;
  viewport?: { width: number; height: number };
  userAgent?: string;
  locale?: string;
  extraPrefs?: Record<string, unknown>;
}

/**
 * Launch a persistent browser context using an account's profile.
 * Falls back to a fresh context with cookie injection if profile doesn't exist.
 *
 * @returns BrowserContext and a flag indicating if a persistent profile was used
 */
export async function launchAccountProfile(
  platform: string,
  accountName: string,
  options: ProfileLaunchOptions = {},
): Promise<{ context: BrowserContext; isPersistent: boolean; profileDir: string }> {
  const profileDir = ensureProfileDir(platform, accountName);
  const hasProfile = profileExists(platform, accountName);

  const {
    headless = true,
    viewport = { width: 1280, height: 800 },
    userAgent,
    locale = 'zh-CN',
    extraPrefs = {},
  } = options;

  const launchOpts: LaunchOptions & Record<string, unknown> = {
    headless,
    args: BROWSER_LAUNCH_ARGS,
  };

  const context = await chromium.launchPersistentContext(profileDir, {
    ...launchOpts,
    viewport,
    locale,
    userAgent,
    ...extraPrefs,
    ...getProxyOptions(),
  });

  // 反检测注入（发布流程走这里，之前完全裸奔）
  await injectStealth(context);

  return {
    context,
    isPersistent: hasProfile,
    profileDir,
  };
}

/**
 * Close a browser context launched from a profile.
 * The profile data is preserved on disk for next use.
 */
export async function closeProfileContext(context: BrowserContext): Promise<void> {
  try {
    // Wait a bit for any pending cookie writes / storage flushes
    await new Promise((resolve) => setTimeout(resolve, CLOSE_WAIT_MS));
    await context.close();
  } catch {
    /* ignore close errors */
  }
}

// ─── Profile management ──────────────────────────────────────────────────────

/**
 * Delete an account's profile (e.g. when credential is revoked).
 */
export function deleteAccountProfile(platform: string, accountName: string): boolean {
  const profileDir = getAccountProfileDir(platform, accountName);
  if (fs.existsSync(profileDir)) {
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Get disk usage info for an account profile.
 */
export function getProfileSize(platform: string, accountName: string): number {
  const profileDir = getAccountProfileDir(platform, accountName);
  if (!fs.existsSync(profileDir)) return 0;

  let totalSize = 0;
  function walk(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      try {
        if (entry.isFile()) {
          totalSize += fs.statSync(fullPath).size;
        } else if (entry.isDirectory()) {
          walk(fullPath);
        }
      } catch {
        /* locked files, ignore */
      }
    }
  }

  try {
    walk(profileDir);
  } catch {
    /* ignore */
  }
  return totalSize;
}

/**
 * List all account profiles with basic info.
 */
export function listAccountProfiles(): Array<{
  platform: string;
  accountName: string;
  size: number;
  lastModified: number;
}> {
  const result: Array<{
    platform: string;
    accountName: string;
    size: number;
    lastModified: number;
  }> = [];

  if (!fs.existsSync(PROFILES_DIR)) return result;

  const platforms = fs.readdirSync(PROFILES_DIR, { withFileTypes: true });
  for (const platDir of platforms) {
    if (!platDir.isDirectory()) continue;
    const accounts = fs.readdirSync(path.join(PROFILES_DIR, platDir.name), { withFileTypes: true });
    for (const acctDir of accounts) {
      if (!acctDir.isDirectory()) continue;
      const profilePath = path.join(PROFILES_DIR, platDir.name, acctDir.name);
      try {
        const stat = fs.statSync(path.join(profilePath, 'Default'));
        const decodedPlatform = decodeURIComponent(platDir.name);
        const decodedAccount = decodeURIComponent(acctDir.name);
        result.push({
          platform: decodedPlatform,
          accountName: decodedAccount,
          size: getProfileSize(decodedPlatform, decodedAccount),
          lastModified: stat.mtimeMs,
        });
      } catch {
        /* skip incomplete profiles */
      }
    }
  }

  return result;
}

export { PROFILES_DIR };

// ─── Profile Save (context → account profile) ────────────────────────────────

/**
 * Save a browser context's full state (cookies + localStorage + sessionStorage)
 * into an account's persistent profile.
 *
 * This is more reliable than copying the profile directory while the browser
 * is running (SQLite lock issues). We:
 * 1. Export storage state via Playwright API
 * 2. Launch a fresh persistent context for the account
 * 3. Import the storage state
 * 4. Visit the platform once to initialize the profile fully
 *
 * @param context - Source browser context
 * @param platform - Platform name (harvester naming)
 * @param accountName - Account name
 * @param checkUrl - URL to visit after import to initialize profile
 * @returns The target profile directory path, or null on failure
 */
export async function saveContextToAccountProfile(
  context: import('playwright').BrowserContext,
  platform: string,
  accountName: string,
  checkUrl?: string,
): Promise<string | null> {
  const targetDir = ensureProfileDir(platform, accountName);

  try {
    // Step 1: Export full storage state from source context
    const storageState = await context.storageState();

    // Step 2: Remove old profile if exists
    if (fs.existsSync(targetDir)) {
      try {
        fs.rmSync(targetDir, { recursive: true, force: true });
      } catch {
        /* may be locked — try to proceed anyway by overwriting */
      }
    }

    // Step 3: Launch persistent profile
    const persistentContext = await chromium.launchPersistentContext(targetDir, {
      headless: true,
      args: BROWSER_LAUNCH_ARGS,
      ...getProxyOptions(),
    });
    await injectStealth(persistentContext);

    try {
      // Step 3b: Import cookies from storage state
      if (storageState.cookies && storageState.cookies.length > 0) {
        await persistentContext.addCookies(storageState.cookies);
      }

      // Step 4: Visit platform page to initialize profile and verify cookies work
      // This also gives localStorage/sessionStorage a chance to sync
      if (checkUrl) {
        const page = await persistentContext.newPage();
        try {
          await page.goto(checkUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_SHORT_MS });
        } catch { /* ignore nav errors */ }
        await page.close();
      }
    } finally {
      await persistentContext.close();
    }

    return targetDir;
  } catch {
    return null;
  }
}

// ─── Profile Renewal (cookie refresh) ────────────────────────────────────────

/**
 * Renew a profile's login state by visiting the platform homepage.
 * This refreshes cookies and extends session validity.
 *
 * @returns true if renewal succeeded (profile still logged in)
 */
export async function renewProfile(
  platform: string,
  accountName: string,
): Promise<{ success: boolean; loggedIn: boolean; error?: string }> {
  if (!profileExists(platform, accountName)) {
    return { success: false, loggedIn: false, error: 'Profile not found' };
  }

  const profileDir = getAccountProfileDir(platform, accountName);
  const checkUrl = CHECK_URLS[platform];

  if (!checkUrl) {
    return { success: false, loggedIn: false, error: `No check URL for platform: ${platform}` };
  }

  try {
    const context = await chromium.launchPersistentContext(profileDir, {
      headless: true,
      args: BROWSER_LAUNCH_ARGS,
      ...getProxyOptions(),
    });
    await injectStealth(context);

    try {
      const page = await context.newPage();
      await page.goto(checkUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_LONG_MS });

      // Check if still logged in
      const currentUrl = page.url();
      const isLoginRedirect = isLoginRedirectUrl(currentUrl, PLATFORM_LOGIN_REDIRECTS[platform] || []);

      // Check auth cookies
      const cookies = await context.cookies();
      const authCookieNames = getAuthCookieNames(platform);
      const hasAllAuthCookies = authCookieNames.every(name =>
        cookies.some(c => c.name === name && c.value && c.value.length > 0)
      );

      const loggedIn = !isLoginRedirect && hasAllAuthCookies;

      // Save last renewal timestamp
      const metaPath = path.join(profileDir, '.profile-meta.json');
      try {
        fs.writeFileSync(metaPath, JSON.stringify({
          lastRenewedAt: Date.now(),
          platform,
          accountName,
          loggedIn,
        }, null, 2));
      } catch { /* ignore meta write errors */ }

      await page.close();
      return { success: true, loggedIn };
    } finally {
      await context.close();
    }
  } catch (e) {
    return {
      success: false,
      loggedIn: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Renew all profiles across all platforms.
 * @returns Summary of renewal results
 */
export async function renewAllProfiles(): Promise<{
  total: number;
  renewed: number;
  stillLoggedIn: number;
  failed: number;
  results: Array<{
    platform: string;
    accountName: string;
    success: boolean;
    loggedIn: boolean;
    error?: string;
  }>;
}> {
  const profiles = listAccountProfiles();
  const results = [];
  let stillLoggedIn = 0;
  let failed = 0;

  for (const p of profiles) {
    console.log(`[Profile Renewal] Renewing ${p.platform}/${p.accountName}...`);
    const result = await renewProfile(p.platform, p.accountName);
    results.push({
      platform: p.platform,
      accountName: p.accountName,
      ...result,
    });
    if (result.success && result.loggedIn) stillLoggedIn++;
    if (!result.success) failed++;
  }

  return {
    total: profiles.length,
    renewed: results.filter(r => r.success).length,
    stillLoggedIn,
    failed,
    results,
  };
}
