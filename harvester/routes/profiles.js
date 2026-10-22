/**
 * Browser Profile management routes.
 *
 * Endpoints:
 *   GET    /api/profiles                  - List all persistent browser profiles
 *   GET    /api/profiles/:platform/:account/health - Check login health of a profile
 *   DELETE /api/profiles/:platform/:account - Delete a profile directory
 *   POST   /api/profiles/:platform/:account/renew  - Renew (relogin) a profile
 *   POST   /api/profiles/renew-all        - Renew all profiles
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { CREDENTIALS_DIR, loadCredentials, upsertCredential } = require('../config');
const { PLATFORM_URLS, PLATFORM_NAMES, PLATFORM_LOGGED_IN_SELECTORS } = require('../config/platforms');

const PROFILES_DIR = path.join(CREDENTIALS_DIR, 'browser-profiles');
const SESSIONS_DIR = path.join(PROFILES_DIR, 'sessions');

// Ensure profiles directory exists
if (!fs.existsSync(PROFILES_DIR)) {
  fs.mkdirSync(PROFILES_DIR, { recursive: true });
}

/**
 * Parse profile directory name like "chrome-account-platform" or "chrome-platform"
 * Returns { account, platform } or null if not a valid base profile.
 */
function parseProfileDir(dirName) {
  if (!dirName.startsWith('chrome-')) return null;
  if (dirName === 'sessions') return null;

  const rest = dirName.slice('chrome-'.length); // e.g. "default-toutiaohao" or "zhihu"

  // Try to match known platforms (longest first to avoid partial matches)
  const platforms = Object.keys(PLATFORM_URLS).sort((a, b) => b.length - a.length);
  for (const plat of platforms) {
    if (rest === plat) {
      // Format: chrome-{platform} → account is "default"
      return { account: 'default', platform: plat };
    }
    if (rest.endsWith('-' + plat)) {
      // Format: chrome-{account}-{platform}
      const account = rest.slice(0, -(plat.length + 1));
      return { account, platform: plat };
    }
  }
  return null;
}

/**
 * List all persistent base profiles (skip session temp dirs).
 * Deduplicates by platform+account key: prefers chrome-{account}-{platform}
 * over chrome-{platform} (legacy format without explicit account).
 */
function listAllProfiles() {
  if (!fs.existsSync(PROFILES_DIR)) return [];

  const entries = fs.readdirSync(PROFILES_DIR, { withFileTypes: true });
  const profileMap = new Map(); // key: "account:platform"

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const parsed = parseProfileDir(entry.name);
    if (!parsed) continue;

    const fullPath = path.join(PROFILES_DIR, entry.name);
    let sizeBytes = 0;
    let createdAt = null;
    let modifiedAt = null;

    try {
      const stat = fs.statSync(fullPath);
      sizeBytes = estimateDirSize(fullPath);
      createdAt = stat.birthtime.toISOString();
      modifiedAt = stat.mtime.toISOString();
    } catch {
      // skip
    }

    const key = `${parsed.account}:${parsed.platform}`;
    const existing = profileMap.get(key);

    // Prefer explicit "chrome-{account}-{platform}" format over legacy "chrome-{platform}"
    const isExplicitFormat = entry.name === `chrome-${parsed.account}-${parsed.platform}`;
    if (!existing || (isExplicitFormat && !existing.profileDir.startsWith(`chrome-${parsed.account}-`))) {
      profileMap.set(key, {
        platform: parsed.platform,
        account: parsed.account,
        accountName: parsed.account,
        platformName: PLATFORM_NAMES[parsed.platform] || parsed.platform,
        profileDir: entry.name,
        path: fullPath,
        sizeBytes,
        sizeMB: Math.round((sizeBytes / 1024 / 1024) * 10) / 10,
        createdAt,
        updatedAt: modifiedAt,
        lastCheckedAt: null,
        isLoggedIn: null,
      });
    }
  }

  return Array.from(profileMap.values()).sort((a, b) => {
    if (a.platform !== b.platform) return a.platform.localeCompare(b.platform);
    return a.account.localeCompare(b.account);
  });
}

/**
 * Estimate directory size (shallow scan for performance).
 */
function estimateDirSize(dirPath, depth = 2) {
  let total = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dirPath, entry.name);
      if (entry.isFile()) {
        try {
          total += fs.statSync(full).size;
        } catch { /* skip */ }
      } else if (entry.isDirectory() && depth > 0 && entry.name !== 'Cache' && entry.name !== 'GPUCache' && entry.name !== 'Code Cache') {
        total += estimateDirSize(full, depth - 1);
      }
    }
  } catch { /* skip */ }
  return total;
}

/**
 * Check if a profile is logged in to the platform.
 */
async function checkProfileLogin(platform, account, timeoutMs = 20000) {
  const loginUrl = PLATFORM_URLS[platform];
  if (!loginUrl) return { isLoggedIn: false, error: 'Unknown platform' };

  const profileKey = `${account}-${platform}`;
  const profileDir = path.join(PROFILES_DIR, `chrome-${profileKey}`);
  // Also check for chrome-{platform} (no account prefix)
  const altProfileDir = path.join(PROFILES_DIR, `chrome-${platform}`);

  let userDataDir = null;
  if (fs.existsSync(profileDir)) {
    userDataDir = profileDir;
  } else if (account === 'default' && fs.existsSync(altProfileDir)) {
    userDataDir = altProfileDir;
  } else {
    return { isLoggedIn: false, error: 'Profile not found' };
  }

  const checkSelectors = PLATFORM_LOGGED_IN_SELECTORS[platform] || [];

  let browser = null;
  let context = null;
  try {
    context = await chromium.launchPersistentContext(userDataDir, { channel: 'chromium', 
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    const page = context.pages()[0] || await context.newPage();
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });

    // Wait a bit for dynamic content
    await page.waitForTimeout(2000);

    let isLoggedIn = false;
    for (const selector of checkSelectors) {
      try {
        const el = await page.$(selector);
        if (el) {
          isLoggedIn = true;
          break;
        }
      } catch { /* continue */ }
    }

    return {
      isLoggedIn,
      checkedAt: new Date().toISOString(),
      platform,
      account,
    };
  } catch (e) {
    return { isLoggedIn: false, error: e.message, platform, account };
  } finally {
    try {
      if (context) await context.close();
    } catch { /* ignore */ }
  }
}

function registerProfileRoutes(app) {
  /**
   * GET /api/profiles
   * List all persistent browser profiles.
   */
  app.get('/api/profiles', (req, res) => {
    try {
      const profiles = listAllProfiles();
      res.json({ success: true, profiles, total: profiles.length });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  /**
   * GET /api/profiles/:platform/:account/health
   * Check login health of a specific profile.
   */
  app.get('/api/profiles/:platform/:account/health', async (req, res) => {
    try {
      const { platform, account } = req.params;
      const decodedAccount = decodeURIComponent(account);

      const result = await checkProfileLogin(platform, decodedAccount);

      if (result.error) {
        return res.status(500).json({ success: false, error: result.error });
      }

      res.json({
        success: true,
        isLoggedIn: result.isLoggedIn,
        checkedAt: result.checkedAt,
        platform,
        account: decodedAccount,
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  /**
   * DELETE /api/profiles/:platform/:account
   * Delete a profile directory.
   */
  app.delete('/api/profiles/:platform/:account', (req, res) => {
    try {
      const { platform, account } = req.params;
      const decodedAccount = decodeURIComponent(account);

      const profileKey = `${decodedAccount}-${platform}`;
      const profileDir = path.join(PROFILES_DIR, `chrome-${profileKey}`);
      const altProfileDir = path.join(PROFILES_DIR, `chrome-${platform}`);

      let deleted = false;
      if (fs.existsSync(profileDir)) {
        fs.rmSync(profileDir, { recursive: true, force: true });
        deleted = true;
      } else if (decodedAccount === 'default' && fs.existsSync(altProfileDir)) {
        fs.rmSync(altProfileDir, { recursive: true, force: true });
        deleted = true;
      }

      // Also remove associated credential
      const creds = loadCredentials();
      if (creds[platform] && creds[platform].accountId === decodedAccount) {
        delete creds[platform];
        upsertCredential(platform, creds[platform]);
      }

      res.json({ success: true, deleted });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  /**
   * POST /api/profiles/:platform/:account/renew
   * Renew a profile (trigger re-login flow — opens a non-headless window for manual login).
   * Note: In headless server environments, this returns a task that can be monitored.
   */
  app.post('/api/profiles/:platform/:account/renew', async (req, res) => {
    try {
      const { platform, account } = req.params;
      const decodedAccount = decodeURIComponent(account);
      const loginUrl = PLATFORM_URLS[platform];

      if (!loginUrl) {
        return res.status(400).json({ success: false, error: 'Unknown platform' });
      }

      // For server deployments, "renew" means check current login status
      // A full re-login would require a headed browser (not possible in headless server)
      const result = await checkProfileLogin(platform, decodedAccount);

      res.json({
        success: true,
        platform,
        account: decodedAccount,
        isLoggedIn: result.isLoggedIn,
        checkedAt: result.checkedAt,
        message: result.isLoggedIn
          ? 'Profile is still logged in, no renewal needed'
          : 'Profile is logged out. Manual re-login required (headless server cannot perform interactive login).',
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  /**
   * POST /api/profiles/renew-all
   * Check all profiles and return their login status.
   */
  app.post('/api/profiles/renew-all', async (req, res) => {
    try {
      const profiles = listAllProfiles();
      const results = [];

      for (const p of profiles) {
        try {
          const result = await checkProfileLogin(p.platform, p.account);
          results.push({
            platform: p.platform,
            account: p.account,
            isLoggedIn: result.isLoggedIn,
            error: result.error || null,
            checkedAt: result.checkedAt,
          });
        } catch (e) {
          results.push({
            platform: p.platform,
            account: p.account,
            isLoggedIn: false,
            error: e.message,
          });
        }
      }

      const loggedInCount = results.filter(r => r.isLoggedIn).length;
      res.json({
        success: true,
        total: results.length,
        loggedIn: loggedInCount,
        expired: results.length - loggedInCount,
        results,
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });
}

module.exports = { registerProfileRoutes, listAllProfiles };
