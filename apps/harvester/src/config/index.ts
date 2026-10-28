/**
 * Shared configuration and state for the harvester service.
 * All modules import from here to avoid circular dependencies.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FingerprintGenerator } from 'fingerprint-generator';
import { FingerprintInjector } from 'fingerprint-injector';
import { sessions as remoteSessions } from '../remote-browser.js';
import {
  loadCredentials as loadCredentialsFromFile,
  saveCredentials as saveCredentialsToFile,
  getCredential as getCredentialFromFile,
  getAllCredentials as getAllCredentialsFromFile,
  upsertCredential as upsertCredentialToFile,
  deleteCredential as deleteCredentialFromFile,
} from '../lib/credentials-store.js';

import { MainServerClient } from '../services/main-server-client.js';
import type { CredentialEntry, CredentialsMap } from '../lib/credentials-store.js';
import type { Page, BrowserContext, Browser } from 'playwright';

// ESM replacement for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const PORT = process.env.PORT || 3003;
export const NOVNC_BASE = process.env.NOVNC_BASE_URL || '/novnc';
// Data directory is always at project root (not inside dist/ build output)
// __dirname points to dist/config/ after compilation, so we resolve from project root
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
export const CREDENTIALS_DIR = process.env.CREDENTIALS_DIR || path.join(PROJECT_ROOT, 'data');
export const CREDENTIALS_FILE = path.join(CREDENTIALS_DIR, 'credentials.json');
export const MAIN_SERVER_URL = process.env.MAIN_SERVER_URL || 'http://localhost:3000';
export const SESSION_TIMEOUT = 10 * 60 * 1000;

// ─── Residential proxy (方案③ 住宅代理池) ────────────────────────────────────
// 格式: http://username:password@gateway:port
// 为 null 时表示不用代理（直连），所有 Playwright launch 会自动跳过 proxy 参数
const _proxyEnv = process.env.HARVESTER_PROXY?.trim();
export const HARVESTER_PROXY: string | null = _proxyEnv && _proxyEnv.length > 0 ? _proxyEnv : null;

/**
 * 返回传给 Playwright launch/launchPersistentContext 的 proxy 选项。
 * HARVESTER_PROXY 为空时返回 undefined（Playwright 即直连，无行为变化）。
 *
 * 用法:
 *   chromium.launch({ headless: true, ...getProxyOptions() })
 *   chromium.launchPersistentContext(dir, { headless: true, ...getProxyOptions() })
 */
export function getProxyOptions():
  | { proxy: { server: string; username?: string; password?: string } }
  | Record<string, never> {
  if (!HARVESTER_PROXY) return {};
  // Playwright 要求认证信息单独传 username/password，内嵌在 server URL 里不生效
  try {
    const u = new URL(HARVESTER_PROXY);
    const server = `${u.protocol}//${u.host}`;
    const username = decodeURIComponent(u.username || '');
    const password = decodeURIComponent(u.password || '');
    if (username) {
      return { proxy: { server, username, password } };
    }
    return { proxy: { server } };
  } catch {
    return { proxy: { server: HARVESTER_PROXY } };
  }
}

// ─── Standard screen resolution constants ───────────────────────────────────
const SCREEN_WIDTH_HD = 1366;
const SCREEN_HEIGHT_HD = 768;
const SCREEN_WIDTH_FULL_HD = 1920;
const SCREEN_HEIGHT_FULL_HD = 1080;

// ─── Screen resolution bounds for fingerprint generation ────────────────────
// Standard desktop resolution range: HD (1366x768) to Full HD (1920x1080)
const SCREEN_MIN_WIDTH = SCREEN_WIDTH_HD;
const SCREEN_MAX_WIDTH = SCREEN_WIDTH_FULL_HD;
const SCREEN_MIN_HEIGHT = SCREEN_HEIGHT_HD;
const SCREEN_MAX_HEIGHT = SCREEN_HEIGHT_FULL_HD;

export interface HarvesterSession {
  browser: Browser | null;
  context: BrowserContext;
  page: Page;
  platform: string;
  accountName: string;
  loginUrl: string;
  userDataDir: string;
  createdAt: Date;
}

try {
  if (!fs.existsSync(CREDENTIALS_DIR)) {
    fs.mkdirSync(CREDENTIALS_DIR, { recursive: true });
  }
  if (!fs.existsSync(CREDENTIALS_FILE)) {
    fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify({}), 'utf-8');
  }

  // Clean up any leftover temporary session profile directories from previous runs.
  // Each session gets its own profile dir under browser-profiles/sessions/ to allow
  // unlimited concurrent sessions per platform. They should be cleaned up on close,
  // but if the process crashed, some may be left behind.
  const sessionsProfileDir = path.join(CREDENTIALS_DIR, 'browser-profiles', 'sessions');
  if (fs.existsSync(sessionsProfileDir)) {
    try {
      const entries = fs.readdirSync(sessionsProfileDir);
      let cleaned = 0;
      for (const entry of entries) {
        const entryPath = path.join(sessionsProfileDir, entry);
        try {
          fs.rmSync(entryPath, { recursive: true, force: true });
          cleaned++;
        } catch { /* skip */ }
      }
      if (cleaned > 0) {
        console.log(`[Config] Cleaned up ${cleaned} leftover session profile directories`);
      }
    } catch (e: unknown) {
      const err = e as Error;
      console.warn('[Config] Failed to clean session profiles:', err.message);
    }
  }
} catch (e: unknown) {
  const err = e as Error;
  console.error('[Credentials] Failed to initialize storage:', err.message);
}

export const fingerprintGenerator = new FingerprintGenerator({
  devices: ['desktop'],
  operatingSystems: ['windows'],
  browsers: [{ name: 'chrome', minVersion: 120 }],
  locales: ['zh-CN'],
  screen: {
    minWidth: SCREEN_MIN_WIDTH,
    maxWidth: SCREEN_MAX_WIDTH,
    minHeight: SCREEN_MIN_HEIGHT,
    maxHeight: SCREEN_MAX_HEIGHT,
  },
});
export const fingerprintInjector = new FingerprintInjector();

/** sessionId -> HarvesterSession */
export const sessions = new Map<string, HarvesterSession>();

export function loadCredentials(): CredentialsMap {
  return loadCredentialsFromFile(CREDENTIALS_FILE);
}

export function saveCredentials(creds: CredentialsMap): boolean {
  return saveCredentialsToFile(CREDENTIALS_FILE, creds);
}

export function upsertCredential(key: string, data: Partial<CredentialEntry>): boolean {
  return upsertCredentialToFile(CREDENTIALS_FILE, key, data);
}

export function getCredential(platform: string): CredentialEntry | null {
  return getCredentialFromFile(CREDENTIALS_FILE, platform);
}

export function getAllCredentials(): CredentialsMap {
  return getAllCredentialsFromFile(CREDENTIALS_FILE);
}

export function deleteCredential(platform: string): boolean {
  return deleteCredentialFromFile(CREDENTIALS_FILE, platform);
}

export async function closeSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;

  const userDataDir = session.userDataDir;

  try {
    if (session.page) await session.page.close().catch(() => {});
    if (session.context) await session.context.close().catch(() => {});
    if (session.browser) await session.browser.close().catch(() => {});
  } catch (e: unknown) {
    const err = e as Error;
    console.error(`Error closing browser for session ${sessionId}:`, err.message);
  } finally {
    sessions.delete(sessionId);
    remoteSessions.delete(sessionId);

    // Clean up temporary session profile directory
    // Each session has its own profile to allow unlimited concurrent sessions
    // for the same platform. We clean up on close to prevent disk bloat.
    if (userDataDir && fs.existsSync(userDataDir)) {
      // Only clean if it's under the sessions/ directory (temp profiles)
      // Don't touch base profiles (chrome-{account}-{platform})
      if (userDataDir.includes(path.join('browser-profiles', 'sessions'))) {
        try {
          fs.rmSync(userDataDir, { recursive: true, force: true });
          console.log(`[Session] Cleaned up profile dir for ${sessionId}`);
        } catch (e: unknown) {
          const err = e as Error;
          console.warn(`[Session] Failed to clean up profile dir: ${err.message}`);
        }
      }
    }
  }
}

export function cleanupExpiredSessions(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt.getTime() > SESSION_TIMEOUT) {
      console.log(`[Cleanup] Session ${id} expired, closing...`);
      closeSession(id).catch((e: Error) => console.error(`Error closing session ${id}:`, e.message));
    }
  }
}

setInterval(cleanupExpiredSessions, 60 * 1000);

// ─── Main Server Client (ACL) ────────────────────────────────────────────────

/**
 * Singleton MainServerClient instance configured from environment variables.
 * Use this for all main server communication — it encapsulates HTTP details
 * and includes exponential backoff retry for transient failures.
 */
export const mainServerClient = new MainServerClient(MAIN_SERVER_URL);

/**
 * Factory function to create a MainServerClient with a custom base URL.
 * Useful for testing or when connecting to a different server instance.
 */
export function createMainServerClient(baseUrl: string): MainServerClient {
  return new MainServerClient(baseUrl);
}

export { remoteSessions };
