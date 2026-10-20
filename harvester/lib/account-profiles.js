/**
 * Account-level persistent browser profile management.
 * Each platform+account gets its own persistent profile directory.
 *
 * CommonJS version for server deployment.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { CREDENTIALS_DIR } = require('../config');
const { CHECK_URLS, PLATFORM_LOGIN_REDIRECTS } = require('../config/platforms');
const { isLoginRedirectUrl, getAuthCookieNames } = require('./cookie-utils');

// Base directory for account-level persistent profiles
const ACCOUNT_PROFILES_DIR = path.join(CREDENTIALS_DIR, 'account-profiles');

// Ensure base directory exists
if (!fs.existsSync(ACCOUNT_PROFILES_DIR)) {
  fs.mkdirSync(ACCOUNT_PROFILES_DIR, { recursive: true });
}

/**
 * Get the profile directory for a platform+account
 * Account name is URL-encoded to handle special characters (including Chinese)
 */
function getAccountProfileDir(platform, accountName) {
  const encodedAccount = encodeURIComponent(accountName);
  return path.join(ACCOUNT_PROFILES_DIR, platform, encodedAccount);
}

/**
 * Check if an account profile exists
 */
function profileExists(platform, accountName) {
  const dir = getAccountProfileDir(platform, accountName);
  return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
}

/**
 * Ensure profile directory exists (create if not)
 */
function ensureProfileDir(platform, accountName) {
  const dir = getAccountProfileDir(platform, accountName);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Get size of a profile directory in bytes
 */
function getProfileSize(platform, accountName) {
  const dir = getAccountProfileDir(platform, accountName);
  if (!fs.existsSync(dir)) return 0;

  let totalSize = 0;
  function walkDir(dirPath) {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else if (entry.isFile()) {
        try {
          totalSize += fs.statSync(fullPath).size;
        } catch { /* skip locked files */ }
      }
    }
  }

  try {
    walkDir(dir);
  } catch { /* ignore */ }
  return totalSize;
}

/**
 * List all account profiles
 * @returns {Array<{platform: string, accountName: string, sizeBytes: number, sizeMB: number}>}
 */
function listAccountProfiles() {
  const result = [];

  if (!fs.existsSync(ACCOUNT_PROFILES_DIR)) return result;

  const platforms = fs.readdirSync(ACCOUNT_PROFILES_DIR);
  for (const platform of platforms) {
    const platformPath = path.join(ACCOUNT_PROFILES_DIR, platform);
    if (!fs.statSync(platformPath).isDirectory()) continue;

    const accounts = fs.readdirSync(platformPath);
    for (const accountEncoded of accounts) {
      const accountPath = path.join(platformPath, accountEncoded);
      if (!fs.statSync(accountPath).isDirectory()) continue;

      const accountName = decodeURIComponent(accountEncoded);
      const sizeBytes = getProfileSize(platform, accountName);
      result.push({
        platform,
        accountName,
        sizeBytes,
        sizeMB: Math.round(sizeBytes / 1024 / 1024 * 10) / 10,
      });
    }
  }

  return result;
}

/**
 * Delete an account profile
 */
function deleteAccountProfile(platform, accountName) {
  const dir = getAccountProfileDir(platform, accountName);
  if (!fs.existsSync(dir)) return false;

  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Save a context's state to an account profile directory.
 * Uses storageState export + import approach to avoid browser lock issues.
 *
 * @param {import('playwright').BrowserContext} context
 * @param {string} platform
 * @param {string} accountName
 * @param {string} verifyUrl - URL to visit after import to verify login
 * @returns {Promise<string|null>} Profile directory path, or null on failure
 */
async function saveContextToAccountProfile(context, platform, accountName, verifyUrl) {
  try {
    const profileDir = ensureProfileDir(platform, accountName);

    // Export storage state (cookies + localStorage)
    const storageState = await context.storageState();

    // Launch a new persistent context with the profile directory
    const newContext = await chromium.launchPersistentContext(profileDir, {
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-sandbox',
      ],
    });

    try {
      // Import cookies
      if (storageState.cookies && storageState.cookies.length > 0) {
        await newContext.addCookies(storageState.cookies);
      }

      // Import localStorage/origins
      if (storageState.origins && storageState.origins.length > 0) {
        // Visit each origin and set localStorage
        for (const origin of storageState.origins) {
          try {
            const page = await newContext.newPage();
            await page.goto(origin.origin, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
            if (origin.localStorage) {
              await page.evaluate((items) => {
                for (const item of items) {
                  localStorage.setItem(item.name, item.value);
                }
              }, origin.localStorage);
            }
            await page.close();
          } catch { /* skip */ }
        }
      }

      // Visit verify URL to ensure cookies are persisted properly
      if (verifyUrl) {
        try {
          const page = await newContext.newPage();
          await page.goto(verifyUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
          await page.close();
        } catch { /* skip */ }
      }

      // Save meta info
      const metaPath = path.join(profileDir, '.profile-meta.json');
      try {
        fs.writeFileSync(metaPath, JSON.stringify({
          createdAt: Date.now(),
          lastUpdatedAt: Date.now(),
          platform,
          accountName,
          cookieCount: storageState.cookies?.length || 0,
        }, null, 2));
      } catch { /* ignore */ }

      return profileDir;
    } finally {
      await newContext.close();
    }
  } catch (e) {
    console.error('[AccountProfiles] Failed to save context to profile:', e.message);
    return null;
  }
}

/**
 * Copy a session's temporary profile to an account profile directory.
 * Used when harvesting cookies — saves the full session profile.
 *
 * @param {string} sessionProfileDir - Source session profile directory
 * @param {string} platform
 * @param {string} accountName
 * @returns {Promise<string|null>} Target directory path, or null on failure
 */
async function copySessionProfileToAccount(sessionProfileDir, platform, accountName) {
  const targetDir = ensureProfileDir(platform, accountName);

  try {
    // Recursive copy, skip lock files
    function copyDir(src, dest) {
      if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
      }

      const entries = fs.readdirSync(src, { withFileTypes: true });
      for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        // Skip lock files and SingletonCookie
        if (entry.name.includes('lock') || entry.name === 'SingletonCookie') continue;

        if (entry.isDirectory()) {
          copyDir(srcPath, destPath);
        } else if (entry.isFile()) {
          try {
            fs.copyFileSync(srcPath, destPath);
          } catch { /* skip files that are locked */ }
        }
      }
    }

    copyDir(sessionProfileDir, targetDir);

    // Update meta
    const metaPath = path.join(targetDir, '.profile-meta.json');
    try {
      fs.writeFileSync(metaPath, JSON.stringify({
        createdAt: Date.now(),
        lastUpdatedAt: Date.now(),
        platform,
        accountName,
        source: 'session-copy',
      }, null, 2));
    } catch { /* ignore */ }

    return targetDir;
  } catch (e) {
    console.error('[AccountProfiles] Failed to copy session profile:', e.message);
    return null;
  }
}

/**
 * Launch a browser with an account's persistent profile.
 * @returns {Promise<{context: import('playwright').BrowserContext, cleanup: function}>}
 */
async function launchAccountProfile(platform, accountName, options = {}) {
  const profileDir = getAccountProfileDir(platform, accountName);
  if (!profileExists(platform, accountName)) {
    throw new Error(`Profile not found for ${platform}/${accountName}`);
  }

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: options.headless !== false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      ...(options.args || []),
    ],
    viewport: options.viewport || { width: 1280, height: 800 },
  });

  const cleanup = async () => {
    try {
      await context.close();
    } catch { /* ignore */ }
  };

  return { context, cleanup };
}

/**
 * Verify if a profile is still logged in.
 * @returns {Promise<{loggedIn: boolean, url: string, error?: string}>}
 */
async function verifyProfileLogin(platform, accountName) {
  const checkUrl = CHECK_URLS[platform];
  if (!checkUrl) {
    return { loggedIn: false, url: '', error: `No check URL for platform: ${platform}` };
  }

  try {
    const { context, cleanup } = await launchAccountProfile(platform, accountName, { headless: true });
    try {
      const page = await context.newPage();
      await page.goto(checkUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      const currentUrl = page.url();

      // Check 1: URL redirect detection
      const isLogin = isLoginRedirectUrl(currentUrl, PLATFORM_LOGIN_REDIRECTS[platform] || []);

      // Check 2: Auth cookie detection
      const cookies = await context.cookies();
      const authNames = getAuthCookieNames(platform);
      const hasAuthCookies = authNames.every(name =>
        cookies.some(c => c.name === name && c.value && c.value.length > 0)
      );

      const loggedIn = !isLogin && hasAuthCookies;

      await page.close();
      return { loggedIn, url: currentUrl, authCookies: hasAuthCookies };
    } finally {
      await cleanup();
    }
  } catch (e) {
    return { loggedIn: false, url: '', error: e.message };
  }
}

/**
 * Renew a profile's login state by visiting the platform homepage.
 */
async function renewProfile(platform, accountName) {
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
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-sandbox',
      ],
    });

    try {
      const page = await context.newPage();
      await page.goto(checkUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });

      const currentUrl = page.url();
      const isLoginRedirect = isLoginRedirectUrl(currentUrl, PLATFORM_LOGIN_REDIRECTS[platform] || []);

      const cookies = await context.cookies();
      const authCookieNames = getAuthCookieNames(platform);
      const hasAllAuthCookies = authCookieNames.every(name =>
        cookies.some(c => c.name === name && c.value && c.value.length > 0)
      );

      const loggedIn = !isLoginRedirect && hasAllAuthCookies;

      // Save last renewal timestamp
      const metaPath = path.join(profileDir, '.profile-meta.json');
      try {
        const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf-8')) : {};
        meta.lastRenewedAt = Date.now();
        meta.platform = platform;
        meta.accountName = accountName;
        meta.loggedIn = loggedIn;
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
      } catch { /* ignore */ }

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
 */
async function renewAllProfiles() {
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

module.exports = {
  ACCOUNT_PROFILES_DIR,
  getAccountProfileDir,
  profileExists,
  ensureProfileDir,
  getProfileSize,
  listAccountProfiles,
  deleteAccountProfile,
  saveContextToAccountProfile,
  copySessionProfileToAccount,
  launchAccountProfile,
  verifyProfileLogin,
  renewProfile,
  renewAllProfiles,
};
