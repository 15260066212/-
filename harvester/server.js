const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { FingerprintGenerator } = require('fingerprint-generator');
const { FingerprintInjector } = require('fingerprint-injector');

const {
  parseCookieString,
  filterCookiesByDomain,
  cookiesToString,
  isLoginRedirectUrl,
  getAuthCookieNames,
  PLATFORM_DOMAINS,
} = require('./lib/cookie-utils');
const { computeSessionValidityScore } = require('./lib/session-scoring');
const { buildSelectorValidationSummary } = require('./lib/selector-validator');
const { classifyCaptchaType } = require('./lib/captcha-classifier');
const { classifyLoginError } = require('./lib/error-classifier');
const {
  loadCredentials: loadCredentialsFromFile,
  saveCredentials: saveCredentialsToFile,
  getCredential: getCredentialFromFile,
  getAllCredentials: getAllCredentialsFromFile,
  upsertCredential: upsertCredentialToFile,
  deleteCredential: deleteCredentialFromFile,
} = require('./lib/credentials-store');

// 浏览器远程控制（noVNC 替代方案，WebSocket 截图传输）
const { registerRemoteControl, sessions: remoteSessions } = require('./remote-browser');

const app = express();
app.use(cors());
app.use(express.json());

// Fingerprint generator + injector for consistent browser fingerprints.
// Reduces bot detection and extends cookie / session lifespan.
const fingerprintGenerator = new FingerprintGenerator({
  devices: ['desktop'],
  operatingSystems: ['windows'],
  browsers: [{ name: 'chrome', minVersion: 120 }],
  locales: ['zh-CN'],
  screen: { minWidth: 1366, maxWidth: 1920, minHeight: 768, maxHeight: 1080 },
});
const fingerprintInjector = new FingerprintInjector();

const PORT = process.env.PORT || 3003;

// noVNC base URL
// Windows 本地部署: http://localhost:6080 (websockify + noVNC)
// Docker/nginx 部署: /novnc (通过 nginx 反向代理)
const NOVNC_BASE = process.env.NOVNC_BASE_URL || 'http://localhost:6080';

// Credentials storage path (auto-detect local vs Docker)
const CREDENTIALS_DIR = process.env.CREDENTIALS_DIR || (process.platform === 'win32' ? path.join(__dirname, 'data') : '/app/data');
const CREDENTIALS_FILE = path.join(CREDENTIALS_DIR, 'credentials.json');

// Ensure credentials directory exists
try {
  if (!fs.existsSync(CREDENTIALS_DIR)) {
    fs.mkdirSync(CREDENTIALS_DIR, { recursive: true });
  }
  if (!fs.existsSync(CREDENTIALS_FILE)) {
    fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify({}), 'utf-8');
  }
} catch (e) {
  console.error('[Credentials] Failed to initialize storage:', e.message);
}

// Active browser sessions: sessionId -> { browser, context, page, platform, createdAt }
const sessions = new Map();

// Session timeout: 10 minutes
const SESSION_TIMEOUT = 10 * 60 * 1000;

// Platform login URLs
const PLATFORM_URLS = {
  zhihu: 'https://www.zhihu.com/signin',
  baijiahao: 'https://baijiahao.baidu.com',
  toutiaohao: 'https://mp.toutiao.com',
  csdn: 'https://passport.csdn.net/login',
  juejin: 'https://juejin.cn/login',
  xiaohongshu: 'https://www.xiaohongshu.com',
  bilibili: 'https://passport.bilibili.com/login',
  sohuhao: 'https://mp.sohu.com',
  wangyihao: 'https://mp.163.com',
  zhidao: 'https://passport.baidu.com/v2/?login',
  wechat: 'https://mp.weixin.qq.com',
};

// Platform display names
const PLATFORM_NAMES = {
  zhihu: '知乎',
  baijiahao: '百家号',
  toutiaohao: '头条号',
  csdn: 'CSDN',
  juejin: '掘金',
  xiaohongshu: '小红书',
  bilibili: '哔哩哔哩',
  sohuhao: '搜狐号',
  wangyihao: '网易号',
  zhidao: '百度知道',
  wechat: '微信公众号',
};

// Platform cookie domains for filtering (imported from ./lib/cookie-utils)

// Platform check URLs (pages that require login, used for session validation)
const CHECK_URLS = {
  zhihu: 'https://www.zhihu.com/people/me',
  baijiahao: 'https://baijiahao.baidu.com/builder/rc/home',
  toutiaohao: 'https://mp.toutiao.com/profile_v4/index',
  csdn: 'https://mp.csdn.net/mp_blog/manage/article',
  juejin: 'https://juejin.cn/editor/drafts',
  xiaohongshu: 'https://creator.xiaohongshu.com/',
  bilibili: 'https://member.bilibili.com/',
  sohuhao: 'https://mp.sohu.com/',
  wangyihao: 'https://mp.163.com/',
  zhidao: 'https://zhidao.baidu.com/',
  wechat: 'https://mp.weixin.qq.com/',
};

// Platform-specific login redirect URL patterns (more precise than generic)
const PLATFORM_LOGIN_REDIRECTS = {
  zhihu: ['login', 'signin', 'sso.zhihu.com'],
  baijiahao: ['login', 'passport.baidu.com', 'wappass.baidu.com'],
  toutiaohao: ['login', 'sso.toutiao.com', 'passport.toutiao.com'],
  csdn: ['login', 'passport.csdn.net'],
  juejin: ['login', 'passport.juejin.cn'],
  xiaohongshu: ['login', 'gaia.xiaohongshu.com'],
  bilibili: ['login', 'passport.bilibili.com', 'passport.bilibili.tv'],
  sohuhao: ['login', 'passport.sohu.com'],
  wangyihao: ['login', 'passport.163.com', 'reg.163.com'],
  zhidao: ['login', 'passport.baidu.com', 'wappass.baidu.com'],
  wechat: ['login', 'mp.weixin.qq.com/cgi-bin/login'],
};

// Platform-specific login page text patterns
const PLATFORM_LOGIN_TEXTS = {
  zhihu: ['请登录', '登录知乎', '登录 / 注册', '扫码登录'],
  baijiahao: ['请登录', '登录百度', '扫码登录', '百度登录'],
  toutiaohao: ['请登录', '登录今日', '扫码登录'],
  csdn: ['登录 CSDN', '登录CSDN', '请登录', '扫码登录'],
  juejin: ['登录掘金', '请登录', '扫码登录'],
  xiaohongshu: ['登录小红书', '请登录', '扫码登录'],
  bilibili: ['登录哔哩', '扫码登录', '请登录'],
  sohuhao: ['登录搜狐', '请登录'],
  wangyihao: ['登录网易', '请登录', '网易邮箱登录'],
  zhidao: ['登录百度', '请登录', '扫码登录'],
  wechat: ['请登录', '扫码登录', '微信公众号登录'],
};

// Platform-specific logged-in element selectors (used to confirm valid session)
const PLATFORM_LOGGED_IN_SELECTORS = {
  zhihu: ['img.Avatar', '.AppHeader-userInfo', '.ProfileHeader-name', 'button[data-za-detail-view-element-name]'],
  baijiahao: ['.builder-home', '.home-index', '.u-wrap-header'],
  toutiaohao: ['.profile-v4', '.index-module', '.user-info'],
  csdn: ['.toolbar-search', '.blog-content', '#csdn-toolbar', '.user-login'],
  juejin: ['.drafts', '.publish-panel', '.entry-publish-form'],
  xiaohongshu: ['.creator-home', '.user-info', '.spectrum'],
  bilibili: ['.home-container', '.user-avatar', '.h-body'],
  sohuhao: ['.mp-sohu', '.home-container'],
  wangyihao: ['.mp-163', '.home-container'],
  zhidao: ['.user-bar', '.user-name'],
  wechat: ['.account_info', '.weui-desktop-card', '.card_content'],
};

// --- Credentials Storage Helpers (wrappers around lib/credentials-store) ---
function loadCredentials() {
  return loadCredentialsFromFile(CREDENTIALS_FILE);
}

function saveCredentials(creds) {
  return saveCredentialsToFile(CREDENTIALS_FILE, creds);
}

function upsertCredential(platform, data) {
  return upsertCredentialToFile(CREDENTIALS_FILE, platform, data);
}

function getCredential(platform) {
  return getCredentialFromFile(CREDENTIALS_FILE, platform);
}

function getAllCredentials() {
  return getAllCredentialsFromFile(CREDENTIALS_FILE);
}

function deleteCredential(platform) {
  return deleteCredentialFromFile(CREDENTIALS_FILE, platform);
}

// Clean up expired sessions
function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt.getTime() > SESSION_TIMEOUT) {
      console.log(`[Cleanup] Session ${id} expired, closing...`);
      closeSession(id).catch((e) => console.error(`Error closing session ${id}:`, e.message));
    }
  }
}

setInterval(cleanupExpiredSessions, 60 * 1000);

// Close a browser session
async function closeSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;

  try {
    if (session.page) await session.page.close().catch(() => {});
    if (session.context) await session.context.close().catch(() => {});
    if (session.browser) await session.browser.close().catch(() => {});
  } catch (e) {
    console.error(`Error closing browser for session ${sessionId}:`, e.message);
  } finally {
    sessions.delete(sessionId);
  }
}

/**
 * GET /remote/:sessionId
 * 浏览器远程控制页面（noVNC 替代方案）
 * 用户在浏览器中打开此页面，通过 WebSocket 截图操作 Playwright 浏览器
 */
app.get('/remote/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;
  if (!remoteSessions.has(sessionId)) {
    return res.status(404).send('Session not found');
  }
  
  const session = remoteSessions.get(sessionId);
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>浏览器远程控制 - ${session.platform}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #1a1a2e; color: #eee; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; overflow: hidden; }
    .header { background: #16213e; padding: 10px 20px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #0f3460; }
    .header h1 { font-size: 16px; font-weight: 600; }
    .status { display: flex; align-items: center; gap: 8px; font-size: 13px; }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #e94560; animation: pulse 2s infinite; }
    .status-dot.connected { background: #4ade80; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
    .browser-container { display: flex; justify-content: center; align-items: flex-start; padding: 15px; height: calc(100vh - 50px); overflow: auto; }
    #browser-frame { position: relative; display: inline-block; box-shadow: 0 10px 40px rgba(0,0,0,0.5); border-radius: 8px; overflow: hidden; background: white; }
    #screenshot { display: block; max-width: 100%; cursor: crosshair; }
    .toolbar { position: absolute; top: 8px; right: 8px; display: flex; gap: 6px; z-index: 10; }
    .toolbar button { background: rgba(0,0,0,0.75); color: white; border: 1px solid rgba(255,255,255,0.2); padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; backdrop-filter: blur(10px); }
    .toolbar button:hover { background: rgba(0,0,0,0.9); }
    .toolbar button.primary { background: #e94560; border-color: #e94560; }
    .url-bar { position: absolute; top: 0; left: 0; right: 0; background: rgba(255,255,255,0.95); padding: 6px 12px; font-size: 12px; color: #333; border-bottom: 1px solid #ddd; z-index: 5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: monospace; }
    .hint { margin-top: 10px; text-align: center; font-size: 12px; color: #888; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🌐 浏览器远程控制 - Cookie 采集 (${session.platform})</h1>
    <div class="status">
      <div class="status-dot" id="statusDot"></div>
      <span id="statusText">连接中...</span>
    </div>
  </div>
  <div class="browser-container">
    <div>
      <div id="browser-frame">
        <div class="url-bar" id="urlBar">加载中...</div>
        <div class="toolbar">
          <button onclick="goBack()">← 后退</button>
          <button onclick="refreshPage()">⟳ 刷新</button>
          <button class="primary" onclick="extractCookies()">📋 采集Cookie</button>
        </div>
        <img id="screenshot" alt="browser" draggable="false">
      </div>
      <div class="hint">💡 直接在截图上点击/输入即可操作浏览器。登录完成后点击"采集Cookie"</div>
    </div>
  </div>

<script>
const sessionId = '${sessionId}';
const img = document.getElementById('screenshot');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const urlBar = document.getElementById('urlBar');
let ws;
let lastImgTime = 0;

function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(proto + '//' + location.host + '/ws?session=' + sessionId);
  
  ws.onopen = () => {
    statusDot.classList.add('connected');
    statusText.textContent = '已连接';
    requestFrame();
  };
  
  ws.onclose = () => {
    statusDot.classList.remove('connected');
    statusText.textContent = '已断开，重连中...';
    setTimeout(connect, 2000);
  };
  
  ws.onmessage = (e) => {
    if (e.data instanceof Blob) {
      const url = URL.createObjectURL(e.data);
      img.onload = () => { URL.revokeObjectURL(img.src); };
      img.src = url;
      lastImgTime = Date.now();
      setTimeout(requestFrame, 80);
    } else {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'url') urlBar.textContent = msg.url;
        if (msg.type === 'cookies') {
          alert('✅ Cookie 采集完成！\\n\\n数量: ' + msg.count + ' 个\\n' + (msg.loggedIn ? '状态: 已登录 ✅' : '状态: 未检测到登录态 ⚠️') + '\\n\\n请告知管理员保存凭证。');
        }
      } catch(err) {}
    }
  };
}

function requestFrame() {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'frame' }));
  }
}

// 鼠标事件
img.addEventListener('mousedown', (e) => sendMouse(e, 'mousedown'));
img.addEventListener('mouseup', (e) => sendMouse(e, 'mouseup'));
img.addEventListener('mousemove', (e) => {
  if (e.buttons > 0) sendMouse(e, 'mousemove');
});
img.addEventListener('click', (e) => sendMouse(e, 'click'));
img.addEventListener('dblclick', (e) => sendMouse(e, 'dblclick'));
img.addEventListener('contextmenu', (e) => { e.preventDefault(); sendMouse(e, 'rightclick'); });
img.addEventListener('wheel', (e) => {
  e.preventDefault();
  const rect = img.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (img.naturalWidth / rect.width);
  const y = (e.clientY - rect.top) * (img.naturalHeight / rect.height);
  ws.send(JSON.stringify({ type: 'scroll', x: Math.round(x), y: Math.round(y), deltaY: e.deltaY }));
}, { passive: false });

function sendMouse(e, type) {
  const rect = img.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (img.naturalWidth / rect.width);
  const y = (e.clientY - rect.top) * (img.naturalHeight / rect.height);
  const button = e.button === 2 ? 'right' : (e.button === 1 ? 'middle' : 'left');
  ws.send(JSON.stringify({ type, x: Math.round(x), y: Math.round(y), button, clickCount: type === 'dblclick' ? 2 : 1 }));
}

// 键盘事件
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  e.preventDefault();
  ws.send(JSON.stringify({ type: 'keydown', key: e.key, code: e.code }));
});
document.addEventListener('keyup', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  ws.send(JSON.stringify({ type: 'keyup', key: e.key, code: e.code }));
});

function refreshPage() { ws.send(JSON.stringify({ type: 'refresh' })); }
function goBack() { ws.send(JSON.stringify({ type: 'back' })); }
function extractCookies() { ws.send(JSON.stringify({ type: 'extractCookies' })); }

connect();
</script>
</body>
</html>`;
  res.send(html);
});

/**
 * POST /api/session/start
 * Start a new browser session for a platform login.
 * Body: { platform: string }
 * Returns: { sessionId, noVncUrl, platformUrl }
 */
app.post('/api/session/start', async (req, res) => {
  const { platform } = req.body;

  if (!platform || !PLATFORM_URLS[platform]) {
    return res.status(400).json({
      success: false,
      error: `Invalid platform. Supported: ${Object.keys(PLATFORM_URLS).join(', ')}`,
    });
  }

  try {
    console.log(`[Session] Starting browser for platform: ${platform}`);

    // 使用持久化浏览器上下文（与 xtauto-framework 相同方案）
    // 每个平台独立的 Chrome Profile，Cookie 自动持久化
    const path = require('path');
    const fs = require('fs');
    const userDataDir = path.join(CREDENTIALS_DIR, 'browser-profiles', `chrome-${platform}`);
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }

    // 持久化上下文（launchPersistentContext 内置 browser + context）
    // 使用 kiosk 模式：真正全屏，无地址栏/工具栏/任务栏，noVNC 里只看到网页内容
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--kiosk',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--disable-features=IsolateOrigins,site-per-process,BookmarkBar',
        '--hide-crash-restore-bubble',
        '--password-store=basic',
      ],
      viewport: null,
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    // 注入反自动化检测脚本（xtauto-framework 同款）
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      window.chrome = { runtime: {}, app: {}, csi: {}, loadTimes: () => {} };
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5].map(i => ({ name: `Plugin ${i}`, filename: `plugin${i}.so` })),
      });
      Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
      // 覆盖 Permissions API
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(parameters)
      );
    });

    const pages = context.pages();
    const page = pages[0] || await context.newPage();

    // 确保浏览器窗口真正全屏（覆盖任务栏，noVNC 里只看到网页）
    try {
      const cdp = await context.newCDPSession(page);
      const windowId = (await cdp.send('Browser.getWindowForTarget')).windowId;
      // 先设位置和大小覆盖全屏
      await cdp.send('Browser.setWindowBounds', {
        windowId,
        bounds: { left: 0, top: 0, width: 2000, height: 1200 },
      });
      // 再设为 fullscreen 状态
      await cdp.send('Browser.setWindowBounds', {
        windowId,
        bounds: { windowState: 'fullscreen' },
      });
      // 获取实际屏幕尺寸并设置视口
      const { screenWidth, screenHeight } = await page.evaluate(() => ({
        screenWidth: window.screen.availWidth,
        screenHeight: window.screen.availHeight,
      }));
      await page.setViewportSize({ width: screenWidth, height: screenHeight });
    } catch (e) {
      console.log(`[Session] Fullscreen setup warning: ${e.message}`);
    }

    const loginUrl = PLATFORM_URLS[platform];

    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    sessions.set(sessionId, {
      browser: null, // 持久化模式下 browser 由 context 管理
      context,
      page,
      platform,
      loginUrl,
      userDataDir,
      createdAt: new Date(),
    });

    // 注册到远程控制会话（WebSocket 备选方案）
    remoteSessions.set(sessionId, { page, context, platform });

    console.log(`[Session] Created ${sessionId} for ${platform} (persistent: ${userDataDir})`);

    res.json({
      success: true,
      sessionId,
      platform,
      platformName: PLATFORM_NAMES[platform],
      loginUrl,
      noVncUrl: `${NOVNC_BASE}/vnc.html?autoconnect=true&resize=scale&password=geo123456`,
      remoteUrl: `http://localhost:${PORT}/remote/${sessionId}`,
      persistentProfile: userDataDir,
      message: `浏览器已启动，请在 noVNC 页面中完成 ${PLATFORM_NAMES[platform]} 登录`,
    });
  } catch (error) {
    console.error('[Session] Failed to start browser:', error);
    res.status(500).json({
      success: false,
      error: `Failed to start browser: ${error.message}`,
    });
  }
});

/**
 * GET /api/session/:sessionId/status
 * Check if the user has logged in (by checking for auth cookies).
 */
app.get('/api/session/:sessionId/status', async (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);

  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }

  try {
    const cookies = await session.context.cookies();
    const domains = PLATFORM_DOMAINS[session.platform] || [];

    // Check for common auth indicators
    const hasAuth = cookies.some((c) => {
      return domains.some((d) => c.domain.includes(d));
    });

    // Specific auth cookie checks per platform
    let authCookieFound = false;
    switch (session.platform) {
      case 'zhihu':
        authCookieFound = cookies.some((c) => c.name === 'z_c0');
        break;
      case 'baijiahao':
      case 'zhidao':
        authCookieFound = cookies.some((c) => c.name === 'BDUSS' || c.name === 'STOKEN');
        break;
      case 'toutiaohao':
        authCookieFound = cookies.some((c) => c.name === 'sessionid' || c.name === 's_v_web_id');
        break;
      case 'csdn':
        authCookieFound = cookies.some((c) => c.name === 'UserName' || c.name === 'UserToken' || c.name === 'C_SESSION');
        break;
      case 'juejin':
        authCookieFound = cookies.some((c) => c.name === 'sessionid' || c.name === 'sessionid_ss');
        break;
      case 'bilibili':
        authCookieFound = cookies.some((c) => c.name === 'SESSDATA' || c.name === 'bili_jct');
        break;
      case 'xiaohongshu':
        authCookieFound = cookies.some((c) => c.name === 'web_session' || c.name === 'a1');
        break;
      case 'sohuhao':
        authCookieFound = cookies.some((c) => c.name === 'SUV' || c.name === 'IPLOC');
        break;
      case 'wangyihao':
        authCookieFound = cookies.some((c) => c.name === 'NTES_CMT_USER_INFO' || c.name === 'P_INFO');
        break;
      case 'wechat':
        // WeChat uses QR code login; check for specific cookies
        authCookieFound = cookies.some((c) => c.name === 'slave_user' || c.name === 'slave_sid');
        break;
      default:
        authCookieFound = hasAuth;
    }

    res.json({
      success: true,
      sessionId,
      platform: session.platform,
      loggedIn: authCookieFound,
      cookieCount: cookies.length,
      elapsed: Date.now() - session.createdAt.getTime(),
    });
  } catch (error) {
    console.error('[Session] Failed to check status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/session/:sessionId/cookies
 * Extract cookies from the current browser session.
 * Auto-saves cookies to credentials storage when login is confirmed.
 */
app.get('/api/session/:sessionId/cookies', async (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);

  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }

  try {
    const allCookies = await session.context.cookies();
    const domains = PLATFORM_DOMAINS[session.platform] || [];

    // Filter cookies by platform domain
    const platformCookies = filterCookiesByDomain(allCookies, domains);

    // Convert to cookie header string format
    const cookieString = cookiesToString(platformCookies);

    // Also provide structured format
    const structuredCookies = platformCookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite,
    }));

    // Verify auth cookie exists
    const authCookieNames = getAuthCookieNames(session.platform);
    const hasAuthCookie = platformCookies.some((c) => authCookieNames.includes(c.name));

    console.log(`[Session] Extracted ${platformCookies.length} cookies for ${session.platform}, auth: ${hasAuthCookie}`);

    // Auto-save cookies to credentials storage when login is confirmed
    let autoSaved = false;
    if (hasAuthCookie && cookieString) {
      autoSaved = upsertCredential(session.platform, {
        type: 'cookie',
        data: { cookie: cookieString },
        status: 'active',
        cookieCount: platformCookies.length,
        lastValidatedAt: new Date().toISOString(),
        platformName: PLATFORM_NAMES[session.platform],
      });
      if (autoSaved) {
        console.log(`[Credentials] Auto-saved cookies for ${session.platform}`);
      }
    }

    res.json({
      success: true,
      sessionId,
      platform: session.platform,
      platformName: PLATFORM_NAMES[session.platform],
      loggedIn: hasAuthCookie,
      cookieString,
      cookies: structuredCookies,
      cookieCount: platformCookies.length,
      extractedAt: new Date().toISOString(),
      autoSaved,
    });
  } catch (error) {
    console.error('[Session] Failed to extract cookies:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/session/:sessionId/close
 * Close the browser session and clean up.
 */
app.post('/api/session/:sessionId/close', async (req, res) => {
  const { sessionId } = req.params;

  if (!sessions.has(sessionId)) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }

  try {
    await closeSession(sessionId);
    console.log(`[Session] Closed ${sessionId}`);
    res.json({ success: true, sessionId, message: 'Session closed' });
  } catch (error) {
    console.error('[Session] Failed to close session:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/platforms
 * List all supported platforms with saved status.
 */
app.get('/api/platforms', (req, res) => {
  const creds = loadCredentials();
  const platforms = Object.entries(PLATFORM_URLS).map(([id, url]) => ({
    id,
    name: PLATFORM_NAMES[id],
    loginUrl: url,
    hasCredentials: !!creds[id] && creds[id].status === 'active',
  }));

  res.json({
    success: true,
    platforms,
    count: platforms.length,
  });
});

/**
 * GET /api/sessions
 * List all active sessions.
 */
app.get('/api/sessions', (req, res) => {
  const activeSessions = Array.from(sessions.entries()).map(([id, s]) => ({
    sessionId: id,
    platform: s.platform,
    platformName: PLATFORM_NAMES[s.platform],
    createdAt: s.createdAt.toISOString(),
    elapsed: Date.now() - s.createdAt.getTime(),
  }));

  res.json({
    success: true,
    sessions: activeSessions,
    count: activeSessions.length,
  });
});

// --- Credentials Management API ---

/**
 * GET /api/credentials
 * List all saved credentials (masked).
 */
app.get('/api/credentials', (req, res) => {
  const creds = loadCredentials();
  const list = Object.values(creds).map(c => ({
    platform: c.platform,
    platformName: c.platformName || PLATFORM_NAMES[c.platform] || c.platform,
    type: c.type,
    status: c.status,
    cookieCount: c.cookieCount || 0,
    updatedAt: c.updatedAt,
    lastValidatedAt: c.lastValidatedAt,
    hasCookie: !!(c.data && c.data.cookie),
  }));

  res.json({
    success: true,
    data: list,
    count: list.length,
  });
});

/**
 * GET /api/credentials/:platform
 * Get credentials for a specific platform.
 */
app.get('/api/credentials/:platform', (req, res) => {
  const { platform } = req.params;
  const cred = getCredential(platform);

  if (!cred) {
    return res.status(404).json({ success: false, error: 'Credentials not found' });
  }

  res.json({
    success: true,
    data: cred,
  });
});

/**
 * PUT /api/credentials/:platform
 * Save credentials for a platform.
 * Body: { type, data, status }
 */
app.put('/api/credentials/:platform', (req, res) => {
  const { platform } = req.params;

  if (!PLATFORM_URLS[platform]) {
    return res.status(400).json({ success: false, error: `Invalid platform: ${platform}` });
  }

  const { type, data, status } = req.body;
  const saved = upsertCredential(platform, {
    type: type || 'cookie',
    data: data || {},
    status: status || 'active',
    cookieCount: (data && data.cookie) ? data.cookie.split(';').length : 0,
    lastValidatedAt: new Date().toISOString(),
    platformName: PLATFORM_NAMES[platform],
  });

  if (saved) {
    res.json({
      success: true,
      data: { platform, status: status || 'active', saved: true },
    });
  } else {
    res.status(500).json({ success: false, error: 'Failed to save credentials' });
  }
});

/**
 * DELETE /api/credentials/:platform
 * Delete credentials for a platform.
 */
app.delete('/api/credentials/:platform', (req, res) => {
  const { platform } = req.params;
  const deleted = deleteCredential(platform);

  if (deleted) {
    res.json({ success: true, data: { deleted: true } });
  } else {
    res.status(404).json({ success: false, error: 'Credentials not found' });
  }
});

/**
 * GET /health
 * Health check endpoint.
 */
app.get('/health', (req, res) => {
  const creds = loadCredentials();
  res.json({
    success: true,
    status: 'healthy',
    activeSessions: sessions.size,
    savedCredentials: Object.keys(creds).length,
    uptime: process.uptime(),
  });
});

// Auth cookie names and cookie parsing are imported from ./lib/cookie-utils

// Main server URL for credential sync
const MAIN_SERVER_URL = process.env.MAIN_SERVER_URL || 'http://localhost:3000';

/**
 * POST /api/credentials/sync
 * Sync all locally stored credentials to the main server.
 */
app.post('/api/credentials/sync', async (req, res) => {
  try {
    const creds = getAllCredentials();
    const results = [];

    for (const [platform, cred] of Object.entries(creds)) {
      if (!cred.data || !cred.data.cookie) {
        results.push({ platform, success: false, error: 'No cookie data' });
        continue;
      }

      const payload = {
        platform,
        type: 'cookie',
        data: { cookie: cred.data.cookie },
        status: cred.status || 'active',
      };

      try {
        const resp = await fetch(`${MAIN_SERVER_URL}/api/credentials/${platform}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (resp.ok) {
          results.push({ platform, success: true });
          console.log(`[Sync] Synced ${platform} credentials to main server`);
        } else {
          const text = await resp.text();
          results.push({ platform, success: false, error: `Server ${resp.status}: ${text}` });
        }
      } catch (e) {
        results.push({ platform, success: false, error: e.message });
      }
    }

    const allSuccess = results.every((r) => r.success);
    res.json({ success: allSuccess, results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/rpa/check-session
 * 程序化检测指定平台的 Cookie 会话是否有效。
 * Body: { platform: string, cookies?: string, storageState?: string, fingerprintData?: string }
 * Returns: { success: true, valid: boolean, reason: string, finalUrl: string, pageTitle: string, screenshot: string, checks: object }
 */
app.post('/api/rpa/check-session', async (req, res) => {
  const { platform, cookies: cookieStr, storageState: storageStateStr, fingerprintData: fingerprintDataStr } = req.body;

  // 校验平台参数
  if (!platform || !PLATFORM_URLS[platform]) {
    return res.status(400).json({
      success: false,
      error: `Invalid platform. Supported: ${Object.keys(PLATFORM_URLS).join(', ')}`,
    });
  }

  const hasCookie = cookieStr && typeof cookieStr === 'string' && cookieStr.trim() !== '';
  const hasStorageState = storageStateStr && typeof storageStateStr === 'string' && storageStateStr.trim() !== '';

  if (!hasCookie && !hasStorageState) {
    return res.status(400).json({
      success: false,
      error: 'Either cookies or storageState is required',
    });
  }

  let browser = null;
  let finalUrl = '';
  let pageTitle = '';
  let screenshot = '';
  const checks = {};

  try {
    console.log(
      `[RPA] Checking session validity for platform: ${platform} ` +
      `(storageState: ${hasStorageState}, fingerprint: ${!!fingerprintDataStr})`,
    );

    // Parse fingerprint if provided, otherwise generate a new one
    let browserFingerprint = null;
    if (fingerprintDataStr && typeof fingerprintDataStr === 'string') {
      try {
        browserFingerprint = JSON.parse(fingerprintDataStr);
      } catch (e) {
        console.warn(`[RPA] Failed to parse fingerprintData, generating new one:`, e.message);
        browserFingerprint = fingerprintGenerator.getFingerprint();
      }
    } else {
      browserFingerprint = fingerprintGenerator.getFingerprint();
    }

    // 启动无头浏览器
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
    });

    // Build context with fingerprint dimensions + UA
    const fp = browserFingerprint.fingerprint;
    const contextOptions = {
      viewport: { width: fp.screen.width, height: fp.screen.height },
      userAgent: fp.navigator.userAgent,
      deviceScaleFactor: fp.screen.devicePixelRatio,
      locale: 'zh-CN',
    };

    let context;
    if (hasStorageState) {
      // Full storageState restore (cookies + localStorage + IndexedDB)
      let storageStateObj;
      try {
        storageStateObj = JSON.parse(storageStateStr);
      } catch (e) {
        storageStateObj = null;
      }

      if (storageStateObj && Array.isArray(storageStateObj.cookies)) {
        contextOptions.storageState = storageStateObj;
        context = await browser.newContext(contextOptions);
      } else {
        // Fallback to cookie string if storageState parse fails
        context = await browser.newContext(contextOptions);
        const parsedCookies = parseCookieString(cookieStr || '', platform);
        if (parsedCookies.length > 0) {
          await context.addCookies(parsedCookies);
        }
      }
    } else {
      // Legacy: cookie string only
      const parsedCookies = parseCookieString(cookieStr, platform);
      if (parsedCookies.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Failed to parse cookies from the provided string',
        });
      }
      console.log(`[RPA] Parsed ${parsedCookies.length} cookies for ${platform}`);
      context = await browser.newContext(contextOptions);
      await context.addCookies(parsedCookies);
    }

    // Inject full browser fingerprint (navigator, screen, WebGL, etc.)
    await fingerprintInjector.attachFingerprintToPlaywright(context, browserFingerprint);

    const page = await context.newPage();
    const checkUrl = CHECK_URLS[platform];

    // 导航到检测页面
    await page.goto(checkUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // 等待页面稳定 - 先等 networkidle，超时后降级等待 domcontentloaded
    try {
      await page.waitForLoadState('networkidle', { timeout: 8000 });
    } catch (e) {
      // networkidle 超时不视为错误，额外等待2秒让SPA渲染
      await page.waitForTimeout(2000);
    }

    finalUrl = page.url();
    pageTitle = await page.title().catch(() => '');

    console.log(`[RPA] ${platform} final URL: ${finalUrl}`);
    console.log(`[RPA] ${platform} page title: ${pageTitle}`);

    // --- 检测方法 1: URL 跳转检测 ---
    const platformRedirects = PLATFORM_LOGIN_REDIRECTS[platform] || ['login', 'passport', 'signin', 'register'];
    const isLoginUrl = isLoginRedirectUrl(finalUrl, platformRedirects);
    checks.urlRedirect = { result: isLoginUrl ? 'login_page' : 'ok', detail: finalUrl };

    // --- 检测方法 2: 认证 Cookie 检测 ---
    const allCookies = await context.cookies();
    const authCookieNames = getAuthCookieNames(platform);
    const hasAuthCookie = allCookies.some((c) => authCookieNames.includes(c.name));
    checks.authCookie = { result: hasAuthCookie ? 'present' : 'missing', detail: `auth cookies: ${authCookieNames.join(', ')}` };

    // --- 检测方法 3: 页面文本检测 ---
    let pageText = '';
    try {
      pageText = await page.textContent('body', { timeout: 5000 });
    } catch (e) {
      pageText = '';
    }
    const platformTexts = PLATFORM_LOGIN_TEXTS[platform] || ['请登录', '立即登录', '登录 / 注册', '登录/注册'];
    const hasLoginText = platformTexts.some((p) => pageText.includes(p));
    checks.loginText = { result: hasLoginText ? 'found' : 'not_found', detail: platformTexts.join('|') };

    // --- 检测方法 4: 平台特定元素检测 ---
    const loggedInSelectors = PLATFORM_LOGGED_IN_SELECTORS[platform] || [];
    let hasLoggedInElement = false;
    let matchedSelector = '';
    if (loggedInSelectors.length > 0) {
      for (const selector of loggedInSelectors) {
        try {
          const el = await page.$(selector);
          if (el) {
            hasLoggedInElement = true;
            matchedSelector = selector;
            break;
          }
        } catch (e) {
          // selector not found, continue
        }
      }
    }
    checks.loggedInElement = {
      result: hasLoggedInElement ? 'found' : 'not_found',
      detail: matchedSelector || loggedInSelectors.join(', '),
    };

    // --- 截图作为证据 ---
    try {
      screenshot = await page.screenshot({ type: 'jpeg', quality: 50, fullPage: false });
      screenshot = `data:image/jpeg;base64,${screenshot.toString('base64')}`;
    } catch (e) {
      console.warn(`[RPA] Screenshot failed: ${e.message}`);
    }

    // --- 综合评分判断 ---
    const { valid, score, reason } = computeSessionValidityScore({
      isLoginUrl,
      hasAuthCookie,
      hasLoginText,
      hasLoggedInElement,
      matchedSelector,
    });

    console.log(`[RPA] ${platform} session valid: ${valid}, score: ${score}, reason: ${reason}`);

    res.json({
      success: true,
      valid,
      reason,
      finalUrl,
      pageTitle,
      screenshot: screenshot || undefined,
      checks,
    });
  } catch (error) {
    console.error('[RPA] Failed to check session:', error);
    res.status(500).json({
      success: false,
      error: `Failed to check session: ${error.message}`,
    });
  } finally {
    // 确保浏览器始终被关闭
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        console.error('[RPA] Error closing browser:', e.message);
      }
    }
  }
});

// === Cookie Refresh Endpoint ===
// Visits a platform page with existing cookies / storageState / fingerprint,
// lets the platform issue fresh Set-Cookie headers, extracts the updated
// browser state (cookies + localStorage + fingerprint), and returns them.
//
// Request body (all optional, but at least one auth method required):
//   - platform: string (required)
//   - cookies: legacy cookie string
//   - storageState: full Playwright storageState JSON string (preferred)
//   - fingerprintData: browser fingerprint JSON string from fingerprint-suite
//
// Response includes:
//   - refreshedCookies: legacy cookie string (backward compatible)
//   - refreshedStorageState: full storageState JSON string
//   - refreshedFingerprintData: echo of the input fingerprint (consistent across refreshes)
app.post('/api/rpa/refresh-cookies', async (req, res) => {
  const { platform, cookies: cookieStr, storageState: storageStateStr, fingerprintData: fingerprintDataStr } = req.body;

  if (!platform || !PLATFORM_URLS[platform]) {
    return res.status(400).json({
      success: false,
      error: `Invalid platform. Supported: ${Object.keys(PLATFORM_URLS).join(', ')}`,
    });
  }

  const hasCookie = cookieStr && typeof cookieStr === 'string' && cookieStr.trim() !== '';
  const hasStorageState = storageStateStr && typeof storageStateStr === 'string' && storageStateStr.trim() !== '';

  if (!hasCookie && !hasStorageState) {
    return res.status(400).json({
      success: false,
      error: 'Either cookies or storageState is required',
    });
  }

  let browser = null;
  try {
    console.log(
      `[RPA] Refreshing cookies for platform: ${platform} ` +
      `(storageState: ${hasStorageState}, fingerprint: ${!!fingerprintDataStr})`,
    );

    // Parse fingerprint if provided, otherwise generate a new one
    let browserFingerprint = null;
    if (fingerprintDataStr && typeof fingerprintDataStr === 'string') {
      try {
        browserFingerprint = JSON.parse(fingerprintDataStr);
        console.log(`[RPA] Using persisted fingerprint for ${platform}`);
      } catch (e) {
        console.warn(`[RPA] Failed to parse fingerprintData, generating new one:`, e.message);
        browserFingerprint = fingerprintGenerator.getFingerprint();
      }
    } else {
      browserFingerprint = fingerprintGenerator.getFingerprint();
    }

    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    // Build context options: prefer storageState, fallback to cookie string
    const fp = browserFingerprint.fingerprint;
    const contextOptions = {
      viewport: { width: fp.screen.width, height: fp.screen.height },
      userAgent: fp.navigator.userAgent,
      deviceScaleFactor: fp.screen.devicePixelRatio,
      locale: 'zh-CN',
    };

    let context;
    if (hasStorageState) {
      // Full storageState restore (cookies + localStorage + IndexedDB)
      let storageStateObj;
      try {
        storageStateObj = JSON.parse(storageStateStr);
      } catch (e) {
        // Fallback: treat as legacy cookie string if JSON parse fails
        storageStateObj = null;
      }

      if (storageStateObj && Array.isArray(storageStateObj.cookies)) {
        contextOptions.storageState = storageStateObj;
        context = await browser.newContext(contextOptions);
      } else {
        context = await browser.newContext(contextOptions);
        const parsedCookies = parseCookieString(cookieStr || '', platform);
        if (parsedCookies.length > 0) {
          await context.addCookies(parsedCookies);
        }
      }
    } else {
      // Legacy: cookie string only
      context = await browser.newContext(contextOptions);
      const parsedCookies = parseCookieString(cookieStr, platform);
      if (parsedCookies.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Failed to parse cookies from the provided string',
        });
      }
      await context.addCookies(parsedCookies);
    }

    // Inject full browser fingerprint (navigator, screen, WebGL, etc.)
    await fingerprintInjector.attachFingerprintToPlaywright(context, browserFingerprint);

    const page = await context.newPage();
    const checkUrl = CHECK_URLS[platform];

    // Navigate to platform page - this triggers Set-Cookie refresh
    await page.goto(checkUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    try {
      await page.waitForLoadState('networkidle', { timeout: 10000 });
    } catch {
      await page.waitForTimeout(3000);
    }

    // Also visit the main domain to trigger root-domain cookie refresh
    const mainUrl = PLATFORM_URLS[platform];
    if (mainUrl && !mainUrl.includes(checkUrl.split('/')[2])) {
      try {
        await page.goto(mainUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(2000);
      } catch {
        // Non-critical, continue
      }
    }

    // Extract all cookies from the context (including refreshed ones)
    const allCookies = await context.cookies();
    const platformDomains = PLATFORM_DOMAINS[platform] || [];

    // Filter cookies to platform-relevant domains
    const filteredCookies = filterCookiesByDomain(allCookies, platformDomains);

    // Convert to cookie header string (legacy format)
    const refreshedCookieStr = cookiesToString(filteredCookies);

    // Extract full storageState (cookies + localStorage + IndexedDB origins)
    const storageState = await context.storageState();

    // Check if auth cookies are still present
    const authCookieNames = getAuthCookieNames(platform);
    const hasAuthCookie = filteredCookies.some((c) => authCookieNames.includes(c.name));

    // Detect if redirected to login
    const finalUrl = page.url();
    const platformRedirects = PLATFORM_LOGIN_REDIRECTS[platform] || ['login', 'passport', 'signin', 'register'];
    const isLoginUrl = isLoginRedirectUrl(finalUrl, platformRedirects);

    const valid = hasAuthCookie && !isLoginUrl;

    console.log(
      `[RPA] Cookie refresh for ${platform}: valid=${valid}, ` +
      `cookies=${filteredCookies.length}, hasAuth=${hasAuthCookie}, ` +
      `origins=${storageState.origins?.length || 0}`,
    );

    res.json({
      success: true,
      valid,
      // Legacy: plain cookie string (backward compatible)
      refreshedCookies: refreshedCookieStr,
      cookieCount: filteredCookies.length,
      // New: full storageState (cookies + localStorage + IndexedDB)
      refreshedStorageState: JSON.stringify(storageState),
      // New: fingerprint (echoed back for persistence — same fingerprint is reused)
      refreshedFingerprintData: JSON.stringify(browserFingerprint),
      hasAuthCookie,
      finalUrl,
      isLoginUrl,
      reason: valid
        ? 'Cookies refreshed successfully'
        : isLoginUrl
          ? 'Redirected to login page - cookies may be expired'
          : 'Auth cookie missing after refresh',
    });

    await context.close();
  } catch (error) {
    console.error('[RPA] Failed to refresh cookies:', error);
    res.status(500).json({
      success: false,
      error: `Failed to refresh cookies: ${error.message}`,
    });
  } finally {
    if (browser) {
      try { await browser.close(); } catch (e) {
        console.error('[RPA] Error closing browser:', e.message);
      }
    }
  }
});

// === Auto Relogin Configuration ===

/**
 * Per-platform login form selectors and flow configuration.
 * Only platforms with username/password login forms are included.
 * Platforms requiring QR code or SMS verification are NOT supported for auto-relogin.
 */
const LOGIN_CONFIG = {
  csdn: {
    loginUrl: 'https://passport.csdn.net/login',
    usernameSelector: 'input[type="text"], input[name="username"], input[placeholder*="手机"], input[placeholder*="邮箱"]',
    passwordSelector: 'input[type="password"], input[name="password"]',
    submitSelector: 'button[type="submit"], button:has-text("登录"), .btn-login, .btn-primary',
    switchToPasswordSelector: '.btn-group a:has-text("账号登录"), .tab-group a:has-text("账号登录"), a:has-text("账号登录")',
    successUrl: 'csdn.net',
    successSelectors: ['#csdn-toolbar', '.toolbar-search', '.blog-content'],
    captchaSelectors: ['.geetest', '.captcha', '#captcha', '.verify-wrap'],
    maxWaitMs: 20000,
  },
  juejin: {
    loginUrl: 'https://juejin.cn/login',
    usernameSelector: 'input[placeholder*="手机"], input[type="tel"], input[name="phone"]',
    passwordSelector: 'input[type="password"]',
    submitSelector: 'button:has-text("登录"), button.btn-login, .login-btn',
    switchToPasswordSelector: '.switch-account, a:has-text("密码登录"), .login-type:has-text("密码登录")',
    successUrl: 'juejin.cn',
    successSelectors: ['.drafts', '.publish-panel', '.entry-publish-form', '.user-avatar'],
    captchaSelectors: ['.geetest', '.captcha', '#captcha'],
    maxWaitMs: 20000,
  },
  bilibili: {
    loginUrl: 'https://passport.bilibili.com/login',
    usernameSelector: 'input[placeholder*="手机"], input[type="text"], input[name="username"]',
    passwordSelector: 'input[type="password"]',
    submitSelector: 'button:has-text("登录"), .btn-login, #login-btn',
    switchToPasswordSelector: '.login-tab:has-text("密码登录"), a:has-text("密码登录")',
    successUrl: 'bilibili.com',
    successSelectors: ['.home-container', '.user-avatar', '.h-body'],
    captchaSelectors: ['.geetest', '.captcha', '#captcha', '.nc_wrapper'],
    maxWaitMs: 20000,
  },
};

/**
 * POST /api/rpa/relogin
 *
 * Attempts automatic login for platforms with username/password forms.
 * Returns new cookies on success, or error type on failure (captcha, wrong password, etc).
 *
 * Request body:
 *   - platform: string (csdn, juejin, bilibili)
 *   - username: string
 *   - password: string
 *
 * Response:
 *   - success: boolean
 *   - cookies: string (cookie header string, only on success)
 *   - cookieCount: number
 *   - error: string (on failure)
 *   - errorType: 'captcha' | 'invalid_credentials' | 'network' | 'unsupported' | 'unknown'
 *   - screenshot: string (base64 data URI)
 *   - finalUrl: string
 */
app.post('/api/rpa/relogin', async (req, res) => {
  const { platform, username, password } = req.body;

  if (!platform || !LOGIN_CONFIG[platform]) {
    return res.status(400).json({
      success: false,
      error: `Platform '${platform}' does not support auto-relogin. Supported: ${Object.keys(LOGIN_CONFIG).join(', ')}`,
      errorType: 'unsupported',
    });
  }

  if (!username || !password) {
    return res.status(400).json({
      success: false,
      error: 'Username and password are required',
      errorType: 'invalid_credentials',
    });
  }

  const config = LOGIN_CONFIG[platform];
  let browser = null;
  let screenshot = '';

  try {
    console.log(`[RPA] Attempting auto-relogin for ${platform} (user: ${username})`);

    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.5493.5 Safari/537.36',
    });

    const page = await context.newPage();

    // Step 1: Navigate to login page
    console.log(`[RPA] Navigating to ${config.loginUrl}`);
    await page.goto(config.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for page to fully render
    try {
      await page.waitForLoadState('networkidle', { timeout: 8000 });
    } catch {
      await page.waitForTimeout(2000);
    }

    // Step 2: Switch to password login mode if needed (some platforms default to QR code)
    if (config.switchToPasswordSelector) {
      try {
        const switchBtn = await page.$(config.switchToPasswordSelector);
        if (switchBtn) {
          await switchBtn.click();
          await page.waitForTimeout(1000);
          console.log(`[RPA] Switched to password login mode for ${platform}`);
        }
      } catch (e) {
        console.log(`[RPA] No switch needed for ${platform} (or switch failed: ${e.message})`);
      }
    }

    // Step 3: Fill username and password
    const usernameInput = await page.$(config.usernameSelector);
    if (!usernameInput) {
      screenshot = await takeScreenshot(page);
      const finalUrl = page.url();
      await browser.close();
      return res.json({
        success: false,
        error: `Username input not found. The login page structure may have changed.`,
        errorType: 'unknown',
        screenshot,
        finalUrl,
      });
    }

    await usernameInput.click({ clickCount: 3 }); // Clear existing
    await usernameInput.fill(username);
    await page.waitForTimeout(500);

    const passwordInput = await page.$(config.passwordSelector);
    if (!passwordInput) {
      screenshot = await takeScreenshot(page);
      const finalUrl = page.url();
      await browser.close();
      return res.json({
        success: false,
        error: `Password input not found. The login page structure may have changed.`,
        errorType: 'unknown',
        screenshot,
        finalUrl,
      });
    }

    await passwordInput.click({ clickCount: 3 });
    await passwordInput.fill(password);
    await page.waitForTimeout(500);

    // Step 4: Check for captcha before submitting
    let captchaDetected = false;
    for (const captchaSel of config.captchaSelectors) {
      try {
        const captchaEl = await page.$(captchaSel);
        if (captchaEl && await captchaEl.isVisible()) {
          captchaDetected = true;
          break;
        }
      } catch {}
    }

    if (captchaDetected) {
      screenshot = await takeScreenshot(page);
      const finalUrl = page.url();
      await browser.close();
      console.log(`[RPA] Captcha detected for ${platform} - manual intervention required`);
      return res.json({
        success: false,
        error: 'Captcha detected during login. Manual intervention required.',
        errorType: 'captcha',
        screenshot,
        finalUrl,
      });
    }

    // Step 5: Click submit
    const submitBtn = await page.$(config.submitSelector);
    if (!submitBtn) {
      // Try pressing Enter on password field
      await passwordInput.press('Enter');
      console.log(`[RPA] Submit button not found, pressed Enter on password field for ${platform}`);
    } else {
      await submitBtn.click();
      console.log(`[RPA] Clicked submit button for ${platform}`);
    }

    // Step 6: Wait for navigation or result
    try {
      await page.waitForURL((url) => {
        const urlStr = url.toString();
        return urlStr.includes(config.successUrl) && !urlStr.includes('login');
      }, { timeout: config.maxWaitMs });
    } catch {
      // Navigation timeout - check for captcha or error messages
      await page.waitForTimeout(2000);
    }

    // Step 7: Check for captcha after submit
    for (const captchaSel of config.captchaSelectors) {
      try {
        const captchaEl = await page.$(captchaSel);
        if (captchaEl && await captchaEl.isVisible()) {
          captchaDetected = true;
          break;
        }
      } catch {}
    }

    if (captchaDetected) {
      screenshot = await takeScreenshot(page);
      const finalUrl = page.url();
      await browser.close();
      console.log(`[RPA] Post-submit captcha detected for ${platform}`);
      return res.json({
        success: false,
        error: 'Captcha appeared after login attempt. Manual intervention required.',
        errorType: 'captcha',
        screenshot,
        finalUrl,
      });
    }

    // Step 8: Verify login success
    const finalUrl = page.url();
    const isOnSuccessPage = finalUrl.includes(config.successUrl) && !finalUrl.includes('login');

    let loggedInElement = false;
    for (const sel of config.successSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          loggedInElement = true;
          break;
        }
      } catch {}
    }

    // Also check auth cookies
    const allCookies = await context.cookies();
    const authCookieNames = getAuthCookieNames(platform);
    const hasAuthCookie = allCookies.some((c) => authCookieNames.includes(c.name));

    if (isOnSuccessPage || loggedInElement || hasAuthCookie) {
      // Login successful! Extract cookies
      const domains = PLATFORM_DOMAINS[platform] || [];
      const filteredCookies = domains.length > 0
        ? filterCookiesByDomain(allCookies, domains)
        : allCookies;

      const cookieStr = cookiesToString(filteredCookies);

      // Auto-save to local credentials
      upsertCredential(platform, {
        type: 'cookie',
        data: { cookieString: cookieStr },
        status: 'active',
        cookieCount: filteredCookies.length,
        lastValidatedAt: new Date().toISOString(),
        platformName: PLATFORM_NAMES[platform],
      });

      console.log(`[RPA] Relogin successful for ${platform} (${filteredCookies.length} cookies)`);

      // Sync credentials to main server
      try {
        const syncRes = await fetch(`${MAIN_SERVER_URL}/api/credentials/${platform}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'cookie',
            data: { cookieString: cookieStr },
          }),
        });
        if (syncRes.ok) {
          console.log(`[RPA] Synced relogged credentials for ${platform} to main server`);
        }
      } catch (e) {
        console.warn(`[RPA] Failed to sync credentials: ${e.message}`);
      }

      res.json({
        success: true,
        cookies: cookieStr,
        cookieCount: filteredCookies.length,
        finalUrl,
        hasAuthCookie,
        loggedInElement,
      });
    } else {
      // Login failed - check for error messages
      let pageText = '';
      try {
        pageText = await page.textContent('body', { timeout: 5000 });
      } catch {}

      const errorType = classifyLoginError(pageText);
      const errorMessage = errorType !== 'unknown'
        ? `Login failed: ${errorType}`
        : `Login failed. URL: ${finalUrl}`;

      screenshot = await takeScreenshot(page);
      console.log(`[RPA] Relogin failed for ${platform}: ${errorMessage} (${errorType})`);

      res.json({
        success: false,
        error: errorMessage,
        errorType,
        screenshot,
        finalUrl,
      });
    }
  } catch (error) {
    console.error(`[RPA] Relogin error for ${platform}:`, error);
    res.status(500).json({
      success: false,
      error: `Relogin failed: ${error.message}`,
      errorType: error.message.includes('net::ERR') || error.message.includes('Timeout') ? 'network' : 'unknown',
    });
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        console.error('[RPA] Error closing browser:', e.message);
      }
    }
  }
});

/**
 * Take a screenshot and return as base64 data URI.
 */
async function takeScreenshot(page) {
  try {
    const buf = await page.screenshot({ type: 'jpeg', quality: 50, fullPage: false });
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch (e) {
    console.warn(`[RPA] Screenshot failed: ${e.message}`);
    return '';
  }
}

/**
 * POST /api/rpa/validate-selectors
 *
 * Validates CSS selectors against a live platform page to detect
 * structural changes before they cause publish failures.
 *
 * Request body:
 *   - platform: string (platform name)
 *   - url: string (URL to navigate to)
 *   - selectors: Array<{ selector: string, purpose: string }>
 *
 * Response:
 *   - success: boolean
 *   - platform: string
 *   - finalUrl: string
 *   - results: Array<{ selector, purpose, found, count, visible }>
 *   - summary: { total, found, missing, byPurpose }
 *   - screenshot: string (base64)
 */
app.post('/api/rpa/validate-selectors', async (req, res) => {
  const { platform, url, selectors } = req.body;

  if (!platform || !url || !Array.isArray(selectors) || selectors.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'platform, url, and selectors[] are required',
    });
  }

  let browser = null;

  try {
    console.log(`[RPA] Validating ${selectors.length} selectors for ${platform} at ${url}`);

    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.5493.5 Safari/537.36',
    });

    const page = await context.newPage();

    // Navigate to the target page
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e) {
      return res.json({
        success: false,
        platform,
        error: `Failed to navigate to ${url}: ${e.message}`,
        errorType: 'network',
      });
    }

    // Wait for page to settle
    try {
      await page.waitForLoadState('networkidle', { timeout: 8000 });
    } catch {
      await page.waitForTimeout(2000);
    }

    const finalUrl = page.url();
    let pageTitle = '';
    try {
      pageTitle = await page.title();
    } catch {}

    // Validate each selector
    const results = [];
    const seenSelectors = new Set();

    for (const { selector, purpose } of selectors) {
      // Deduplicate identical selectors
      const key = `${selector}`;
      if (seenSelectors.has(key)) continue;
      seenSelectors.add(key);

      try {
        const elements = await page.$$(selector);
        let visible = false;
        if (elements.length > 0) {
          // Check if at least one element is visible
          for (const el of elements) {
            try {
              if (await el.isVisible()) {
                visible = true;
                break;
              }
            } catch {}
          }
        }

        results.push({
          selector,
          purpose: purpose || 'unknown',
          found: elements.length > 0,
          count: elements.length,
          visible,
        });
      } catch (e) {
        results.push({
          selector,
          purpose: purpose || 'unknown',
          found: false,
          count: 0,
          visible: false,
          error: e.message,
        });
      }
    }

    // Build summary
    const summary = buildSelectorValidationSummary(results);

    const screenshot = await takeScreenshot(page);

    console.log(`[RPA] Selector validation for ${platform}: ${summary.found}/${summary.total} found, ${summary.brokenPurposes.length} broken purposes`);

    res.json({
      success: true,
      platform,
      finalUrl,
      pageTitle,
      results,
      summary,
      screenshot,
    });
  } catch (error) {
    console.error(`[RPA] Selector validation error for ${platform}:`, error);
    res.status(500).json({
      success: false,
      platform,
      error: `Validation failed: ${error.message}`,
      errorType: error.message.includes('net::ERR') || error.message.includes('Timeout') ? 'network' : 'unknown',
    });
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        console.error('[RPA] Error closing browser:', e.message);
      }
    }
  }
});

/**
 * POST /api/rpa/detect-captcha
 *
 * Detects captcha elements on a page during RPA operations.
 * Uses both platform-specific and generic captcha selectors.
 *
 * Request body:
 *   - platform: string
 *   - url: string (page to check)
 *   - cookies: string (optional, for authenticated pages)
 *
 * Response:
 *   - detected: boolean
 *   - captchaType: string
 *   - selector: string
 *   - allMatches: Array<{ selector, type, found, visible }>
 *   - screenshot: string
 */
app.post('/api/rpa/detect-captcha', async (req, res) => {
  const { platform, url, cookies } = req.body;

  if (!platform || !url) {
    return res.status(400).json({
      success: false,
      error: 'platform and url are required',
    });
  }

  // Platform-specific captcha selectors
  const PLATFORM_CAPTCHA_SELECTORS = {
    csdn: ['.geetest', '.captcha', '#captcha', '.verify-wrap', '.geetest_widget', '.geetest_slider_button'],
    zhihu: ['.geetest', '.Captcha', '#js-captcha', '.sign-container .captcha', '.verify-modal'],
    baijia: ['.geetest', '.captcha', '#captcha', '.verify-wrap', '.nc_wrapper'],
    toutiao: ['.captcha', '#captcha', '.geetest', '.verify-modality', '.captcha_container'],
    juejin: ['.geetest', '.captcha', '#captcha', '.JCaptcha'],
    xiaohongshu: ['.captcha', '#captcha', '.geetest', '.verify-container', '.captcha-modal'],
    bilibili: ['.geetest', '.captcha', '#captcha', '.nc_wrapper', '.geetest_widget'],
    sohu: ['.captcha', '#captcha', '.geetest'],
    netease: ['.captcha', '#captcha', '.geetest', '.nc-container'],
    zhidao: ['.captcha', '#captcha', '.geetest', '.verifyCode'],
    wechat: [],
  };

  // Generic selectors that apply to all platforms
  const GENERIC_SELECTORS = [
    '.geetest_panel',
    '.geetest_widget',
    '.geetest_slider',
    'iframe[src*="captcha"]',
    'iframe[src*="verify"]',
    'img[src*="captcha"]',
    'img[src*="verify"]',
    'canvas[id*="captcha"]',
    '[class*="captcha"][class*="modal"]',
    '[class*="verify"][class*="modal"]',
    '[id*="captchaModal"]',
  ];

  const platformSelectors = PLATFORM_CAPTCHA_SELECTORS[platform] || [];
  const allSelectors = [...platformSelectors, ...GENERIC_SELECTORS];

  let browser = null;

  try {
    console.log(`[RPA] Detecting captcha for ${platform} at ${url}`);

    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.5493.5 Safari/537.36',
    });

    // Set cookies if provided (for authenticated pages)
    if (cookies) {
      const cookiePairs = cookies.split(';').map((c) => c.trim()).filter(Boolean);
      const cookieObjects = cookiePairs.map((pair) => {
        const [name, ...valueParts] = pair.split('=');
        return {
          name: name.trim(),
          value: valueParts.join('=').trim(),
          domain: new URL(url).hostname,
          path: '/',
        };
      });
      if (cookieObjects.length > 0) {
        await context.addCookies(cookieObjects);
      }
    }

    const page = await context.newPage();

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e) {
      return res.json({
        success: false,
        platform,
        error: `Failed to navigate to ${url}: ${e.message}`,
        errorType: 'network',
      });
    }

    // Wait for page to settle
    try {
      await page.waitForLoadState('networkidle', { timeout: 5000 });
    } catch {
      await page.waitForTimeout(2000);
    }

    // Check all captcha selectors
    const matches = [];
    let captchaDetected = false;
    let detectedType = 'none';
    let detectedSelector = '';

    for (const selector of allSelectors) {
      try {
        const elements = await page.$$(selector);
        if (elements.length > 0) {
          let visible = false;
          for (const el of elements) {
            try {
              if (await el.isVisible()) {
                visible = true;
                break;
              }
            } catch {}
          }

          // Classify captcha type from selector
          const type = classifyCaptchaType(selector);

          matches.push({ selector, type, found: true, count: elements.length, visible });

          if (visible && !captchaDetected) {
            captchaDetected = true;
            detectedType = type;
            detectedSelector = selector;
          }
        }
      } catch {}
    }

    const screenshot = await takeScreenshot(page);
    const finalUrl = page.url();

    console.log(`[RPA] Captcha detection for ${platform}: ${captchaDetected ? 'DETECTED' : 'none'} (${matches.length} matches)`);

    res.json({
      success: true,
      platform,
      detected: captchaDetected,
      captchaType: detectedType,
      selector: detectedSelector,
      allMatches: matches,
      finalUrl,
      screenshot,
    });
  } catch (error) {
    console.error(`[RPA] Captcha detection error for ${platform}:`, error);
    res.status(500).json({
      success: false,
      platform,
      error: `Detection failed: ${error.message}`,
    });
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        console.error('[RPA] Error closing browser:', e.message);
      }
    }
  }
});

// === Publish Endpoint ===
// POST /rpa/publish - Publish an article to a platform using RPA
app.post('/rpa/publish', async (req, res) => {
  const { platform, article, credentials } = req.body;

  if (!platform || !PLATFORM_URLS[platform]) {
    return res.status(400).json({
      success: false,
      error: `Invalid platform. Supported: ${Object.keys(PLATFORM_URLS).join(', ')}`,
    });
  }

  if (!article || !article.title || !article.contentMarkdown) {
    return res.status(400).json({
      success: false,
      error: 'article with title and contentMarkdown is required',
    });
  }

  const cookieStr = credentials?.data?.cookie || credentials?.data?.cookies || credentials?.cookie || '';
  if (!cookieStr || cookieStr === 'placeholder_pending_login') {
    return res.status(400).json({
      success: false,
      error: 'Valid cookies are required for publishing',
    });
  }

  let browser = null;
  try {
    console.log(`[RPA] Publishing to ${platform}: articleId=${article.id}, title="${article.title}"`);

    const parsedCookies = parseCookieString(cookieStr, platform);
    if (parsedCookies.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Failed to parse cookies',
      });
    }

    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      locale: 'zh-CN',
    });

    await context.addCookies(parsedCookies);
    const page = await context.newPage();

    const PUBLISH_URLS = {
      zhihu: 'https://zhuanlan.zhihu.com/write',
      baijiahao: 'https://baijiahao.baidu.com/builder/rc/edit?type=news',
      toutiaohao: 'https://mp.toutiao.com/profile_v4/graphic/publish',
      csdn: 'https://editor.csdn.net/md/',
      juejin: 'https://juejin.cn/editor/drafts/new?v=2',
      xiaohongshu: 'https://creator.xiaohongshu.com/publish/publish',
      bilibili: 'https://member.bilibili.com/article-text/home',
      sohuhao: 'https://mp.sohu.com/mpfe/static/main/edit.html',
      wangyihao: 'https://mp.163.com/editor/article.html',
      wechat: 'https://mp.weixin.qq.com/',
    };

    const publishUrl = PUBLISH_URLS[platform];
    if (!publishUrl) {
      return res.status(400).json({
        success: false,
        error: `Publish URL not configured for platform: ${platform}`,
      });
    }

    console.log(`[RPA] Navigating to ${publishUrl}`);
    await page.goto(publishUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);

    const currentUrl = page.url().toLowerCase();
    const loginPatterns = PLATFORM_LOGIN_REDIRECTS[platform] || ['login', 'passport', 'signin'];
    const isLoginPage = isLoginRedirectUrl(currentUrl, loginPatterns);

    if (isLoginPage) {
      return res.json({
        success: false,
        error: 'Session expired - redirected to login page. Please re-login.',
      });
    }

    if (platform === 'zhihu') {
      console.log('[RPA] Zhihu: setting title and content');

      // New Zhihu editor: title is a textarea, content uses Draft.js
      // 1. Set title
      const titleEl = await page.waitForSelector('textarea[placeholder*="标题"]', { timeout: 10000 }).catch(() => null);
      if (titleEl) {
        await titleEl.click();
        await titleEl.fill(article.title);
        console.log('[RPA] Zhihu: title set via textarea');
      } else {
        // Fallback: try input element (old editor)
        await page.evaluate((title) => {
          const input = document.querySelector('input[placeholder*="标题"]') || document.querySelector('input.PostEditor-titleInput');
          if (input) {
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            nativeInputValueSetter.call(input, title);
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }, article.title);
        console.log('[RPA] Zhihu: title set via input fallback');
      }

      await page.waitForTimeout(500);

      // 2. Set content via Draft.js contenteditable
      const draftEditor = await page.$('.public-DraftEditor-content');
      if (draftEditor) {
        await draftEditor.click();
        await page.waitForTimeout(300);

        // Use clipboard paste to set content (most reliable for Draft.js)
        // Convert markdown to simple text with newlines for basic formatting
        const content = article.contentMarkdown;
        await page.evaluate(async (text) => {
          // Create a paste event with the content
          const dataTransfer = new DataTransfer();
          dataTransfer.setData('text/plain', text);
          const pasteEvent = new ClipboardEvent('paste', {
            clipboardData: dataTransfer,
            bubbles: true,
            cancelable: true,
          });
          document.querySelector('.public-DraftEditor-content').dispatchEvent(pasteEvent);
        }, content);

        // If paste didn't work, use keyboard typing as fallback
        await page.waitForTimeout(500);
        const editorText = await page.evaluate(() => {
          const el = document.querySelector('.public-DraftEditor-content');
          return el ? el.textContent.trim() : '';
        });

        if (!editorText || editorText.length < 10) {
          console.log('[RPA] Zhihu: paste failed, trying keyboard input');
          await draftEditor.click();
          await page.keyboard.type(content, { delay: 0 });
        }

        console.log('[RPA] Zhihu: content set via Draft.js');
      } else {
        // Fallback: try CodeMirror (old editor)
        await page.evaluate((content) => {
          const cm = document.querySelector('.CodeMirror');
          if (cm && cm.CodeMirror) {
            cm.CodeMirror.setValue(content);
          }
        }, article.contentMarkdown);
        console.log('[RPA] Zhihu: content set via CodeMirror fallback');
      }

      // 3. Set tags — new Zhihu editor uses "添加话题" button, old uses input[placeholder*="标签"]
      if (article.tags && article.tags.length > 0) {
        for (const tag of article.tags.slice(0, 5)) {
          try {
            // Try new editor: click "添加话题" button to reveal tag input
            const addTopicBtn = await page.evaluate(() => {
              const btns = document.querySelectorAll('button');
              for (const b of btns) {
                const text = b.textContent.trim().replace(/\u200B/g, '').trim();
                if (text === '添加话题') {
                  b.click();
                  return true;
                }
              }
              return false;
            });

            if (addTopicBtn) {
              await page.waitForTimeout(500);
            }

            // Now look for the tag input (works for both new and old editor)
            const tagInput = await page.waitForSelector(
              'input[placeholder*="标签"], input[placeholder*="话题"], input[placeholder*="搜索"]',
              { timeout: 3000 }
            ).catch(() => null);

            if (tagInput) {
              await tagInput.fill(tag);
              await page.waitForTimeout(500);
              await page.keyboard.press('Enter');
              await page.waitForTimeout(300);
            }
          } catch {}
        }
      }

      await page.waitForTimeout(1000);

      // 4. Verify title and content are set before publishing
      const verifyInfo = await page.evaluate(() => {
        const titleEl = document.querySelector('textarea[placeholder*="标题"]') || document.querySelector('input[placeholder*="标题"]');
        const contentEl = document.querySelector('.public-DraftEditor-content');
        return {
          titleValue: titleEl ? titleEl.value : 'NOT FOUND',
          contentLength: contentEl ? contentEl.textContent.length : 0,
        };
      });
      console.log('[RPA] Zhihu: verification - title:', verifyInfo.titleValue ? verifyInfo.titleValue.substring(0, 30) : 'EMPTY', 'content length:', verifyInfo.contentLength);

      if (!verifyInfo.titleValue || verifyInfo.contentLength < 10) {
        console.error('[RPA] Zhihu: title or content not properly set, aborting publish');
        return res.json({
          success: false,
          error: 'Failed to set article title or content in the editor. Title set: ' + !!verifyInfo.titleValue + ', Content length: ' + verifyInfo.contentLength,
        });
      }

      // 5. Click publish button (must match exactly "发布", not "发布设置")
      console.log('[RPA] Zhihu: clicking publish button');
      // Use evaluate to find the exact button with text "发布" (not "发布设置")
      const publishClicked = await page.evaluate(() => {
        const btns = document.querySelectorAll('button');
        for (const b of btns) {
          const text = b.textContent.trim().replace(/\u200B/g, '').trim();
          if (text === '发布') {
            b.click();
            return true;
          }
        }
        return false;
      });
      console.log('[RPA] Zhihu: publish button clicked:', publishClicked);

      // 6. Handle confirmation popup (if any) — dynamic detection instead of fixed 5s wait
      await page.waitForTimeout(1500);

      // Check for visible confirmation modal
      const modalConfirmClicked = await page.evaluate(() => {
        const candidates = document.querySelectorAll(
          '[class*="Modal"] button, [class*="modal"] button, [class*="Dialog"] button, [class*="dialog"] button, [role="dialog"] button'
        );
        for (const b of candidates) {
          const rect = b.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          const text = b.textContent.trim().replace(/\u200B/g, '').trim();
          if (text === '确认' || text === '确认发布' || text === '确定' || text === '发布') {
            b.click();
            return text;
          }
        }
        return null;
      });
      if (modalConfirmClicked) {
        console.log('[RPA] Zhihu: confirmation modal clicked:', modalConfirmClicked);
      }

      // 7. Verify publish success by checking URL change from /write to /p/{id}
      // Also handle "请输入手机号" verification popup if it appears
      let publishVerified = false;
      let finalUrl = page.url();

      for (let attempt = 0; attempt < 10; attempt++) {
        await page.waitForTimeout(1000);
        finalUrl = page.url();

        // Success: URL changed from /write to /p/{id}
        if (/\/p\/\d+/.test(finalUrl) && !finalUrl.includes('/edit')) {
          publishVerified = true;
          break;
        }

        // Check for phone verification popup (风控)
        const phonePopup = await page.evaluate(() => {
          const text = document.body.innerText;
          if (text.includes('请输入手机号') || text.includes('手机号验证')) {
            return 'phone_verification';
          }
          return null;
        });

        if (phonePopup) {
          console.log('[RPA] Zhihu: phone verification required (风控拦截), needs manual intervention');
          return res.json({
            success: false,
            error: 'Zhihu risk control triggered: phone verification required. Manual intervention needed.',
            postUrl: finalUrl,
          });
        }

        // Check for error messages
        const errorMsg = await page.evaluate(() => {
          const text = document.body.innerText;
          if (text.includes('发布频率过高') || text.includes('请稍后再试')) return 'rate_limit';
          if (text.includes('权限不足') || text.includes('无法发布')) return 'permission';
          return null;
        });

        if (errorMsg) {
          console.log('[RPA] Zhihu: publish error:', errorMsg);
          return res.json({
            success: false,
            error: `Publish failed: ${errorMsg}`,
            postUrl: finalUrl,
          });
        }
      }

      console.log(`[RPA] Zhihu: publish ${publishVerified ? 'verified' : 'unverified'}, URL: ${finalUrl}`);

      if (!publishVerified) {
        // URL didn't change to /p/{id} — publish likely failed
        return res.json({
          success: false,
          error: 'Publish verification failed: URL did not change to article page. The article may have been saved as draft only.',
          postUrl: finalUrl,
        });
      }

      return res.json({
        success: true,
        postId: article.id,
        postUrl: finalUrl,
        verificationStatus: 'verified',
        verificationMessage: 'Article published successfully',
      });
    }

    console.log(`[RPA] Generic publish for ${platform}`);
    return res.json({
      success: false,
      error: `Publishing for platform ${platform} is not yet implemented in the harvester. Please implement platform-specific logic.`,
    });

  } catch (error) {
    console.error(`[RPA] Publish error for ${platform}:`, error.message);
    return res.status(500).json({
      success: false,
      error: `Publish failed: ${error.message}`,
    });
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        console.error('[RPA] Error closing browser:', e.message);
      }
    }
  }
});

// === LLMWiki Publish Endpoint ===
// POST /api/llmwiki/publish - Publish an article via LLMWiki fallback
// Called by RPAEngine.remotePublish() when RPA_REMOTE_URL is set
app.post('/api/llmwiki/publish', async (req, res) => {
  const { platform, article, credentials } = req.body;

  if (!platform) {
    return res.status(400).json({
      success: false,
      error: 'platform is required',
    });
  }

  if (!article || !article.title || !article.contentMarkdown) {
    return res.status(400).json({
      success: false,
      error: 'article with title and contentMarkdown is required',
    });
  }

  const cookieStr = credentials?.data?.cookie || credentials?.data?.cookies || credentials?.cookie || '';
  if (!cookieStr || cookieStr === 'placeholder_pending_login') {
    return res.status(400).json({
      success: false,
      error: 'Valid cookies are required for publishing',
    });
  }

  let browser = null;
  try {
    console.log(`[LLMWiki] Publishing to ${platform}: articleId=${article.id}, title="${article.title}"`);

    const parsedCookies = parseCookieString(cookieStr, platform);
    if (parsedCookies.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Failed to parse cookies',
      });
    }

    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      locale: 'zh-CN',
    });

    await context.addCookies(parsedCookies);
    const page = await context.newPage();

    // Map platform to publish URL
    const LLMWIKI_PUBLISH_URLS = {
      zhihu: 'https://zhuanlan.zhihu.com/write',
      baijiahao: 'https://baijiahao.baidu.com/builder/rc/edit?type=news',
      toutiao: 'https://mp.toutiao.com/profile_v4/graphic/publish',
      csdn: 'https://editor.csdn.net/md/',
      juejin: 'https://juejin.cn/editor/drafts/new?v=2',
      bilibili: 'https://member.bilibili.com/article-text/home',
      sohuhao: 'https://mp.sohu.com/mpfe/static/main/edit.html',
      wangyihao: 'https://mp.163.com/editor/article.html',
      baidu_zhidao: 'https://zhidao.baidu.com/',
    };

    const publishUrl = LLMWIKI_PUBLISH_URLS[platform];
    if (!publishUrl) {
      return res.status(400).json({
        success: false,
        error: `Publish URL not configured for platform: ${platform}`,
      });
    }

    console.log(`[LLMWiki] Navigating to ${publishUrl}`);
    await page.goto(publishUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);

    // Check for login redirect
    const currentUrl = page.url().toLowerCase();
    const loginPatterns = ['login', 'passport', 'signin'];
    const isLoginPage = isLoginRedirectUrl(currentUrl, loginPatterns);

    if (isLoginPage) {
      return res.json({
        success: false,
        error: 'Session expired - redirected to login page. Please re-login.',
      });
    }

    // Use the same publish logic as /rpa/publish
    // Set title
    const titleSelectors = [
      'textarea[placeholder*="标题"]',
      'input[placeholder*="标题"]',
      'input.PostEditor-titleInput',
      '.article-title input',
      '#title',
    ];

    let titleSet = false;
    for (const selector of titleSelectors) {
      const el = await page.$(selector);
      if (el) {
        await el.click();
        await el.fill(article.title);
        titleSet = true;
        break;
      }
    }

    if (!titleSet) {
      await page.evaluate((title) => {
        const inputs = document.querySelectorAll('input, textarea');
        for (const input of inputs) {
          if (input.placeholder && input.placeholder.includes('标题')) {
            input.value = title;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            break;
          }
        }
      }, article.title);
    }

    await page.waitForTimeout(500);

    // Set content via contenteditable or clipboard paste
    const contentEditor = await page.$('.public-DraftEditor-content, .CodeMirror, .ql-editor, [contenteditable="true"]');
    if (contentEditor) {
      await contentEditor.click();
      await page.waitForTimeout(300);

      // Try clipboard paste
      await page.evaluate(async (text) => {
        const editor = document.querySelector('.public-DraftEditor-content, .ql-editor, [contenteditable="true"]');
        if (editor) {
          const dataTransfer = new DataTransfer();
          dataTransfer.setData('text/plain', text);
          const pasteEvent = new ClipboardEvent('paste', {
            clipboardData: dataTransfer,
            bubbles: true,
            cancelable: true,
          });
          editor.dispatchEvent(pasteEvent);
        }
      }, article.contentMarkdown);

      await page.waitForTimeout(500);

      // Check if content was set, fallback to keyboard
      const editorText = await page.evaluate(() => {
        const el = document.querySelector('.public-DraftEditor-content, .ql-editor, [contenteditable="true"]');
        return el ? el.textContent.trim() : '';
      });

      if (!editorText || editorText.length < 10) {
        await contentEditor.click();
        await page.keyboard.type(article.contentMarkdown, { delay: 0 });
      }
    }

    console.log('[LLMWiki] Content set, looking for publish button');

    // Find and click publish button
    await page.waitForTimeout(1000);

    const publishButtonSelectors = [
      'button:has-text("发布")',
      'button:has-text("发表")',
      'button:has-text("提交")',
      '.publish-btn',
      '.submit-btn',
      '#publish-button',
    ];

    let published = false;
    let postUrl = null;

    for (const selector of publishButtonSelectors) {
      const btn = await page.$(selector).catch(() => null);
      if (btn) {
        await btn.click();
        console.log(`[LLMWiki] Clicked publish button: ${selector}`);
        published = true;

        // Wait for navigation or success indicator
        await page.waitForTimeout(5000);

        // Try to detect published URL
        postUrl = await page.evaluate(() => {
          // Check for success redirect URL
          if (window.location.href.includes('/p/') || window.location.href.includes('/article/') || window.location.href.includes('/post/')) {
            return window.location.href;
          }
          // Check for post link in page
          const link = document.querySelector('a[href*="/p/"], a[href*="/article/"], a[href*="/post/"]');
          return link ? link.href : null;
        });

        break;
      }
    }

    if (!published) {
      // Try evaluating page for any visible publish action
      published = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const publishBtn = buttons.find(b => {
          const text = b.textContent || '';
          return text.includes('发布') || text.includes('发表') || text.includes('提交');
        });
        if (publishBtn) {
          publishBtn.click();
          return true;
        }
        return false;
      });
    }

    if (published) {
      console.log('[LLMWiki] Publish appears successful');
      return res.json({
        success: true,
        postUrl: postUrl || undefined,
        verificationStatus: postUrl ? 'verified' : 'unverified',
        verificationMessage: postUrl
          ? 'Published via LLMWiki endpoint (URL confirmed)'
          : 'Published via LLMWiki endpoint (no post URL detected)',
      });
    } else {
      return res.json({
        success: false,
        error: 'Could not find or click publish button',
      });
    }
  } catch (error) {
    console.error(`[LLMWiki] Publish failed for ${platform}:`, error.message);
    return res.status(500).json({
      success: false,
      error: `LLMWiki publish error: ${error.message}`,
    });
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        console.error('[LLMWiki] Error closing browser:', e.message);
      }
    }
  }
});

if (require.main === module) {
  // 使用 HTTP server + WebSocket（支持浏览器远程控制）
  const http = require('http');
  const { Server } = require('ws');
  
  const server = http.createServer(app);
  const wss = new Server({ server, path: '/ws' });
  
  // WebSocket 连接处理
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const sessionId = url.searchParams.get('session');
    
    if (!sessionId || !remoteSessions.has(sessionId)) {
      ws.close();
      return;
    }

    const session = remoteSessions.get(sessionId);
    const page = session.page;
    let frameRequested = false;

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        
        switch (msg.type) {
          case 'frame':
            if (!frameRequested) {
              frameRequested = true;
              try {
                const screenshot = await page.screenshot({ type: 'jpeg', quality: 70, fullPage: false });
                ws.send(screenshot);
                const url = page.url();
                ws.send(JSON.stringify({ type: 'url', url }));
              } catch (e) {}
              frameRequested = false;
            }
            break;
            
          case 'click':
            await page.mouse.click(msg.x, msg.y, { button: msg.button || 'left', clickCount: msg.clickCount || 1 });
            break;
            
          case 'mousedown':
            await page.mouse.move(msg.x, msg.y);
            await page.mouse.down({ button: msg.button || 'left' });
            break;
            
          case 'mouseup':
            await page.mouse.move(msg.x, msg.y);
            await page.mouse.up({ button: msg.button || 'left' });
            break;
            
          case 'mousemove':
            await page.mouse.move(msg.x, msg.y);
            break;
            
          case 'dblclick':
            await page.mouse.dblclick(msg.x, msg.y);
            break;
            
          case 'rightclick':
            await page.mouse.click(msg.x, msg.y, { button: 'right' });
            break;
            
          case 'scroll':
            await page.mouse.move(msg.x, msg.y);
            await page.mouse.wheel({ deltaY: msg.deltaY });
            break;
            
          case 'keydown':
            await page.keyboard.down(msg.key);
            break;
            
          case 'keyup':
            await page.keyboard.up(msg.key);
            break;
            
          case 'refresh':
            await page.reload({ waitUntil: 'domcontentloaded' });
            break;
            
          case 'back':
            try { await page.goBack({ waitUntil: 'domcontentloaded' }); } catch(e) {}
            break;
            
          case 'extractCookies':
            const cookies = await page.context().cookies();
            const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
            const authNames = getAuthCookieNames(session.platform);
            const hasAuth = cookies.some(c => authNames.includes(c.name));
            ws.send(JSON.stringify({ type: 'cookies', count: cookies.length, cookieString: cookieStr, loggedIn: hasAuth }));
            break;
        }
      } catch (e) {
        console.error('[remote] Error handling message:', e.message);
      }
    });

    ws.on('close', () => {
      console.log(`[remote] Client disconnected for session ${sessionId}`);
    });
    
    console.log(`[remote] Client connected for session ${sessionId}`);
  });
  
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Harvester] Cookie harvesting service running on port ${PORT}`);
    console.log(`[Harvester] noVNC available at ${NOVNC_BASE}/vnc.html`);
    console.log(`[Harvester] Credentials storage: ${CREDENTIALS_FILE}`);
    console.log(`[Harvester] Supported platforms: ${Object.keys(PLATFORM_URLS).join(', ')}`);
    console.log(`[Harvester] LLMWiki publish endpoint: POST /api/llmwiki/publish`);
  });
}

module.exports = { app, sessions };
