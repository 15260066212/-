/**
 * GET /remote/:sessionId
 * Browser remote control page (WebSocket screenshot streaming).
 * Optimized: push-based streaming (~20 FPS), captcha input field, IME support.
 */

const { remoteSessions } = require('../config');

function registerRemoteRoute(app) {
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
    .toolbar { position: absolute; top: 8px; right: 8px; display: flex; gap: 6px; z-index: 10; flex-wrap: wrap; max-width: calc(100% - 16px); }
    .toolbar button { background: rgba(0,0,0,0.75); color: white; border: 1px solid rgba(255,255,255,0.2); padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; backdrop-filter: blur(10px); white-space: nowrap; }
    .toolbar button:hover { background: rgba(0,0,0,0.9); }
    .toolbar button.primary { background: #e94560; border-color: #e94560; }
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
      gap: 8px;
      align-items: center;
      z-index: 20;
      border: 1px solid rgba(255,255,255,0.1);
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
    .input-panel .tip {
      font-size: 11px;
      color: #666;
      margin-left: 4px;
    }
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
        </div>
        <img id="screenshot" alt="browser" draggable="false">
        <!-- Captcha / text input panel -->
        <div class="input-panel" id="inputPanel" style="display:none;">
          <label>⌨️ 输入验证码/文字：</label>
          <input type="text" id="textInput" placeholder="在此输入验证码，点击发送后自动填入" autocomplete="off" spellcheck="false">
          <button onclick="sendTextToBrowser()">发送</button>
          <button onclick="toggleInputPanel()" style="background:transparent;border:1px solid rgba(255,255,255,0.2);">×</button>
        </div>
        <button class="toggle-input-btn" id="toggleInputBtn" onclick="toggleInputPanel()">⌨️ 输入框</button>
        <button class="extract-cookie-btn" onclick="extractCookies()">📋 采集Cookie</button>
      </div>
      <div class="hint">💡 点击截图操作浏览器。验证码输入困难？点击「输入框」直接输入文字后发送。</div>
    </div>
  </div>

<script>
const sessionId = '${sessionId}';
const img = document.getElementById('screenshot');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const urlBar = document.getElementById('urlBar');
const inputPanel = document.getElementById('inputPanel');
const toggleInputBtn = document.getElementById('toggleInputBtn');
const textInput = document.getElementById('textInput');
let ws;
let reconnectDelay = 1000;
let lastMessageTime = 0;
let disconnectTimer = null;
let pushMode = true; // Use push-based streaming for better FPS

function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(proto + '//' + location.host + '/ws?session=' + sessionId);

  ws.onopen = () => {
    statusDot.classList.add('connected');
    statusText.textContent = '已连接';
    reconnectDelay = 1000;
    lastMessageTime = performance.now();
    startDisconnectMonitor();
    if (pushMode) {
      ws.send(JSON.stringify({ type: 'startStream' }));
    } else {
      requestFrame();
    }
  };

  ws.onclose = () => {
    statusDot.classList.remove('connected');
    statusText.textContent = '已断开，重连中...';
    stopDisconnectMonitor();
    const delay = reconnectDelay;
    reconnectDelay = Math.min(8000, reconnectDelay * 2);
    setTimeout(connect, delay);
  };

  ws.onmessage = (e) => {
    lastMessageTime = performance.now();
    if (e.data instanceof Blob) {
      const url = URL.createObjectURL(e.data);
      img.onload = () => { URL.revokeObjectURL(img.src); };
      img.src = url;
      if (!pushMode) {
        // Pull mode - request next frame after current one loads
        setTimeout(requestFrame, 0);
      }
    } else {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'url') urlBar.textContent = msg.url;
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', t: msg.t }));
        }
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

function startDisconnectMonitor() {
  stopDisconnectMonitor();
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
  // Send as batch type - much more reliable than individual keystrokes
  ws.send(JSON.stringify({ type: 'typeText', text: text, delay: 20 }));
  textInput.value = '';
  // Keep focus on input for next captcha
  textInput.focus();
}

// Mouse events
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

// Auto-focus hint: show input panel when user clicks around input fields
let lastClickTime = 0;
img.addEventListener('click', () => {
  // If user clicks twice quickly on lower part of screen, they might be trying to type
  const now = Date.now();
  if (now - lastClickTime < 800 && inputPanel.style.display === 'none') {
    // Don't auto-show - let user decide with the button
  }
  lastClickTime = now;
});

function refreshPage() { ws.send(JSON.stringify({ type: 'refresh' })); }
function goBack() { ws.send(JSON.stringify({ type: 'back' })); }
function extractCookies() { ws.send(JSON.stringify({ type: 'extractCookies' })); }

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

module.exports = { registerRemoteRoute };
