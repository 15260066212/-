/**
 * Navigation and cookie actions — page navigation, cookie extraction/sync.
 *
 * Handles: refresh, back, extractCookies
 *
 * Uses an event-driven architecture for credential updates:
 * - extractCookies emits a credential updated event
 * - Event handlers (local save, server sync) react to the event
 * - Results are collected and returned to the frontend
 */

import type { ActionContext } from './types.js';
import type { Page } from 'playwright';

import { PLATFORM_NAMES, CHECK_URLS } from '../config/platforms.js';
import { upsertCredential, mainServerClient } from '../config/index.js';
import { getAuthCookieNames, filterCookiesByDomain, cookiesToString, PLATFORM_DOMAINS } from '../lib/cookie-utils.js';
import { createCookieCredential, buildCredentialKey } from '../lib/credential-model.js';
import type { CookieCredential } from '../lib/credential-model.js';
import { credentialEvents } from '../services/credential-events.js';
import { saveContextToAccountProfile, profileExists, getAccountProfileDir } from '../lib/account-profiles.js';

const DEFAULT_ACCOUNT_NAME = 'default';

// ─── Result Tracking (keyed by credential key for concurrent safety) ────────

/** Local save results, keyed by credential key (account:platform). */
const saveResults = new Map<string, boolean>();

/** Server sync results, keyed by credential key (account:platform). */
const syncResults = new Map<string, { synced: boolean; error: string | null }>();

/** Profile save results, keyed by credential key (account:platform). */
const profileResults = new Map<string, { saved: boolean; profileDir: string | null }>();

// ─── Cookie Helpers ───────────────────────────────────────────────────────────

async function extractPlatformCookies(
  page: Page,
  platform: string,
  accountName: string
): Promise<CookieCredential | null> {
  const allCookies = await page.context().cookies();
  const domains = PLATFORM_DOMAINS[platform] || [];
  const platformCookies = filterCookiesByDomain(allCookies, domains);
  const cookieStr = cookiesToString(platformCookies);
  const authNames = getAuthCookieNames(platform);
  const hasAuth = platformCookies.some((c) => authNames.includes(c.name));

  if (!hasAuth || !cookieStr) {
    return null;
  }

  return createCookieCredential({
    platform,
    platformName: PLATFORM_NAMES[platform],
    accountName,
    cookie: cookieStr,
    cookieCount: platformCookies.length,
    status: 'active',
  });
}

/**
 * Save a credential to local storage.
 * Registered as an event handler for credential updates.
 */
function saveCredentialLocal(cred: CookieCredential): boolean {
  const credKey = buildCredentialKey(cred.accountName, cred.platform);
  return upsertCredential(credKey, cred as unknown as Parameters<typeof upsertCredential>[1]);
}

// ─── Event Handlers (registered at module load) ─────────────────────────────

/**
 * Local save handler — saves credential to local storage when updated.
 * Also records the result for callers that need to know the outcome.
 */
credentialEvents.onCredentialUpdated((cred) => {
  const key = buildCredentialKey(cred.accountName, cred.platform);
  const saved = saveCredentialLocal(cred);
  saveResults.set(key, saved);
  if (saved) {
    console.log(`[Remote] Auto-saved credentials for ${cred.platform}`);
  }
});

/**
 * Server sync handler — syncs credential to main server with retry.
 * Uses the MainServerClient ACL which encapsulates HTTP details and
 * exponential backoff retry for transient failures.
 * Also records the result for callers that need to know the outcome.
 */
credentialEvents.onCredentialUpdated(async (cred) => {
  const key = buildCredentialKey(cred.accountName, cred.platform);
  const result = await mainServerClient.syncCredential(cred);
  syncResults.set(key, {
    synced: result.success,
    error: result.error ?? null,
  });
  if (result.success) {
    console.log(`[Remote] Synced credentials to main server for ${cred.platform}`);
  } else {
    console.log(`[Remote] Failed to sync to main server: ${result.error}`);
  }
});

// ─── Message Handler ──────────────────────────────────────────────────────────

/**
 * Handle navigation and cookie-related WebSocket messages.
 *
 * @returns `true` if the message was handled, `false` if it belongs to another domain
 */
export async function handleNavActions(
  msgType: string,
  msg: any,
  ctx: ActionContext
): Promise<boolean> {
  const { page, session, ws } = ctx;

  switch (msgType) {
    case 'refresh': {
      await page.reload({ waitUntil: 'domcontentloaded' });
      return true;
    }

    case 'goto': {
      const url = msg.url;
      if (url && typeof url === 'string') {
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch { /* ignore nav errors */ }
      }
      return true;
    }

    case 'back': {
      try { await page.goBack({ waitUntil: 'domcontentloaded' }); } catch { /* ignore */ }
      return true;
    }

    case 'extractCookies': {
      const accountName = session.accountName || DEFAULT_ACCOUNT_NAME;
      const cred = await extractPlatformCookies(page, session.platform, accountName);
      const platformName = PLATFORM_NAMES[session.platform];

      let autoSaved = false;
      let syncedToServer = false;
      let syncError: string | null = null;
      let profileSaved = false;
      let profileDir: string | null = null;
      const count = cred ? cred.cookieCount : 0;
      const cookieStr = cred ? cred.data.cookie : '';
      const hasAuth = !!cred;

      if (cred) {
        const key = buildCredentialKey(cred.accountName, cred.platform);

        // Save to account persistent profile
        // Do this in parallel with event handlers but await at end
        const profilePromise = saveContextToAccountProfile(
          page.context(),
          session.platform,
          accountName,
          CHECK_URLS[session.platform],
        ).then((dir) => {
          profileResults.set(key, { saved: !!dir, profileDir: dir });
          if (dir) {
            console.log(`[Remote] Saved profile for ${session.platform}/${accountName}`);
          }
          return dir;
        });

        // Emit event — all registered handlers (local save, server sync, etc.)
        // will react to this.
        await credentialEvents.emitCredentialUpdated(cred);

        // Collect results from event handlers
        autoSaved = saveResults.get(key) ?? false;
        const syncResult = syncResults.get(key);
        syncedToServer = syncResult?.synced ?? false;
        syncError = syncResult?.error ?? null;

        // Wait for profile save to complete
        const profileDirResult = await profilePromise;
        profileSaved = !!profileDirResult;
        profileDir = profileDirResult;
      }

      ws.send(JSON.stringify({
        type: 'cookies',
        count,
        cookieString: cookieStr,
        loggedIn: hasAuth,
        autoSaved,
        syncedToServer,
        syncError,
        profileSaved,
        profileDir,
        platform: session.platform,
        platformName,
      }));
      return true;
    }

    default:
      return false;
  }
}
