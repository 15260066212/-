/**
 * Session Pool — 多账号浏览器session持久化管理
 *
 * 核心机制:
 * 1. 首次: 用账号密码登录 → 保存storageState
 * 2. 日常: 恢复storageState → 直接使用(无需登录)
 * 3. 过期: 自动重新登录(账号密码) → 遇验证码时通知人工
 *
 * 支持并发: 每个账号独立BrowserContext，通过池管理复用。
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import Database from 'better-sqlite3';
import { decrypt, encrypt } from '@zemingengine/account-vault';
import type { AccountCredentials, BrowserFingerprint, PlatformName, ProxyConfig, SessionState } from '@zemingengine/account-vault';
import { initSessionTables } from '@zemingengine/shared';

const SESSION_DIR = 'apps/data/sessions';
const MAX_CONCURRENT = 8;

/** 各平台 cookie 域名白名单 — 只保留对应平台的 cookie，过滤跨域泄露 */
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

interface PoolEntry {
  context: BrowserContext;
  accountId: string;
  platform: PlatformName;
  lastUsed: number;
  inUse: boolean;
  fingerprintId?: string;
}

export class SessionPool {
  private db: Database.Database;
  private browser: Browser | null = null;
  private pool: Map<string, PoolEntry> = new Map();
  private sessionDir: string;

  constructor(dbPath?: string) {
    this.db = new Database(dbPath || 'apps/data/geo-assistant.db');
    this.sessionDir = path.resolve(SESSION_DIR);
    this.init();
  }

  private init() {
    if (!existsSync(this.sessionDir)) {
      fs.mkdir(this.sessionDir, { recursive: true });
    }
    // Shared sessions + fingerprints tables (centralized in @zemingengine/shared)
    initSessionTables(this.db);
  }

  private async ensureBrowser() {
    if (!this.browser || !this.browser.isConnected()) {
      this.browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-gpu'],
      });
    }
    return this.browser;
  }

  /**
   * 获取或创建一个账号的浏览器上下文
   * 1. 先检查pool中是否有空闲的
   * 2. 检查是否有保存的session（storageState）且未过期
   * 3. 有session → 恢复（含指纹隔离） → 验证是否有效
   * 4. 无session/无效 → 自动登录 → 保存session
   */
  async acquireContext(
    account: AccountCredentials,
    loginFn?: (page: import('playwright').Page, account: AccountCredentials) => Promise<boolean>,
    proxy?: ProxyConfig,
    fingerprint?: BrowserFingerprint,
  ): Promise<BrowserContext> {
    const key = `${account.platform}:${account.accountId}`;

    // 1. 检查pool
    const existing = this.pool.get(key);
    if (existing && !existing.inUse) {
      existing.inUse = true;
      existing.lastUsed = Date.now();
      return existing.context;
    }

    // 2. 检查并发上限
    await this.evictIfFull();

    // 3. 创建新上下文 — 使用指纹隔离
    const browser = await this.ensureBrowser();
    const userDataDir = path.join(this.sessionDir, `${account.platform}_${account.accountId}`);
    if (!existsSync(userDataDir)) {
      await fs.mkdir(userDataDir, { recursive: true });
    }

    // 指纹配置：传入的 > 账号关联的 > 默认
    const fp = fingerprint || this.loadFingerprint(account) || this.defaultFingerprint();

    // 加载保存的session
    const savedSession = this.loadSession(account.accountId, account.platform);

    // 检查 session 有效期（默认7天，可通过环境变量配置）
    const sessionMaxAge = parseInt(process.env.SESSION_MAX_AGE_HOURS || '168', 10) * 60 * 60 * 1000;
    const sessionExpired = savedSession && (Date.now() - savedSession.savedAt > (savedSession.maxAge || sessionMaxAge));

    let context: BrowserContext;

    if (savedSession?.storageState && savedSession.valid && !sessionExpired) {
      // 恢复session — 应用 cookie 域名过滤
      const rawState = JSON.parse(decrypt(savedSession.storageState));
      const filteredState = this.filterCookiesByDomain(rawState, account.platform);

      context = await browser.newContext({
        storageState: filteredState,
        userAgent: fp.userAgent,
        viewport: fp.viewport,
        timezoneId: fp.timezone,
        locale: fp.locale,
        proxy: proxy ? { server: `${proxy.host}:${proxy.port}`, username: proxy.username, password: proxy.password } : undefined,
        // WebRTC 防泄漏 — 强制使用代理
        bypassCSP: true,
        extraHTTPHeaders: {
          'Accept-Language': fp.locale,
        },
      });

      // 注入 WebRTC 防泄漏脚本
      await this.injectWebRTCBlocker(context);

      // 注入指纹覆盖脚本
      await this.injectFingerprintGuards(context, fp);

      console.log(`[SessionPool] Restored session for ${key} (fingerprint: ${fp.userAgent.slice(0, 30)}...)`);
    } else {
      // 新上下文，需要登录
      context = await browser.newContext({
        userAgent: fp.userAgent,
        viewport: fp.viewport,
        timezoneId: fp.timezone,
        locale: fp.locale,
        proxy: proxy ? { server: `${proxy.host}:${proxy.port}`, username: proxy.username, password: proxy.password } : undefined,
        bypassCSP: true,
        extraHTTPHeaders: {
          'Accept-Language': fp.locale,
        },
      });

      // 注入 WebRTC 防泄漏
      await this.injectWebRTCBlocker(context);

      // 注入指纹覆盖
      await this.injectFingerprintGuards(context, fp);

      if (loginFn) {
        const page = await context.newPage();
        const loggedIn = await loginFn(page, account);
        await page.close();

        if (loggedIn) {
          // 保存session — 含指纹ID和有效期
          await this.saveSession(account.accountId, account.platform, context, userDataDir, proxy, account.fingerprintId);
          console.log(`[SessionPool] Login successful, session saved for ${key}`);
        } else {
          console.log(`[SessionPool] Login failed for ${key} — may need manual intervention`);
        }
      }
    }

    this.pool.set(key, {
      context, accountId: account.accountId,
      platform: account.platform, lastUsed: Date.now(), inUse: true,
      fingerprintId: account.fingerprintId,
    });

    return context;
  }

  /**
   * 释放上下文回池（不关闭，供复用）
   */
  async releaseContext(accountId: string, platform: PlatformName): Promise<void> {
    const key = `${platform}:${accountId}`;
    const entry = this.pool.get(key);
    if (entry) {
      entry.inUse = false;
      entry.lastUsed = Date.now();
      // Persist refreshed cookies back to database after each use
      try {
        await this.saveSession(accountId, platform, entry.context, '', undefined, undefined);
      } catch (err) {
        console.warn(`[SessionPool] Failed to save session on release:`, err instanceof Error ? err.message : err);
      }
    }
  }

  /**
   * 保存session到数据库（含指纹关联和有效期）
   */
  async saveSession(
    accountId: string, platform: PlatformName,
    context: BrowserContext, userDataDir: string, proxy?: ProxyConfig,
    fingerprintId?: string,
  ) {
    const state = await context.storageState();
    const encrypted = encrypt(JSON.stringify(state));

    this.db.prepare(`
      INSERT OR REPLACE INTO sessions (account_id, platform, storage_state, user_data_dir, proxy_host, proxy_port, saved_at, valid, max_age, fingerprint_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(accountId, platform, encrypted, userDataDir,
      proxy?.host || null, proxy?.port || null, Date.now(),
      86400000, // 默认24小时有效期
      fingerprintId || null);
  }

  /**
   * 标记session为无效（下次需要重新登录）
   */
  invalidateSession(accountId: string, platform: PlatformName) {
    this.db.prepare('UPDATE sessions SET valid = 0 WHERE account_id = ? AND platform = ?')
      .run(accountId, platform);
  }

  /**
   * 加载保存的session
   */
  private loadSession(accountId: string, platform: PlatformName): SessionState | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE account_id = ? AND platform = ?').get(accountId, platform) as any;
    if (!row) return null;
    return {
      accountId: row.account_id,
      platform: row.platform as PlatformName,
      storageState: row.storage_state,
      userDataDir: row.user_data_dir,
      proxy: row.proxy_host ? { server: `${row.proxy_host}:${row.proxy_port}` } : undefined,
      savedAt: row.saved_at,
      valid: row.valid === 1,
      maxAge: row.max_age || undefined,
      fingerprintId: row.fingerprint_id || undefined,
    };
  }

  /**
   * 从数据库加载账号关联的指纹
   */
  private loadFingerprint(account: AccountCredentials): BrowserFingerprint | null {
    if (!account.fingerprintId) return null;
    const row = this.db.prepare('SELECT * FROM fingerprints WHERE fingerprint_id = ?').get(account.fingerprintId) as any;
    if (!row) return null;
    return {
      userAgent: row.user_agent,
      viewport: { width: row.viewport_width, height: row.viewport_height },
      timezone: row.timezone,
      locale: row.locale,
      platform: row.platform_hardware,
      webglVendor: row.webgl_vendor,
      webglRenderer: row.webgl_renderer,
      canvasNoise: row.canvas_noise,
      hardwareConcurrency: row.hardware_concurrency,
      deviceMemory: row.device_memory,
    };
  }

  /**
   * 默认指纹（无关联指纹时使用）
   */
  private defaultFingerprint(): BrowserFingerprint {
    return {
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
  }

  /**
   * Cookie 域名过滤 — 只保留目标平台的 cookie，移除跨域 cookie 防止身份关联
   */
  private filterCookiesByDomain(storageState: any, platform: string): any {
    if (!storageState?.cookies) return storageState;
    const allowedDomains = PLATFORM_COOKIE_DOMAINS[platform] || [];
    if (allowedDomains.length === 0) return storageState;

    const filtered = storageState.cookies.filter((cookie: any) => {
      const domain = cookie.domain || '';
      return allowedDomains.some(d => domain.endsWith(d) || domain === d.slice(1));
    });

    return { ...storageState, cookies: filtered };
  }

  /**
   * WebRTC 防泄漏 — 阻止 WebRTC 泄露真实 IP
   */
  private async injectWebRTCBlocker(context: BrowserContext) {
    await context.addInitScript(() => {
      const origRTCPeerConnection = window.RTCPeerConnection;
      const origWebkitRTCPeerConnection = (window as any).webkitRTCPeerConnection;
      (window as any).RTCPeerConnection = function (...args: any[]) {
        if (args[0]?.iceServers) {
          args[0].iceServers = [];
        }
        const pc = new origRTCPeerConnection(...args);
        return pc;
      };
      (window as any).webkitRTCPeerConnection = (window as any).RTCPeerConnection;
    });
  }

  /**
   * 注入指纹覆盖脚本 — 覆盖 navigator 和 WebGL 指纹
   */
  private async injectFingerprintGuards(context: BrowserContext, fp: BrowserFingerprint) {
    await context.addInitScript((fingerprint) => {
      // navigator.platform
      Object.defineProperty(navigator, 'platform', { get: () => fingerprint.platform });
      // navigator.hardwareConcurrency
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => fingerprint.hardwareConcurrency });
      // navigator.deviceMemory
      Object.defineProperty(navigator, 'deviceMemory', { get: () => fingerprint.deviceMemory });
      // navigator.language
      Object.defineProperty(navigator, 'language', { get: () => fingerprint.locale });
      Object.defineProperty(navigator, 'languages', { get: () => [fingerprint.locale, 'en-US'] });

      // WebGL 指纹覆盖
      const getParameterProto = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function (this: WebGLRenderingContext, param: number) {
        if (param === 37445) return fingerprint.webglVendor;
        if (param === 37446) return fingerprint.webglRenderer;
        return getParameterProto.call(this, param);
      } as any;

      // Canvas 噪声
      const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function (this: HTMLCanvasElement, ...args: any[]) {
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
      } as any;
    }, fp);
  }

  /**
   * 如果池已满，驱逐最久未使用的上下文
   */
  private async evictIfFull() {
    if (this.pool.size < MAX_CONCURRENT) return;

    // 找到最久未使用的非占用上下文
    let oldestKey: string | null = null;
    let oldestTime = Date.now();
    for (const [key, entry] of this.pool) {
      if (!entry.inUse && entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      const entry = this.pool.get(oldestKey)!;
      await entry.context.close();
      this.pool.delete(oldestKey);
      console.log(`[SessionPool] Evicted ${oldestKey} (pool full)`);
    }
  }

  /**
   * 关闭所有上下文和浏览器
   */
  async close() {
    for (const [, entry] of this.pool) {
      try { await entry.context.close(); } catch {}
    }
    this.pool.clear();
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    this.db.close();
  }

  /**
   * 获取池统计信息
   */
  getStats() {
    let active = 0, idle = 0;
    for (const [, entry] of this.pool) {
      if (entry.inUse) active++; else idle++;
    }
    return { total: this.pool.size, active, idle, max: MAX_CONCURRENT };
  }
}
