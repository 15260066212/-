/**
 * Account Vault — 200+账号多平台凭据管理
 *
 * 使用SQLite存储账号元信息，密码使用AES-256-GCM加密。
 * 支持按平台、状态、代理IP筛选账号。
 */

import Database from 'better-sqlite3';
import { encrypt, decrypt } from './crypto.js';
import { initSessionTables } from '@zemingengine/shared';
import type { AccountCredentials, AccountStatus, PlatformName, ProxyConfig, AccountVaultConfig, BrowserFingerprint } from './types.js';

const DEFAULT_DAILY_LIMIT: Record<PlatformName, number> = {
  zhihu: 5,
  csdn: 2,
  baijiahao: 3,
  baike: 1,
  toutiao: 3,
  netease: 2,
  sohu: 2,
  juejin: 2,
  bilibili: 2,
  zhidao: 1,
  weixin: 1,
};

export class AccountVault {
  private db: Database.Database;
  private dbPath: string;

  constructor(config?: AccountVaultConfig) {
    this.dbPath = config?.dbPath || 'apps/data/geo-assistant.db';
    this.db = new Database(this.dbPath);
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        account_id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        username TEXT NOT NULL,
        encrypted_password TEXT NOT NULL,
        phone TEXT,
        proxy_id TEXT,
        status TEXT DEFAULT 'pending_login',
        session_expires_at INTEGER,
        created_at INTEGER NOT NULL,
        last_login_at INTEGER,
        last_publish_at INTEGER,
        today_publish_count INTEGER DEFAULT 0,
        today_date TEXT,
        daily_limit INTEGER DEFAULT 5,
        note TEXT,
        "group" TEXT,
        tags TEXT,
        fingerprint_id TEXT,
        UNIQUE(platform, username)
      );
      CREATE INDEX IF NOT EXISTS idx_accounts_platform ON accounts(platform);
      CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status);
      CREATE INDEX IF NOT EXISTS idx_accounts_proxy ON accounts(proxy_id);
      CREATE INDEX IF NOT EXISTS idx_accounts_group ON accounts("group");

      CREATE TABLE IF NOT EXISTS proxies (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER NOT NULL,
        username TEXT,
        password TEXT,
        bound_account_id TEXT,
        region TEXT,
        healthy INTEGER DEFAULT 1,
        last_health_check INTEGER,
        last_latency INTEGER
      );
    `);

    // Shared sessions + fingerprints tables (centralized in @zemingengine/shared)
    initSessionTables(this.db);

    // Migration: add columns if they don't exist (for existing databases)
    try { this.db.exec('ALTER TABLE accounts ADD COLUMN "group" TEXT'); } catch {}
    try { this.db.exec('ALTER TABLE accounts ADD COLUMN tags TEXT'); } catch {}
    try { this.db.exec('ALTER TABLE accounts ADD COLUMN fingerprint_id TEXT'); } catch {}
    try { this.db.exec('ALTER TABLE proxies ADD COLUMN healthy INTEGER DEFAULT 1'); } catch {}
    try { this.db.exec('ALTER TABLE proxies ADD COLUMN last_health_check INTEGER'); } catch {}
    try { this.db.exec('ALTER TABLE proxies ADD COLUMN last_latency INTEGER'); } catch {}
  }

  // ── 账号CRUD ──

  addAccount(params: {
    platform: PlatformName;
    username: string;
    password: string;
    phone?: string;
    proxyId?: string;
    dailyLimit?: number;
    note?: string;
    group?: string;
    tags?: string;
  }): AccountCredentials {
    const accountId = `acc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const encryptedPassword = encrypt(params.password);
    const today = new Date().toISOString().slice(0, 10);

    // 为新账号自动生成独立指纹
    const fingerprintId = `fp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const fp = this.generateFingerprint(fingerprintId);
    this.saveFingerprint(fp, accountId);

    this.db.prepare(`
      INSERT INTO accounts (account_id, platform, username, encrypted_password, phone, proxy_id, status, created_at, today_publish_count, today_date, daily_limit, note, "group", tags, fingerprint_id)
      VALUES (?, ?, ?, ?, ?, ?, 'pending_login', ?, 0, ?, ?, ?, ?, ?, ?)
    `).run(accountId, params.platform, params.username, encryptedPassword,
      params.phone || null, params.proxyId || null,
      Date.now(), today, params.dailyLimit || DEFAULT_DAILY_LIMIT[params.platform],
      params.note || null, params.group || null, params.tags || null, fingerprintId);

    return this.getAccount(accountId)!;
  }

  getAccount(accountId: string): AccountCredentials | null {
    const row = this.db.prepare('SELECT * FROM accounts WHERE account_id = ?').get(accountId) as any;
    if (!row) return null;
    return this.rowToAccount(row);
  }

  getAccountByPlatform(platform: PlatformName, username: string): AccountCredentials | null {
    const row = this.db.prepare('SELECT * FROM accounts WHERE platform = ? AND username = ?').get(platform, username) as any;
    if (!row) return null;
    return this.rowToAccount(row);
  }

  listAccounts(filter?: {
    platform?: PlatformName;
    status?: AccountStatus;
    proxyId?: string;
    group?: string;
    tag?: string;
    limit?: number;
    offset?: number;
  }): AccountCredentials[] {
    let sql = 'SELECT * FROM accounts WHERE 1=1';
    const params: any[] = [];
    if (filter?.platform) { sql += ' AND platform = ?'; params.push(filter.platform); }
    if (filter?.status) { sql += ' AND status = ?'; params.push(filter.status); }
    if (filter?.proxyId) { sql += ' AND proxy_id = ?'; params.push(filter.proxyId); }
    if (filter?.group) { sql += ' AND "group" = ?'; params.push(filter.group); }
    if (filter?.tag) { sql += ' AND tags LIKE ?'; params.push(`%${filter.tag}%`); }
    sql += ' ORDER BY created_at DESC';
    if (filter?.limit) { sql += ' LIMIT ?'; params.push(filter.limit); }
    if (filter?.offset) { sql += ' OFFSET ?'; params.push(filter.offset); }
    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(r => this.rowToAccount(r));
  }

  /** 获取可用于发布的账号（active状态，未达日限） */
  getAvailableAccount(platform: PlatformName): AccountCredentials | null {
    const today = new Date().toISOString().slice(0, 10);
    const row = this.db.prepare(`
      SELECT * FROM accounts
      WHERE platform = ? AND status = 'active'
      AND today_date = ? AND today_publish_count < daily_limit
      ORDER BY today_publish_count ASC, last_publish_at ASC
      LIMIT 1
    `).get(platform, today) as any;
    if (!row) return null;
    return this.rowToAccount(row);
  }

  /** 获取所有可用于发布的账号（用于批量发布） */
  getAvailableAccounts(platform: PlatformName, limit: number = 10): AccountCredentials[] {
    const today = new Date().toISOString().slice(0, 10);
    const rows = this.db.prepare(`
      SELECT * FROM accounts
      WHERE platform = ? AND status = 'active'
      AND today_date = ? AND today_publish_count < daily_limit
      ORDER BY today_publish_count ASC, last_publish_at ASC
      LIMIT ?
    `).all(platform, today, limit) as any[];
    return rows.map(r => this.rowToAccount(r));
  }

  /** 解密密码 */
  getPassword(accountId: string): string {
    const row = this.db.prepare('SELECT encrypted_password FROM accounts WHERE account_id = ?').get(accountId) as any;
    if (!row) throw new Error(`Account not found: ${accountId}`);
    return decrypt(row.encrypted_password);
  }

  /** 更新账号状态 */
  updateStatus(accountId: string, status: AccountStatus, note?: string) {
    this.db.prepare('UPDATE accounts SET status = ?, note = ? WHERE account_id = ?')
      .run(status, note || null, accountId);
  }

  /** 记录发布成功 */
  recordPublish(accountId: string) {
    const today = new Date().toISOString().slice(0, 10);
    const account = this.getAccount(accountId);
    if (!account) return;

    // 如果日期变了，重置计数
    if (account.todayDate !== today) {
      this.db.prepare('UPDATE accounts SET today_publish_count = 1, today_date = ?, last_publish_at = ? WHERE account_id = ?')
        .run(today, Date.now(), accountId);
    } else {
      this.db.prepare('UPDATE accounts SET today_publish_count = today_publish_count + 1, last_publish_at = ? WHERE account_id = ?')
        .run(Date.now(), accountId);
    }

    // 检查是否达到日限
    const updated = this.getAccount(accountId);
    if (updated && updated.todayPublishCount >= updated.dailyLimit) {
      this.updateStatus(accountId, 'rate_limited', `Daily limit reached: ${updated.dailyLimit}`);
    }
  }

  /** 记录登录成功 */
  recordLogin(accountId: string, sessionExpiresAt?: number) {
    this.db.prepare('UPDATE accounts SET status = ?, last_login_at = ?, session_expires_at = ? WHERE account_id = ?')
      .run('active', Date.now(), sessionExpiresAt || null, accountId);
  }

  // ── 代理管理 ──

  addProxy(proxy: Omit<ProxyConfig, 'id'> & { id?: string }): string {
    const id = proxy.id || `proxy_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    this.db.prepare(`
      INSERT OR REPLACE INTO proxies (id, type, host, port, username, password, bound_account_id, region)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, proxy.type, proxy.host, proxy.port, proxy.username || null,
      proxy.password || null, proxy.boundAccountId || null, proxy.region || null);
    return id;
  }

  bindProxy(accountId: string, proxyId: string) {
    this.db.prepare('UPDATE accounts SET proxy_id = ? WHERE account_id = ?').run(proxyId, accountId);
    this.db.prepare('UPDATE proxies SET bound_account_id = ? WHERE id = ?').run(accountId, proxyId);
  }

  /** 代理健康检查 — 测试代理连通性 */
  checkProxyHealth(proxyId: string, testUrl: string = 'https://www.baidu.com'): boolean {
    const proxy = this.getProxy(proxyId);
    if (!proxy) return false;
    const start = Date.now();
    try {
      const { execSync } = require('node:child_process');
      const proxyArg = proxy.username
        ? `--proxy http://${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password || '')}@${proxy.host}:${proxy.port}`
        : `--proxy http://${proxy.host}:${proxy.port}`;
      execSync(`curl -s -o /dev/null -w "%{http_code}" --max-time 10 ${proxyArg} ${testUrl}`, { encoding: 'utf-8' });
      const latency = Date.now() - start;
      this.db.prepare('UPDATE proxies SET healthy = 1, last_health_check = ?, last_latency = ? WHERE id = ?')
        .run(Date.now(), latency, proxyId);
      return true;
    } catch {
      this.db.prepare('UPDATE proxies SET healthy = 0, last_health_check = ? WHERE id = ?')
        .run(Date.now(), proxyId);
      return false;
    }
  }

  /** 批量检查所有代理健康状态 */
  checkAllProxies(): { proxyId: string; healthy: boolean; latency: number }[] {
    const rows = this.db.prepare('SELECT id FROM proxies').all() as any[];
    return rows.map(r => {
      const healthy = this.checkProxyHealth(r.id);
      const proxy = this.getProxy(r.id);
      return { proxyId: r.id, healthy, latency: proxy?.lastLatency || 0 };
    });
  }

  /** 获取健康代理 */
  getHealthyProxies(): ProxyConfig[] {
    const rows = this.db.prepare('SELECT * FROM proxies WHERE healthy = 1').all() as any[];
    return rows.map(r => ({
      id: r.id, type: r.type, host: r.host, port: r.port,
      username: r.username || undefined, password: r.password || undefined,
      boundAccountId: r.bound_account_id || undefined, region: r.region || undefined,
      healthy: true, lastHealthCheck: r.last_health_check || undefined, lastLatency: r.last_latency || undefined,
    }));
  }

  getProxy(proxyId: string): ProxyConfig | null {
    const row = this.db.prepare('SELECT * FROM proxies WHERE id = ?').get(proxyId) as any;
    if (!row) return null;
    return {
      id: row.id, type: row.type, host: row.host, port: row.port,
      username: row.username || undefined, password: row.password || undefined,
      boundAccountId: row.bound_account_id || undefined, region: row.region || undefined,
      healthy: row.healthy === 1, lastHealthCheck: row.last_health_check || undefined,
      lastLatency: row.last_latency || undefined,
    };
  }

  /** 获取代理关联的指纹配置 */
  getFingerprint(fingerprintId: string): BrowserFingerprint | null {
    const row = this.db.prepare('SELECT * FROM fingerprints WHERE fingerprint_id = ?').get(fingerprintId) as any;
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

  /** 获取账号的指纹配置 */
  getAccountFingerprint(accountId: string): BrowserFingerprint | null {
    const account = this.getAccount(accountId);
    if (!account?.fingerprintId) return null;
    return this.getFingerprint(account.fingerprintId);
  }

  // ── 指纹生成 ──

  /** 生成一个唯一的浏览器指纹 */
  private generateFingerprint(fingerprintId: string): BrowserFingerprint {
    const chromeVersions = ['130', '131', '132', '133', '134', '135'];
    const chromeMinor = Math.floor(Math.random() * 9) + 1;
    const chromeBuild = Math.floor(Math.random() * 5000) + 5000;
    const chromeVer = chromeVersions[Math.floor(Math.random() * chromeVersions.length)];

    const viewports = [
      { width: 1920, height: 1080 },
      { width: 1680, height: 1050 },
      { width: 1440, height: 900 },
      { width: 1536, height: 864 },
      { width: 1366, height: 768 },
    ];

    const timezones = [
      'Asia/Shanghai', 'Asia/Beijing',
      'Asia/Shenzhen', 'Asia/Hong_Kong',
      'Asia/Tokyo', 'Asia/Seoul',
      'America/Los_Angeles', 'America/New_York',
      'Europe/London', 'Europe/Berlin',
    ];

    const locales = [
      'zh-CN', 'zh-CN', 'zh-CN', 'zh-TW',
      'en-US', 'en-US', 'en-GB',
      'ja-JP', 'ko-KR',
    ];

    const platforms = [
      'Win32', 'Win32', 'Win32', 'Win32',
      'MacIntel', 'MacIntel',
      'Linux x86_64',
    ];

    const webglConfigs = [
      { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)' },
      { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0)' },
      { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0)' },
      { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 770 Direct3D11 vs_5_0 ps_5_0)' },
      { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon Graphics Direct3D11 vs_5_0 ps_5_0)' },
    ];

    const hardwareConcurrencies = [4, 6, 8, 8, 12, 16, 16, 24];
    const deviceMemories = [4, 8, 8, 16, 16, 32];

    const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

    const vp = pick(viewports);
    const tz = pick(timezones);
    const webgl = pick(webglConfigs);

    return {
      userAgent: `Mozilla/5.0 (${pick(['Windows NT 10.0; Win64; x64', 'Windows NT 10.0; Win64; x64', 'Macintosh; Intel Mac OS X 10_15_7'])}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer}.0.${chromeBuild}.${chromeMinor} Safari/537.36`,
      viewport: vp,
      timezone: tz,
      locale: pick(locales),
      platform: pick(platforms),
      webglVendor: webgl.vendor,
      webglRenderer: webgl.renderer,
      canvasNoise: Math.random() * 0.001,
      hardwareConcurrency: pick(hardwareConcurrencies),
      deviceMemory: pick(deviceMemories),
    };
  }

  /** 保存指纹到数据库 */
  private saveFingerprint(fp: BrowserFingerprint, accountId: string) {
    const fingerprintId = `fp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    this.db.prepare(`
      INSERT INTO fingerprints (fingerprint_id, user_agent, viewport_width, viewport_height, timezone, locale, platform_hardware, webgl_vendor, webgl_renderer, canvas_noise, hardware_concurrency, device_memory, created_at, bound_account_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(fingerprintId, fp.userAgent, fp.viewport.width, fp.viewport.height,
      fp.timezone, fp.locale, fp.platform, fp.webglVendor, fp.webglRenderer,
      fp.canvasNoise, fp.hardwareConcurrency, fp.deviceMemory, Date.now(), accountId);
  }

  // ── Session 有效期检查 ──

  /** 检查 session 是否仍然有效（未过期） */
  isSessionValid(accountId: string, platform: PlatformName, maxAgeMs: number = 86400000): boolean {
    const row = this.db.prepare('SELECT saved_at, valid, max_age FROM sessions WHERE account_id = ? AND platform = ?').get(accountId, platform) as any;
    if (!row) return false;
    if (row.valid !== 1) return false;
    const age = Date.now() - row.saved_at;
    const limit = row.max_age || maxAgeMs;
    return age < limit;
  }

  // ── 分组管理 ──

  /** 列出所有分组 */
  listGroups(): string[] {
    const rows = this.db.prepare('SELECT DISTINCT "group" FROM accounts WHERE "group" IS NOT NULL').all() as any[];
    return rows.map(r => r.group);
  }

  /** 设置账号分组 */
  setAccountGroup(accountId: string, group: string) {
    this.db.prepare('UPDATE accounts SET "group" = ? WHERE account_id = ?').run(group, accountId);
  }

  /** 设置账号标签 */
  setAccountTags(accountId: string, tags: string) {
    this.db.prepare('UPDATE accounts SET tags = ? WHERE account_id = ?').run(tags, accountId);
  }

  // ── 内部方法 ──

  private rowToAccount(row: any): AccountCredentials {
    return {
      platform: row.platform as PlatformName,
      accountId: row.account_id,
      username: row.username,
      encryptedPassword: row.encrypted_password,
      iv: '', authTag: '',
      phone: row.phone || undefined,
      proxyId: row.proxy_id || undefined,
      status: row.status as AccountStatus,
      sessionExpiresAt: row.session_expires_at || undefined,
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at || undefined,
      lastPublishAt: row.last_publish_at || undefined,
      todayPublishCount: row.today_publish_count || 0,
      todayDate: row.today_date || '',
      dailyLimit: row.daily_limit || DEFAULT_DAILY_LIMIT[row.platform as PlatformName] || 5,
      note: row.note || undefined,
      group: row.group || undefined,
      tags: row.tags || undefined,
      fingerprintId: row.fingerprint_id || undefined,
    };
  }

  close() { this.db.close(); }
}
