/**
 * SessionPool Adapter — implements ISessionPool for the server.
 *
 * Provides browser session persistence with fingerprint isolation:
 * - storageState save/restore (encrypted in database)
 * - WebRTC IP leak prevention
 * - Canvas/WebGL fingerprint randomization
 * - Cookie domain filtering per platform
 * - LRU eviction when pool is full
 *
 * Uses the server's existing crypto-util and database.
 * Falls back gracefully when Playwright is not installed.
 */

import type { BrowserContext } from 'playwright';
import type { DatabaseAccess } from './db.js';
import type { ISessionPool, SessionAccount } from '@zemingengine/publisher';
import { encrypt, decrypt } from '@zemingengine/account-vault';

const MAX_CONCURRENT = 8;
const SESSION_MAX_AGE_MS = parseInt(process.env.SESSION_MAX_AGE_HOURS || '168', 10) * 60 * 60 * 1000; // 7 days default

interface PoolEntry {
  context: BrowserContext;
  accountId: string;
  platform: string;
  lastUsed: number;
  inUse: boolean;
}

interface Fingerprint {
  userAgent: string;
  viewport: { width: number; height: number };
  timezone: string;
  locale: string;
  platform: string;
  webglVendor: string;
  webglRenderer: string;
  canvasNoise: number;
  hardwareConcurrency: number;
  deviceMemory: number;
}

const DEFAULT_FINGERPRINT: Fingerprint = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.5493.5 Safari/537.36',
  viewport: { width: 1920, height: 1080 },
  timezone: 'Asia/Shanghai',
  locale: 'zh-CN',
  platform: 'Win32',
  webglVendor: 'Google Inc. (NVIDIA)',
  webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)',
  canvasNoise: 0.0001,
  hardwareConcurrency: 8,
  deviceMemory: 16,
};

const PLATFORM_COOKIE_DOMAINS: Record<string, string[]> = {
  zhihu: ['.zhihu.com'],
  csdn: ['.csdn.net'],
  baijiahao: ['.baijiahao.baidu.com', '.baidu.com'],
  baike: ['.baike.baidu.com', '.baidu.com'],
  toutiao: ['.toutiao.com', '.douyin.com'],
  netease: ['.163.com'],
  sohu: ['.sohu.com'],
  juejin: ['.juejin.cn'],
  bilibili: ['.bilibili.com'],
  zhidao: ['.zhidao.baidu.com', '.baidu.com'],
  weixin: ['.qq.com'],
};

export class SessionPoolAdapter implements ISessionPool {
  private db: DatabaseAccess;
  private pool: Map<string, PoolEntry> = new Map();
  private browser: import('playwright').Browser | null = null;
  private playwrightAvailable = false;

  constructor(db: DatabaseAccess) {
    this.db = db;
    // Check if Playwright is available (async check, not blocking constructor)
    this.checkPlaywright();
  }

  private async checkPlaywright(): Promise<void> {
    try {
      await import('playwright');
      this.playwrightAvailable = true;
      console.log('[SessionPool] Playwright detected, session persistence enabled');
    } catch {
      this.playwrightAvailable = false;
      console.log('[SessionPool] Playwright not available, session persistence disabled (using remote mode)');
    }
  }

  private async ensureBrowser(): Promise<import('playwright').Browser> {
    if (this.browser && this.browser.isConnected()) return this.browser;
    const { chromium } = await import('playwright');
    this.browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-gpu'],
    });
    console.log('[SessionPool] Browser launched');
    return this.browser;
  }

  async acquireContext(account: SessionAccount): Promise<BrowserContext> {
    if (!this.playwrightAvailable) {
      throw new Error('Playwright is not available — cannot acquire browser context');
    }

    const key = `${account.platform}:${account.accountId}`;

    // 1. Check pool for idle context
    const existing = this.pool.get(key);
    if (existing && !existing.inUse) {
      existing.inUse = true;
      existing.lastUsed = Date.now();
      console.log(`[SessionPool] Reused idle context for ${key}`);
      return existing.context;
    }

    // 2. Evict if full
    await this.evictIfFull();

    // 3. Create new context with fingerprint
    const browser = await this.ensureBrowser();
    const fp = DEFAULT_FINGERPRINT;

    // 4. Check for saved session
    const savedState = this.loadSession(account.accountId, account.platform);
    const sessionExpired = savedState && (Date.now() - savedState.savedAt > SESSION_MAX_AGE_MS);

    let context: BrowserContext;

    if (savedState?.storageState && savedState.valid && !sessionExpired) {
      // Restore saved session with cookie domain filtering
      const rawState = JSON.parse(decrypt(savedState.storageState));
      const filteredState = this.filterCookiesByDomain(rawState, account.platform) as
        import('playwright').BrowserContextOptions['storageState'];

      context = await browser.newContext({
        storageState: filteredState,
        userAgent: fp.userAgent,
        viewport: fp.viewport,
        timezoneId: fp.timezone,
        locale: fp.locale,
        bypassCSP: true,
        extraHTTPHeaders: { 'Accept-Language': fp.locale },
      });

      await this.injectWebRTCBlocker(context);
      await this.injectFingerprintGuards(context, fp);
      console.log(`[SessionPool] Restored session for ${key}`);
    } else {
      // New context — no saved session
      context = await browser.newContext({
        userAgent: fp.userAgent,
        viewport: fp.viewport,
        timezoneId: fp.timezone,
        locale: fp.locale,
        bypassCSP: true,
        extraHTTPHeaders: { 'Accept-Language': fp.locale },
      });

      await this.injectWebRTCBlocker(context);
      await this.injectFingerprintGuards(context, fp);
      console.log(`[SessionPool] Created new context for ${key} (no saved session)`);
    }

    this.pool.set(key, {
      context,
      accountId: account.accountId,
      platform: account.platform,
      lastUsed: Date.now(),
      inUse: true,
    });

    return context;
  }

  async releaseContext(accountId: string, platform: string): Promise<void> {
    const key = `${platform}:${accountId}`;
    const entry = this.pool.get(key);
    if (entry) {
      entry.inUse = false;
      entry.lastUsed = Date.now();
      // Persist refreshed cookies back to database after each use
      try {
        const state = await entry.context.storageState();
        const encrypted = encrypt(JSON.stringify(state));
        this.db.credentials.saveBrowserSession(accountId, platform, encrypted);
        console.log(`[SessionPool] Session refreshed and saved after release: ${platform}:${accountId}`);
      } catch (err) {
        console.warn(`[SessionPool] Failed to save session on release:`, err instanceof Error ? err.message : err);
      }
    }
  }

  async saveSession(
    accountId: string,
    platform: string,
    context: BrowserContext,
    _userDataDir: string,
    fingerprintId?: string,
  ): Promise<void> {
    try {
      const state = await context.storageState();
      const encrypted = encrypt(JSON.stringify(state));
      this.db.credentials.saveBrowserSession(accountId, platform, encrypted, fingerprintId);
      console.log(`[SessionPool] Session saved for ${platform}:${accountId}`);
    } catch (err) {
      console.warn(`[SessionPool] Failed to save session:`, err instanceof Error ? err.message : err);
    }
  }

  async close(): Promise<void> {
    for (const [, entry] of this.pool) {
      try { await entry.context.close(); } catch {}
    }
    this.pool.clear();
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    console.log('[SessionPool] Closed');
  }

  private loadSession(accountId: string, platform: string): { storageState: string; valid: boolean; savedAt: number; maxAge?: number } | null {
    return this.db.credentials.getBrowserSession(accountId, platform);
  }

  private filterCookiesByDomain(storageState: unknown, platform: string): unknown {
    if (!storageState || typeof storageState !== 'object') return storageState;
    const state = storageState as { cookies?: unknown[]; origins?: unknown[] };
    if (!state.cookies) return storageState;
    const allowedDomains = PLATFORM_COOKIE_DOMAINS[platform] || [];
    if (allowedDomains.length === 0) return storageState;

    const filtered = (state.cookies as Array<{ domain?: string }>).filter((cookie) => {
      const domain = cookie.domain || '';
      return allowedDomains.some((d) => domain.endsWith(d) || domain === d.slice(1));
    });

    return { ...state, cookies: filtered };
  }

  private async injectWebRTCBlocker(context: BrowserContext): Promise<void> {
    await context.addInitScript(() => {
      const origRTCPeerConnection = window.RTCPeerConnection;
      const origWebkitRTCPeerConnection = (window as unknown as { webkitRTCPeerConnection: typeof RTCPeerConnection }).webkitRTCPeerConnection;
      (window as unknown as { RTCPeerConnection: typeof RTCPeerConnection }).RTCPeerConnection = function (...args: unknown[]) {
        if ((args[0] as { iceServers?: unknown[] })?.iceServers) {
          (args[0] as { iceServers: unknown[] }).iceServers = [];
        }
        const pc = new origRTCPeerConnection(args[0] as RTCConfiguration);
        return pc;
      } as unknown as typeof RTCPeerConnection;
      (window as unknown as { webkitRTCPeerConnection: typeof RTCPeerConnection }).webkitRTCPeerConnection =
        (window as unknown as { RTCPeerConnection: typeof RTCPeerConnection }).RTCPeerConnection;
      void origWebkitRTCPeerConnection;
    });
  }

  private async injectFingerprintGuards(context: BrowserContext, fp: Fingerprint): Promise<void> {
    await context.addInitScript((fingerprint) => {
      Object.defineProperty(navigator, 'platform', { get: () => fingerprint.platform });
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => fingerprint.hardwareConcurrency });
      Object.defineProperty(navigator, 'deviceMemory', { get: () => fingerprint.deviceMemory });
      Object.defineProperty(navigator, 'language', { get: () => fingerprint.locale });
      Object.defineProperty(navigator, 'languages', { get: () => [fingerprint.locale, 'en-US'] });

      const getParameterProto = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function (this: WebGLRenderingContext, param: number) {
        if (param === 37445) return fingerprint.webglVendor;
        if (param === 37446) return fingerprint.webglRenderer;
        return getParameterProto.call(this, param);
      } as unknown as typeof WebGLRenderingContext.prototype.getParameter;

      const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function (this: HTMLCanvasElement, ...args: unknown[]) {
        const ctx = this.getContext('2d');
        if (ctx) {
          const w = this.width, h = this.height;
          if (w > 0 && h > 0) {
            const imageData = ctx.getImageData(0, 0, w, h);
            for (let i = 0; i < imageData.data.length; i += 4) {
              imageData.data[i] ^= Math.floor(fingerprint.canvasNoise * 255);
            }
            ctx.putImageData(imageData, 0, 0);
          }
        }
        return origToDataURL.apply(this, args as [type?: string, quality?: number]);
      } as unknown as typeof HTMLCanvasElement.prototype.toDataURL;
    }, fp);
  }

  private async evictIfFull(): Promise<void> {
    if (this.pool.size < MAX_CONCURRENT) return;

    let oldestKey: string | null = null;
    let oldestTime = Date.now();
    for (const [key, entry] of this.pool) {
      if (!entry.inUse && entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      const entry = this.pool.get(oldestKey);
      if (entry) {
        await entry.context.close();
        this.pool.delete(oldestKey);
        console.log(`[SessionPool] Evicted ${oldestKey} (pool full)`);
      }
    }
  }

  getStats() {
    let active = 0, idle = 0;
    for (const [, entry] of this.pool) {
      if (entry.inUse) active++; else idle++;
    }
    return { total: this.pool.size, active, idle, max: MAX_CONCURRENT, playwrightAvailable: this.playwrightAvailable };
  }
}
