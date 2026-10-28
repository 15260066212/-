/**
 * GET /remote/:sessionId
 * Browser remote control page (WebSocket screenshot streaming).
 * Optimized: push-based streaming (~20 FPS), captcha input field, IME support.
 */

import { remoteSessions, MAIN_SERVER_URL } from '../config/index.js';
import type { Express, Request, Response } from 'express';

export function registerRemoteRoute(app: Express): void {
  app.get('/remote/:sessionId', (req: Request, res: Response) => {
    const sessionId = req.params.sessionId;
    if (!remoteSessions.has(sessionId)) {
      return res.status(404).send('Session not found');
    }

    const session = remoteSessions.get(sessionId)!;
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
    #screenshot { display: block; max-width: 100%; height: auto; cursor: crosshair; image-rendering: auto; user-select: none; -webkit-user-select: none; }
    .toolbar { position: absolute; top: 8px; right: 8px; display: flex; gap: 6px; z-index: 10; flex-wrap: wrap; max-width: calc(100% - 16px); }
    .toolbar button { background: rgba(0,0,0,0.75); color: white; border: 1px solid rgba(255,255,255,0.2); padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; backdrop-filter: blur(10px); white-space: nowrap; }
    .toolbar button:hover { background: rgba(0,0,0,0.9); }
    .toolbar button.primary { background: #e94560; border-color: #e94560; }
    .toolbar button.active { background: #4a9eff; border-color: #4a9eff; color: white; }
    .quality-selector { display: flex; gap: 2px; background: rgba(0,0,0,0.6); border-radius: 6px; padding: 2px; }
    .quality-selector button { padding: 4px 8px; font-size: 11px; border: none; background: transparent; }
    .quality-selector button.active { background: rgba(74,158,255,0.8); color: white; }
    .quality-selector button#qCaptcha.active { background: rgba(255,107,53,0.9); color: white; }
    .fps-display { background: rgba(0,0,0,0.6); color: #4ade80; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-family: monospace; font-weight: 600; }
    .url-bar { position: absolute; top: 0; left: 0; right: 0; background: rgba(255,255,255,0.95); padding: 6px 12px; font-size: 12px; color: #333; border-bottom: 1px solid #ddd; z-index: 5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: monospace; }
    .hint { margin-top: 10px; text-align: center; font-size: 12px; color: #888; }
    /* Captcha input panel */
    .input-panel {
      position: absolute;
      bottom: 8px;
      left: 8px;
      right: 8px;
      background: rgba(0,0,0,0.85);
      backdrop-filter: blur(10px);
      border-radius: 8px;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      z-index: 20;
      border: 1px solid rgba(255,255,255,0.1);
    }
    .input-panel-row {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .input-panel label {
      font-size: 12px;
      color: #aaa;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .input-panel input[type="text"] {
      flex: 1;
      background: rgba(255,255,255,0.1);
      border: 1px solid rgba(255,255,255,0.2);
      border-radius: 6px;
      padding: 6px 10px;
      color: white;
      font-size: 14px;
      outline: none;
      letter-spacing: 2px;
      font-family: monospace;
    }
    .input-panel input[type="text"]:focus {
      border-color: #e94560;
      background: rgba(255,255,255,0.15);
    }
    .input-panel button {
      background: #e94560;
      color: white;
      border: none;
      padding: 6px 14px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .input-panel button:hover { background: #ff5773; }
    .input-panel button.secondary {
      background: rgba(255,255,255,0.1);
      border: 1px solid rgba(255,255,255,0.2);
    }
    .input-panel button.secondary:hover {
      background: rgba(255,255,255,0.2);
    }
    .input-panel .tip {
      font-size: 11px;
      color: #888;
    }
    .input-mode-selector {
      display: flex;
      gap: 4px;
      margin-bottom: 2px;
    }
    .input-mode-selector button {
      flex: 1;
      padding: 4px 8px;
      font-size: 11px;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      color: #aaa;
    }
    .input-mode-selector button.active {
      background: #e94560;
      border-color: #e94560;
      color: white;
    }
    .click-hint {
      position: absolute;
      pointer-events: none;
      background: rgba(233,69,96,0.8);
      color: white;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 11px;
      z-index: 30;
      transform: translate(-50%, -150%);
      display: none;
      white-space: nowrap;
    }
    .click-hint.show { display: block; animation: fadeOut 2s forwards; }
    @keyframes fadeOut { 0% { opacity: 1; } 70% { opacity: 1; } 100% { opacity: 0; } }
    .toggle-input-btn {
      position: absolute;
      bottom: 8px;
      right: 8px;
      z-index: 15;
      background: rgba(0,0,0,0.75);
      color: white;
      border: 1px solid rgba(255,255,255,0.2);
      padding: 6px 10px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 11px;
      backdrop-filter: blur(10px);
    }
    .extract-cookie-btn {
      position: absolute;
      bottom: 8px;
      left: 8px;
      z-index: 15;
      background: #e94560;
      color: white;
      border: 1px solid #e94560;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      backdrop-filter: blur(10px);
      box-shadow: 0 2px 8px rgba(233,69,96,0.4);
    }
    .extract-cookie-btn:hover {
      background: #ff5773;
      border-color: #ff5773;
    }
    /* Cookie result modal */
    .modal-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.7);
      display: none;
      justify-content: center;
      align-items: center;
      z-index: 1000;
    }
    .modal-overlay.show { display: flex; }
    .modal-box {
      background: #1a1a2e;
      border: 1px solid #0f3460;
      border-radius: 12px;
      padding: 24px;
      max-width: 480px;
      width: 90%;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    }
    .modal-box h2 {
      font-size: 18px;
      margin-bottom: 16px;
      color: #eee;
    }
    .modal-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      font-size: 13px;
    }
    .modal-row:last-child { border-bottom: none; }
    .modal-row .label { color: #888; }
    .modal-row .value { color: #eee; font-weight: 500; text-align: right; max-width: 65%; word-break: break-all; }
    .modal-row .value.success { color: #4ade80; }
    .modal-row .value.warning { color: #fbbf24; }
    .modal-row .value.error { color: #f87171; }
    .cookie-masked {
      font-family: monospace;
      font-size: 12px;
      color: #aaa;
      background: rgba(255,255,255,0.05);
      padding: 4px 8px;
      border-radius: 4px;
    }
    .modal-actions {
      display: flex;
      gap: 8px;
      margin-top: 20px;
      justify-content: flex-end;
    }
    .modal-actions button {
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      border: none;
    }
    .modal-actions .btn-copy {
      background: #4a9eff;
      color: white;
    }
    .modal-actions .btn-copy:hover { background: #3b82f6; }
    .modal-actions .btn-close {
      background: rgba(255,255,255,0.1);
      color: #eee;
      border: 1px solid rgba(255,255,255,0.2);
    }
    .modal-actions .btn-close:hover { background: rgba(255,255,255,0.2); }
    .modal-error {
      margin-top: 8px;
      padding: 8px 12px;
      background: rgba(248,113,113,0.1);
      border: 1px solid rgba(248,113,113,0.3);
      border-radius: 6px;
      font-size: 12px;
      color: #f87171;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>浏览器远程控制 - Cookie 采集 (${session.platform})</h1>
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
          <div class="quality-selector">
            <button id="qFast" onclick="setQuality('fast')">🐢 流畅</button>
            <button id="qBalanced" onclick="setQuality('balanced')">⚖️ 均衡</button>
            <button id="qHigh" class="active" onclick="setQuality('high')">🖼️ 高清</button>
            <button id="qCaptcha" onclick="setQuality('captcha')" title="验证码模式：最高画质+无延迟">🎯 验证码</button>
          </div>
          <div class="fps-display" id="fpsDisplay">0 FPS</div>
        </div>
        <canvas id="screenshot" alt="browser"></canvas>
        <!-- Captcha / text input panel -->
        <div class="input-panel" id="inputPanel" style="display:none;">
          <div class="input-mode-selector">
            <button id="modeClick" class="active" onclick="setInputMode('click')">🎯 点击填入</button>
            <button id="modeType" onclick="setInputMode('type')">⌨️ 键盘输入</button>
            <button id="modePaste" onclick="setInputMode('paste')">📋 粘贴模式</button>
          </div>
          <div class="input-panel-row">
            <label>📝 输入内容：</label>
            <input type="text" id="textInput" placeholder="输入文字后，点击输入框位置自动填入" autocomplete="off" spellcheck="false">
            <button onclick="sendTextToBrowser()">发送</button>
            <button onclick="toggleInputPanel()" class="secondary">×</button>
          </div>
          <div class="tip" id="inputTip">💡 点击填入模式：在上方输入文字，然后点击截图中的输入框位置即可自动填入</div>
        </div>
        <button class="toggle-input-btn" id="toggleInputBtn" onclick="toggleInputPanel()">⌨️ 输入框</button>
        <button class="extract-cookie-btn" onclick="extractCookies()">📋 采集Cookie</button>
        <div class="click-hint" id="clickHint">已填入</div>
      </div>
      <div class="hint">💡 点击截图操作浏览器。验证码输入困难？点击「输入框」直接输入文字后发送。</div>
    </div>
  </div>

  <!-- Cookie result modal -->
  <div class="modal-overlay" id="cookieModal">
    <div class="modal-box">
      <h2 id="cookieModalTitle">📋 Cookie 采集结果</h2>
      <div id="cookieModalBody"></div>
      <div class="modal-actions">
        <button class="btn-copy" id="cookieCopyBtn" onclick="copyCookieToClipboard()">复制Cookie</button>
        <button class="btn-close" onclick="closeCookieModal()">关闭</button>
      </div>
    </div>
  </div>

<script>
const sessionId = '${sessionId}';
const __MAIN_SERVER_URL__ = '${MAIN_SERVER_URL}';
const img = document.getElementById('screenshot');
// Canvas mode: provide naturalWidth/height for coordinate scaling
Object.defineProperty(img, 'naturalWidth', { get: () => img.width });
Object.defineProperty(img, 'naturalHeight', { get: () => img.height });
const canvas = img;
const ctx = canvas.getContext('2d');
let pendingFrame = null;
let renderScheduled = false;
let frameCount = 0;
let lastFpsTime = performance.now();
let currentFps = 0;
let lastRenderTime = 0;

function scheduleRender() {
  if (renderScheduled || !pendingFrame) return;
  renderScheduled = true;
  requestAnimationFrame(renderFrame);
}

function renderFrame() {
  renderScheduled = false;
  if (!pendingFrame) return;

  const blob = pendingFrame;
  pendingFrame = null;

  createImageBitmap(blob).then((bitmap) => {
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();

    // FPS counter
    frameCount++;
    const now = performance.now();
    if (now - lastFpsTime >= 1000) {
      currentFps = frameCount;
      frameCount = 0;
      lastFpsTime = now;
      fpsDisplay.textContent = currentFps + ' FPS';
    }

    lastRenderTime = now;

    // If another frame arrived during rendering, render it next frame
    if (pendingFrame) scheduleRender();
  }).catch(() => {
    // Frame decode failed, try next
    if (pendingFrame) scheduleRender();
  });
}

const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const urlBar = document.getElementById('urlBar');
const inputPanel = document.getElementById('inputPanel');
const toggleInputBtn = document.getElementById('toggleInputBtn');
const textInput = document.getElementById('textInput');
const inputTip = document.getElementById('inputTip');
const clickHint = document.getElementById('clickHint');
const fpsDisplay = document.getElementById('fpsDisplay');
const cookieModal = document.getElementById('cookieModal');
const cookieModalBody = document.getElementById('cookieModalBody');
const cookieModalTitle = document.getElementById('cookieModalTitle');
const cookieCopyBtn = document.getElementById('cookieCopyBtn');
let currentCookieString = '';
// Named constants
const MOUSE_MOVE_THROTTLE_MS = 16; // ~60Hz input sampling
const SCALE_FALLBACK = 1; // default scale fallback
const INPUT_PANEL_WIDTH = 280; // input panel width in px
let inputMode = 'click'; // 'click' | 'type' | 'paste'
let ws;
let reconnectDelay = 1000;
let lastMessageTime = 0;
let disconnectTimer = null;

function setInputMode(mode) {
  inputMode = mode;
  document.getElementById('modeClick').classList.toggle('active', mode === 'click');
  document.getElementById('modeType').classList.toggle('active', mode === 'type');
  document.getElementById('modePaste').classList.toggle('active', mode === 'paste');
  
  const tips = {
    click: '💡 点击填入模式：在上方输入文字，然后点击截图中的输入框位置即可自动填入（推荐）',
    type: '💡 键盘输入模式：点击输入框聚焦后，用你的键盘直接输入文字',
    paste: '💡 粘贴模式：点击输入框聚焦后，按"发送"将文字粘贴到当前聚焦的输入框',
  };
  inputTip.textContent = tips[mode] || '';
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(proto + '//' + location.host + '/ws?session=' + sessionId);

  ws.onopen = () => {
    statusDot.classList.add('connected');
    statusText.textContent = '已连接';
    reconnectDelay = 1000; // reset backoff
    lastMessageTime = performance.now();
    ws.send(JSON.stringify({ type: 'startStream', mode: currentQualityMode }));
    startDisconnectMonitor();
  };

  ws.onclose = () => {
    statusDot.classList.remove('connected');
    statusText.textContent = '已断开，重连中...';
    stopDisconnectMonitor();
    // Exponential backoff: 1s, 2s, 4s, max 8s
    const delay = reconnectDelay;
    reconnectDelay = Math.min(8000, reconnectDelay * 2);
    setTimeout(connect, delay);
  };

  ws.onmessage = (e) => {
    lastMessageTime = performance.now();
    if (e.data instanceof Blob) {
      // Skip frames: only keep the latest pending frame
      pendingFrame = e.data;
      scheduleRender();
    } else {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'url') urlBar.textContent = msg.url;
        if (msg.type === 'ping') {
          // Respond to ping immediately for RTT measurement
          ws.send(JSON.stringify({ type: 'pong', t: msg.t }));
        }
        if (msg.type === 'cookies') {
          handleCookieResult(msg);
        }
      } catch(err) {
        console.error('WebSocket message parse error:', err, e.data);
      }
    }
  };
}

function startDisconnectMonitor() {
  stopDisconnectMonitor();
  // If no message for 5s, consider connection stale and trigger reconnect
  disconnectTimer = setInterval(() => {
    if (performance.now() - lastMessageTime > 5000) {
      console.warn('[Remote] No message for 5s, reconnecting...');
      ws.close();
    }
  }, 1000);
}

function stopDisconnectMonitor() {
  if (disconnectTimer) {
    clearInterval(disconnectTimer);
    disconnectTimer = null;
  }
}

function toggleInputPanel() {
  const isHidden = inputPanel.style.display === 'none';
  inputPanel.style.display = isHidden ? 'flex' : 'none';
  if (isHidden) {
    toggleInputBtn.style.display = 'none';
    setTimeout(() => textInput.focus(), 100);
  } else {
    toggleInputBtn.style.display = 'block';
  }
}

function sendTextToBrowser() {
  const text = textInput.value;
  if (!text) return;
  
  if (inputMode === 'type') {
    // Keyboard typing mode
    ws.send(JSON.stringify({ type: 'typeText', text: text, delay: 20 }));
  } else if (inputMode === 'paste') {
    // Paste to active element
    ws.send(JSON.stringify({ type: 'pasteText', text: text }));
  } else if (inputMode === 'click') {
    // Click-to-fill mode: show hint, user clicks on target position
    showClickHint('请点击截图中的输入框位置');
    pendingFillText = text;
  }
  
  textInput.value = '';
  textInput.focus();
}

let pendingFillText = null;

function showClickHint(text) {
  clickHint.textContent = text;
  clickHint.style.display = 'block';
  clickHint.classList.remove('show');
  void clickHint.offsetWidth; // trigger reflow
  clickHint.classList.add('show');
  setTimeout(() => {
    clickHint.style.display = 'none';
    clickHint.classList.remove('show');
  }, 2000);
}

// Mouse events - throttled mousemove for smoother dragging
let lastMoveTime = 0;
let pendingMove = null;

function throttledMouseMove(e) {
  const now = Date.now();
  if (now - lastMoveTime >= MOUSE_MOVE_THROTTLE_MS) {
    lastMoveTime = now;
    sendMouse(e, 'mousemove');
    pendingMove = null;
  } else {
    pendingMove = e;
    if (!throttledMouseMove._timer) {
      const delay = MOUSE_MOVE_THROTTLE_MS - (now - lastMoveTime);
      throttledMouseMove._timer = setTimeout(() => {
        throttledMouseMove._timer = null;
        if (pendingMove) {
          lastMoveTime = Date.now();
          sendMouse(pendingMove, 'mousemove');
          pendingMove = null;
        }
      }, delay);
    }
  }
}
throttledMouseMove._timer = null;

img.addEventListener('mousedown', (e) => {
  sendMouse(e, 'mousedown');
  ws.send(JSON.stringify({ type: 'dragStart' }));
});
img.addEventListener('mouseup', (e) => {
  sendMouse(e, 'mouseup');
  ws.send(JSON.stringify({ type: 'dragEnd' }));
});
img.addEventListener('mousemove', (e) => {
  if (e.buttons > 0) throttledMouseMove(e);
  // Update click hint position
  if (pendingFillText) {
    const rect = img.getBoundingClientRect();
    clickHint.style.left = (e.clientX - rect.left) + 'px';
    clickHint.style.top = (e.clientY - rect.top) + 'px';
  }
});
img.addEventListener('click', (e) => {
  // If in click-to-fill mode and there's pending text, fill at click position
  if (inputMode === 'click' && pendingFillText) {
    const rect = img.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left) * (img.naturalWidth / rect.width));
    const y = Math.round((e.clientY - rect.top) * (img.naturalHeight / rect.height));
    ws.send(JSON.stringify({ type: 'fillInputAt', x, y, text: pendingFillText }));
    pendingFillText = null;
    showClickHint('✓ 已填入');
    return;
  }
  sendMouse(e, 'click');
});
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

// Make browser frame focusable so keyboard events go through after clicking
img.setAttribute('tabindex', '-1');
img.addEventListener('click', () => {
  if (document.activeElement === textInput) return;
  img.focus({ preventScroll: true });
});

// Keyboard events - skip when typing in the input panel
document.addEventListener('keydown', (e) => {
  if (e.target === textInput) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  e.preventDefault();
  ws.send(JSON.stringify({ type: 'keydown', key: e.key, code: e.code }));
});
document.addEventListener('keyup', (e) => {
  if (e.target === textInput) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  ws.send(JSON.stringify({ type: 'keyup', key: e.key, code: e.code }));
});

// Enter key in input field = send text
textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    sendTextToBrowser();
  }
});

function refreshPage() { ws.send(JSON.stringify({ type: 'refresh' })); }
function goBack() { ws.send(JSON.stringify({ type: 'back' })); }
function extractCookies() { ws.send(JSON.stringify({ type: 'extractCookies' })); }

let currentQualityMode = 'high';
function setQuality(mode) {
  currentQualityMode = mode;
  document.getElementById('qFast')?.classList.toggle('active', mode === 'fast');
  document.getElementById('qBalanced')?.classList.toggle('active', mode === 'balanced');
  document.getElementById('qHigh')?.classList.toggle('active', mode === 'high');
  document.getElementById('qCaptcha')?.classList.toggle('active', mode === 'captcha');
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'setQuality', mode }));
  }
  if (mode === 'captcha') {
    const hint = document.createElement('div');
    hint.textContent = '🎯 验证码模式：最高画质已开启';
    hint.style.cssText = 'position:fixed;top:50px;left:50%;transform:translateX(-50%);background:rgba(255,107,53,0.9);color:white;padding:8px 16px;border-radius:20px;font-size:13px;z-index:1000;pointer-events:none;';
    document.body.appendChild(hint);
    setTimeout(() => hint.remove(), 2000);
  }
}

// Try to detect main server API base from URL params, injected config, or referrer
function detectApiBase() {
  const params = new URLSearchParams(location.search);
  if (params.get('apiBase')) {
    let base = params.get('apiBase');
    while (base.endsWith('/')) base = base.slice(0, -1);
    return base;
  }
  // Use injected server URL (from harvester config)
  if (typeof __MAIN_SERVER_URL__ !== 'undefined' && __MAIN_SERVER_URL__) {
    let base = __MAIN_SERVER_URL__;
    while (base.endsWith('/')) base = base.slice(0, -1);
    return base + '/api';
  }
  if (document.referrer) {
    try {
      const ref = new URL(document.referrer);
      return ref.origin + '/api';
    } catch(e) {
      console.error('Failed to parse referrer URL:', e);
    }
  }
  return null;
}

async function saveCredentialToServer(msg) {
  const apiBase = detectApiBase();
  if (!apiBase) return { success: false, error: '无法自动检测系统地址，请手动保存' };
  
  try {
    const resp = await fetch(apiBase + '/credentials/' + msg.platform, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: msg.platform,
        accountId: 'default',
        type: 'cookie',
        data: { cookie: msg.cookieString },
        status: 'active',
      }),
      credentials: 'include',
    });
    const data = await resp.json();
    return data;
  } catch(e) {
    return { success: false, error: e.message };
  }
}

function maskCookieString(cookieStr) {
  if (!cookieStr) return '';
  if (cookieStr.length <= 30) return cookieStr.substring(0, 10) + '...';
  return cookieStr.substring(0, 20) + '...' + cookieStr.substring(cookieStr.length - 10);
}

function closeCookieModal() {
  cookieModal.classList.remove('show');
}

async function copyCookieToClipboard() {
  if (!currentCookieString) return;
  try {
    await navigator.clipboard.writeText(currentCookieString);
    const originalText = cookieCopyBtn.textContent;
    cookieCopyBtn.textContent = '已复制 ✓';
    setTimeout(() => { cookieCopyBtn.textContent = originalText; }, 1500);
  } catch(e) {
    console.error('复制Cookie失败:', e);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function handleCookieResult(msg) {
  currentCookieString = msg.cookieString || '';
  const platformName = msg.platformName || msg.platform || '未知';

  let rows = [];
  rows.push('<div class="modal-row"><span class="label">平台</span><span class="value">' + escapeHtml(platformName) + '</span></div>');
  rows.push('<div class="modal-row"><span class="label">Cookie数量</span><span class="value">' + (msg.count || 0) + ' 个</span></div>');
  rows.push('<div class="modal-row"><span class="label">登录状态</span><span class="value ' + (msg.loggedIn ? 'success' : 'warning') + '">' + (msg.loggedIn ? '已登录 ✓' : '未检测到登录态 ⚠️') + '</span></div>');

  // Local save status
  if (typeof msg.autoSaved !== 'undefined') {
    rows.push('<div class="modal-row"><span class="label">本地保存</span><span class="value ' + (msg.autoSaved ? 'success' : 'warning') + '">' + (msg.autoSaved ? '已保存 ✓' : '未保存') + '</span></div>');
  }

  // Server sync status (from message)
  if (typeof msg.syncedToServer !== 'undefined') {
    rows.push('<div class="modal-row"><span class="label">服务端同步</span><span class="value ' + (msg.syncedToServer ? 'success' : 'error') + '">' + (msg.syncedToServer ? '已同步 ✓' : '同步失败 ✗') + '</span></div>');
    if (!msg.syncedToServer && msg.syncError) {
      rows.push('<div class="modal-error">同步失败: ' + escapeHtml(msg.syncError) + '</div>');
    }
  }

  // Persistent profile save status
  if (typeof msg.profileSaved !== 'undefined') {
    rows.push('<div class="modal-row"><span class="label">持久化Profile</span><span class="value ' + (msg.profileSaved ? 'success' : 'warning') + '">' + (msg.profileSaved ? '已保存 ✓' : '保存中...') + '</span></div>');
  }

  if (msg.loggedIn && msg.cookieString) {
    rows.push('<div class="modal-row"><span class="label">Cookie预览</span><span class="value"><span class="cookie-masked">' + escapeHtml(maskCookieString(msg.cookieString)) + '</span></span></div>');
    // Show copy button
    cookieCopyBtn.style.display = 'inline-block';
  } else {
    cookieCopyBtn.style.display = 'none';
  }

  cookieModalBody.innerHTML = rows.join('');

  if (msg.loggedIn && msg.cookieString) {
    cookieModal.classList.add('show');
  } else if (!msg.loggedIn) {
    rows.push('<div class="modal-error">💡 请先完成登录，再采集 Cookie</div>');
    cookieModalBody.innerHTML = rows.join('');
    cookieModal.classList.add('show');
  } else {
    cookieModal.classList.add('show');
  }
}

// Keyboard shortcut: Ctrl/Cmd + K to toggle input panel
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    toggleInputPanel();
  }
});

connect();
</script>
</body>
</html>`;
    res.send(html);
  });
}
