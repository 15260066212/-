'use strict';

/**
 * Wechatsync 扩展宿主 + 桥接发布器
 *
 * 设计要点（选项一：混合替换）：
 *   - 本模块是 Wechatsync 扩展的"宿主"：harvester 进程内的持久 Chromium
 *     (channel:'chromium'，headless 默认走 chromium_headless_shell 不支持扩展)
 *     加载 Wechatsync 真扩展，扩展作为 WS 客户端连回本进程的 9527 WS 服务端。
 *   - 只负责「发布主路径」。不涉及远程浏览器查看 / cookie 采集 / 账号体系，
 *     这三类能力仍由 harvester 原有模块提供。
 *   - 命中本模块支持的平台 -> 走插件；未命中 -> 返回失败信号，由调用方回落 RPA。
 *   - 插件侧所有 adapter 目前只会「存草稿」(draftOnly 默认 true)，因此成功结果
 *     会带 draftSaved:true / verificationStatus:'draft_saved'，不会伪装成已发布。
 *
 * 环境变量：
 *   WECHATSYNC_ENABLED     默认 true；=false 时整个桥接关闭
 *   WECHATSYNC_EXT_DIR     扩展 dist 目录，默认 /home/ubuntu/wechatsync-ext
 *   WECHATSYNC_PROFILE_DIR 持久 profile，默认 <CREDENTIALS_DIR>/wechatsync-profile
 *   WECHATSYNC_WS_PORT     默认 9527
 *   WECHATSYNC_HTTP_PORT   预热页端口，默认 19999
 *   WECHATSYNC_TOKEN       固定 token（默认落盘到 <CREDENTIALS_DIR>/wechatsync-token.txt）
 *   WECHATSYNC_PLATFORMS   走插件的平台白名单，默认 zhihu,baijiahao,juejin,sohuhao,bilibili
 *                          （csdn 默认排除：harvester 的 CSDN RPA 能真正发布，插件只能存草稿）
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const { randomUUID } = require('crypto');
const { WebSocketServer } = require('ws');
const { chromium } = require('playwright');

const { CREDENTIALS_DIR, getAllCredentials } = require('../config');

const LOG = '[wechatsync]';
const log = (...a) => console.log(LOG, ...a);
const warn = (...a) => console.warn(LOG, ...a);

// ---------------------------------------------------------------- 配置

const ENABLED = process.env.WECHATSYNC_ENABLED !== 'false';
const EXT_DIR = process.env.WECHATSYNC_EXT_DIR || '/home/ubuntu/wechatsync-ext';
const PROFILE_DIR =
  process.env.WECHATSYNC_PROFILE_DIR ||
  path.join(CREDENTIALS_DIR || path.join(__dirname, '..', 'data'), 'wechatsync-profile');
const WS_PORT = Number(process.env.WECHATSYNC_WS_PORT || 9527);
const HTTP_PORT = Number(process.env.WECHATSYNC_HTTP_PORT || 19999);
const TOKEN_FILE =
  process.env.WECHATSYNC_TOKEN_FILE ||
  path.join(CREDENTIALS_DIR || path.join(__dirname, '..', 'data'), 'wechatsync-token.txt');
const KEEPALIVE_MS = Number(process.env.WECHATSYNC_KEEPALIVE_MS || 25000);

// 本项目 RPA 平台名 -> Wechatsync 适配器 id + cookie 注入域名
// 注意：扩展 adapter 集合里没有 toutiao / toutiaohao / wangyihao / zhidao / baike，
// 这些平台一律不支持，由调用方回落 RPA。
const PLATFORM_MAP = {
  zhihu: { ext: 'zhihu', domain: '.zhihu.com' },
  baijiahao: { ext: 'baijiahao', domain: '.baidu.com' },
  csdn: { ext: 'csdn', domain: '.csdn.net' },
  juejin: { ext: 'juejin', domain: '.juejin.cn' },
  bilibili: { ext: 'bilibili', domain: '.bilibili.com' },
  sohuhao: { ext: 'sohu', domain: '.sohu.com' },
};

const DEFAULT_PLATFORMS = ['zhihu', 'baijiahao', 'juejin', 'sohuhao', 'bilibili'];

function enabledPlatformSet() {
  const raw = process.env.WECHATSYNC_PLATFORMS;
  const list =
    raw === undefined
      ? DEFAULT_PLATFORMS
      : String(raw)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
  return new Set(list);
}

function isSupported(platform) {
  if (!ENABLED) return false;
  if (!PLATFORM_MAP[platform]) return false;
  return enabledPlatformSet().has(platform);
}

function extIdFor(platform) {
  return PLATFORM_MAP[platform].ext;
}

function loadToken() {
  if (process.env.WECHATSYNC_TOKEN) return process.env.WECHATSYNC_TOKEN;
  try {
    const t = fs.readFileSync(TOKEN_FILE, 'utf-8').trim();
    if (t) return t;
  } catch {
    /* 首次运行 */
  }
  const t = 'geo-' + randomUUID();
  try {
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
    fs.writeFileSync(TOKEN_FILE, t, 'utf-8');
  } catch (e) {
    warn('persist token failed:', e.message);
  }
  return t;
}

const TOKEN = loadToken();

// ---------------------------------------------------------------- 运行时状态

const state = {
  starting: null,
  ready: false,
  ctx: null,
  warmPage: null,
  httpServer: null,
  wss: null,
  client: null,
  clientWaiters: [],
  keepaliveTimer: null,
  shuttingDown: false,
};

const pending = new Map();

function isClientOpen() {
  return !!(state.client && state.client.readyState === 1);
}

// ---------------------------------------------------------------- HTTP 预热页 + WS 桥接

function startHttpServer() {
  if (state.httpServer) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const srv = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        '<!doctype html><html><head><title>wechatsync warm</title></head><body>warm page</body></html>'
      );
    });
    srv.once('error', reject);
    srv.listen(HTTP_PORT, '127.0.0.1', () => {
      state.httpServer = srv;
      log('warm http page on 127.0.0.1:' + HTTP_PORT);
      resolve();
    });
  });
}

function startBridge() {
  if (state.wss) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: WS_PORT });
    wss.once('error', reject);
    wss.on('connection', (ws) => {
      log('extension connected to bridge');
      state.client = ws;
      ws.on('message', (raw) => {
        let msg;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (!msg || !msg.id) return;
        const cb = pending.get(msg.id);
        if (cb) {
          pending.delete(msg.id);
          cb(msg);
        }
      });
      ws.on('close', () => {
        if (state.client === ws) {
          state.client = null;
          log('extension disconnected');
        }
      });
      ws.on('error', () => {});
      const waiters = state.clientWaiters;
      state.clientWaiters = [];
      for (const w of waiters) w();
    });
    wss.on('listening', () => {
      state.wss = wss;
      log('ws bridge on 127.0.0.1:' + WS_PORT);
      resolve();
    });
  });
}

function rpc(method, params, timeout = 180000) {
  return new Promise((resolve, reject) => {
    const ws = state.client;
    if (!ws || ws.readyState !== 1) {
      return reject(new Error('wechatsync bridge not connected'));
    }
    const id = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('wechatsync rpc timeout: ' + method));
    }, timeout);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      if (msg.error) {
        const e = new Error('wechatsync rpc error ' + msg.error.code + ': ' + msg.error.message);
        e.code = msg.error.code;
        reject(e);
      } else {
        resolve(msg.result);
      }
    });
    ws.send(JSON.stringify({ id, method, token: TOKEN, params }));
  });
}

function waitForClient(timeoutMs) {
  if (isClientOpen()) return Promise.resolve(true);
  return new Promise((resolve, reject) => {
    const waiter = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      state.clientWaiters = state.clientWaiters.filter((w) => w !== waiter);
      reject(new Error('wechatsync extension did not connect within ' + timeoutMs + 'ms'));
    }, timeoutMs);
    state.clientWaiters.push(waiter);
  });
}

// ---------------------------------------------------------------- 浏览器 + SW 唤醒

async function startBrowser() {
  if (state.ctx) return;
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  if (!fs.existsSync(path.join(EXT_DIR, 'manifest.json'))) {
    throw new Error('wechatsync extension not found at ' + EXT_DIR);
  }
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    channel: 'chromium', // headless:true 默认用 headless_shell，无法加载扩展
    viewport: { width: 1280, height: 900 },
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=DialMediaRouteProvider,OptimizationHints',
      '--disable-extensions-except=' + EXT_DIR,
      '--load-extension=' + EXT_DIR,
    ],
  });
  state.ctx = ctx;
  ctx.on('close', () => {
    state.ctx = null;
    state.warmPage = null;
    state.ready = false;
    log('browser context closed');
  });
  log('browser launched (channel=chromium, extension loaded)');
  await ensureWarmTab();
}

async function ensureWarmTab() {
  if (!state.ctx) return null;
  if (state.warmPage && !state.warmPage.isClosed()) return state.warmPage;
  const page = await state.ctx.newPage();
  await page.goto('http://127.0.0.1:' + HTTP_PORT + '/', {
    waitUntil: 'domcontentloaded',
    timeout: 20000,
  });
  state.warmPage = page;
  page.on('close', () => {
    if (state.warmPage === page) state.warmPage = null;
  });
  return page;
}

async function getServiceWorker(timeoutMs = 15000) {
  const ctx = state.ctx;
  if (!ctx) return null;
  const existing = ctx.serviceWorkers()[0];
  if (existing) return existing;
  try {
    return await ctx.waitForEvent('serviceworker', { timeout: timeoutMs });
  } catch {
    return null;
  }
}

/**
 * 唤醒/启动扩展侧 MCP 客户端。
 * MV3 的 SW 收不到自己发的 chrome.runtime.sendMessage，
 * 必须预置 storage 后，从 SW 里向一个普通网页 tab 注入脚本发 MCP_ENABLE。
 */
async function enableMcp() {
  const sw = await getServiceWorker();
  if (!sw) {
    warn('extension service worker unavailable, cannot enable MCP');
    return false;
  }
  const serverUrl = 'ws://127.0.0.1:' + WS_PORT;
  try {
    await sw.evaluate(
      async (cfg) => {
        await chrome.storage.local.set({
          mcpEnabled: true,
          mcpToken: cfg.token,
          mcpServerUrl: cfg.url,
        });
      },
      { token: TOKEN, url: serverUrl }
    );
  } catch (e) {
    warn('preset storage failed:', e.message);
    return false;
  }

  await ensureWarmTab();
  try {
    const trig = await sw.evaluate(async (port) => {
      const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1:' + port + '/*' });
      if (!tabs.length || !tabs[0].id) return { ok: false, reason: 'no warm tab' };
      await chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: () => chrome.runtime.sendMessage({ type: 'MCP_ENABLE' }),
      });
      return { ok: true, tabId: tabs[0].id };
    }, HTTP_PORT);
    if (!trig || !trig.ok) {
      warn('MCP_ENABLE trigger failed:', trig && trig.reason);
      return false;
    }
    log('MCP_ENABLE triggered');
    return true;
  } catch (e) {
    warn('MCP_ENABLE trigger error:', e.message);
    return false;
  }
}

async function ensureClient(timeoutMs = 60000) {
  if (isClientOpen()) return true;
  await enableMcp();
  return waitForClient(timeoutMs);
}

async function ensureReady() {
  if (!ENABLED) throw new Error('wechatsync bridge disabled');
  if (state.ready && isClientOpen()) return true;
  if (state.starting) return state.starting;
  state.starting = (async () => {
    await startHttpServer();
    await startBridge();
    await startBrowser();
    // 扩展 SW 激活时会先做一次平台授权预检查，等它稳定后再唤醒 MCP
    await new Promise((r) => setTimeout(r, 8000));
    await ensureClient();
    startKeepalive();
    state.ready = true;
    log('bridge ready (platforms: ' + [...enabledPlatformSet()].join(',') + ')');
  })().then(
    (v) => {
      state.starting = null;
      return v;
    },
    (e) => {
      state.starting = null;
      throw e;
    }
  );
  return state.starting;
}

// ---------------------------------------------------------------- keepalive / 断连自愈

function startKeepalive() {
  if (state.keepaliveTimer) return;
  state.keepaliveTimer = setInterval(() => {
    keepaliveTick().catch(() => {});
  }, KEEPALIVE_MS);
  if (state.keepaliveTimer.unref) state.keepaliveTimer.unref();
}

/**
 * 每 25s 发一帧到扩展。作用有二：
 *   1) Chrome 116+ 下 WebSocket 消息会重置 MV3 SW 的空闲计时器，避免 SW 被杀；
 *   2) 响应缺失即说明桥接已死，触发重连。
 * 用未知方法名，扩展零副作用地回一个 error 响应。
 */
async function keepaliveTick() {
  if (state.shuttingDown) return;
  if (!isClientOpen()) {
    try {
      await ensureClient(60000);
    } catch (e) {
      warn('reconnect failed:', e.message);
    }
    return;
  }
  try {
    await rpc('__keepalive', {}, 15000);
  } catch (e) {
    if (/timeout/.test(e.message)) {
      warn('keepalive timeout, resetting bridge');
      try {
        state.client.terminate();
      } catch {
        /* ignore */
      }
      state.client = null;
      try {
        await ensureClient(60000);
      } catch (e2) {
        warn('re-enable after timeout failed:', e2.message);
      }
    }
    // Unknown method 的 error 响应属正常，忽略
  }
}

// ---------------------------------------------------------------- cookie

function parseCookieHeader(str) {
  const out = [];
  for (const pair of String(str || '').split(';')) {
    const s = pair.trim();
    if (!s) continue;
    const i = s.indexOf('=');
    if (i < 0) continue;
    const name = s.slice(0, i).trim();
    const value = s.slice(i + 1).trim();
    if (name) out.push({ name, value });
  }
  return out;
}

/**
 * 从 harvester 凭证库取某平台 cookie 字符串。
 * 凭证 key 是复合键（如 "膜一姐汽车贴膜:sohuhao"），按尾段匹配，取 cookie 最多的一条。
 */
function storedCookieString(platform) {
  let best = '';
  let bestCount = -1;
  try {
    const all = getAllCredentials() || {};
    for (const [key, rec] of Object.entries(all)) {
      if (!rec || typeof rec !== 'object') continue;
      const rawName = String(rec.platform || key || '');
      if (rawName.split(':').pop() !== platform) continue;
      const c = rec.data && (rec.data.cookie || rec.data.cookies);
      if (!c || typeof c !== 'string') continue;
      const count = Number(rec.cookieCount) || c.split(';').length;
      if (count > bestCount) {
        bestCount = count;
        best = c;
      }
    }
  } catch (e) {
    warn('read credentials failed:', e.message);
  }
  return best;
}

function cookiesFor(platform, credentials) {
  const info = PLATFORM_MAP[platform];
  if (!info) return [];
  const raw = [];
  const data = credentials && credentials.data;
  if (data) {
    if (typeof data.cookie === 'string' && data.cookie.trim()) {
      raw.push(...parseCookieHeader(data.cookie));
    } else if (Array.isArray(data.cookies)) {
      for (const c of data.cookies) {
        if (c && c.name) raw.push({ name: c.name, value: String(c.value == null ? '' : c.value) });
      }
    }
  }
  if (!raw.length) raw.push(...parseCookieHeader(storedCookieString(platform)));
  return raw.map((c) => ({
    name: c.name,
    value: c.value,
    domain: info.domain,
    path: '/',
    secure: true,
    httpOnly: false,
    sameSite: 'None',
  }));
}

async function injectCookies(platform, credentials) {
  const cookies = cookiesFor(platform, credentials);
  if (!cookies.length) return 0;
  await state.ctx.addCookies(cookies);
  return cookies.length;
}

// ---------------------------------------------------------------- 文章映射

function looksLikeMarkdown(s) {
  return /\n/.test(s) && /(^|\n)\s*(#{1,6}\s|[-*]\s|\d+\.\s|>|```)/.test(s);
}

function toExtArticle(article) {
  const a = article || {};
  const out = { title: a.title || '无标题' };
  const mdCandidate = a.contentMarkdown || a.markdown || '';
  const html = a.contentHtml || '';
  let markdown = '';
  if (mdCandidate) markdown = mdCandidate;
  else if (typeof a.content === 'string' && looksLikeMarkdown(a.content)) markdown = a.content;

  if (markdown) out.markdown = markdown;
  else if (html) out.content = html;
  else if (typeof a.content === 'string' && a.content) out.content = a.content;
  if (a.cover) out.cover = a.cover;
  return out;
}

// ---------------------------------------------------------------- 串行化

let lock = Promise.resolve();
function withLock(fn) {
  const next = lock.then(fn);
  lock = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

// ---------------------------------------------------------------- 对外 API

/**
 * 某平台是否由插件承载。false 表示调用方应回落 RPA。
 */
function supports(platform) {
  return isSupported(platform);
}

/**
 * 插件登录态检查（不会建草稿）。
 * 会先按凭证库把该平台 cookie 注入当前 profile，否则新 profile 上必然未登录。
 * @returns {{supported:boolean, isAuthenticated:boolean, username?:string, error?:string}}
 */
async function checkAuth(platform, credentials) {
  if (!isSupported(platform)) return { supported: false, isAuthenticated: false };
  try {
    await ensureReady();
    const injected = await injectCookies(platform, credentials);
    const res = await rpc('checkAuth', { platform: extIdFor(platform) }, 90000);
    return {
      supported: true,
      isAuthenticated: !!(res && res.isAuthenticated),
      username: res && res.username,
      error: res && res.error,
      injectedCookies: injected,
    };
  } catch (e) {
    return { supported: true, isAuthenticated: false, error: e.message };
  }
}

/**
 * 通过 Wechatsync 扩展发布。
 * 返回值与 harvester 的 publish 结果形状兼容；失败时 success:false，
 * 由调用方决定是否回落 RPA（wechatsyncOnly 时调用方不会回落）。
 */
async function publish(platform, article, credentials) {
  if (!isSupported(platform)) {
    return {
      success: false,
      unsupported: true,
      error: 'Wechatsync plugin does not support platform: ' + platform,
      publishMode: 'wechatsync',
    };
  }

  return withLock(async () => {
    const extId = extIdFor(platform);
    const startedAt = Date.now();
    await ensureReady();

    const injected = await injectCookies(platform, credentials);
    log(`publish ${platform}: injected ${injected} cookies`);

    const auth = await rpc('checkAuth', { platform: extId }, 90000).catch((e) => ({
      isAuthenticated: false,
      error: e.message,
    }));
    if (!auth || !auth.isAuthenticated) {
      const reason = (auth && (auth.error || auth.username)) || 'not authenticated';
      log(`publish ${platform}: not logged in (${reason}) -> caller should fall back`);
      return {
        success: false,
        error: 'Not logged in on ' + extId + ' (wechatsync): ' + reason,
        verificationStatus: 'unverified',
        publishMode: 'wechatsync',
        platform,
      };
    }
    log(`publish ${platform}: logged in as ${auth.username || '<unknown>'}`);

    const res = await rpc(
      'syncArticle',
      { platforms: [extId], article: toExtArticle(article) },
      Number(process.env.WECHATSYNC_SYNC_TIMEOUT || 300000)
    );

    const results = Array.isArray(res && res.results) ? res.results : [];
    const r = results.find((x) => x && x.platform === extId) || results[0];
    if (!r || !r.success) {
      return {
        success: false,
        error: (r && r.error) || 'wechatsync sync returned no result',
        verificationStatus: 'failed',
        publishMode: 'wechatsync',
        platform,
        syncId: res && res.syncId,
      };
    }

    // 插件侧 adapter 目前一律 draftOnly，成功也只代表草稿落库
    const draftOnly = r.draftOnly !== false;
    return {
      success: true,
      postUrl: r.postUrl || '',
      postId: r.postId || '',
      draftSaved: draftOnly,
      verificationStatus: draftOnly ? 'draft_saved' : 'verified',
      verificationMessage: draftOnly
        ? `Saved as draft on ${r.platformName || extId} (wechatsync)`
        : `Published to ${r.platformName || extId} (wechatsync)`,
      publishMode: 'wechatsync',
      platform,
      syncId: res && res.syncId,
      elapsedMs: Date.now() - startedAt,
    };
  });
}

function status() {
  return {
    enabled: ENABLED,
    ready: state.ready,
    connected: isClientOpen(),
    platforms: [...enabledPlatformSet()],
    supportedPlatforms: Object.keys(PLATFORM_MAP),
    extDir: EXT_DIR,
    profileDir: PROFILE_DIR,
    wsPort: WS_PORT,
    httpPort: HTTP_PORT,
  };
}

async function shutdown() {
  state.shuttingDown = true;
  if (state.keepaliveTimer) {
    clearInterval(state.keepaliveTimer);
    state.keepaliveTimer = null;
  }
  try {
    if (state.wss) state.wss.close();
  } catch {
    /* ignore */
  }
  try {
    if (state.httpServer) state.httpServer.close();
  } catch {
    /* ignore */
  }
  try {
    if (state.ctx) await state.ctx.close();
  } catch {
    /* ignore */
  }
  state.ctx = null;
  state.warmPage = null;
  state.ready = false;
}

module.exports = {
  supports,
  isSupported,
  checkAuth,
  publish,
  status,
  shutdown,
  ensureReady,
  PLATFORM_MAP,
};
