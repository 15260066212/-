/**
 * 浏览器远程控制页面（noVNC替代方案）
 * 通过 Playwright 截图 + WebSocket 实现浏览器内操作浏览器
 * 用于 Cookie 采集场景
 */
const express = require('express');
const http = require('http');
const { Server } = require('ws');
const path = require('path');
const fs = require('fs');

const PORT = process.env.REMOTE_BROWSER_PORT || 6080;
const sessions = new Map(); // sessionId -> { page, lastActivity }

function registerRemoteControl(app, getSession) {
  const server = http.createServer(app);
  const wss = new Server({ server, path: '/ws' });

  // 提供远程控制 HTML 页面
  app.get('/remote/:sessionId', (req, res) => {
    const sessionId = req.params.sessionId;
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>浏览器远程控制 - Cookie采集</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #1a1a2e; color: #eee; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; overflow: hidden; }
    .header { background: #16213e; padding: 10px 20px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #0f3460; }
    .header h1 { font-size: 16px; font-weight: 600; }
    .status { display: flex; align-items: center; gap: 8px; font-size: 13px; }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #e94560; animation: pulse 2s infinite; }
    .status-dot.connected { background: #4ade80; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
    .browser-container { display: flex; justify-content: center; align-items: flex-start; padding: 20px; height: calc(100vh - 50px); overflow: auto; }
    #browser-frame { position: relative; display: inline-block; box-shadow: 0 10px 40px rgba(0,0,0,0.5); border-radius: 8px; overflow: hidden; background: white; }
    #screenshot { display: block; max-width: 100%; cursor: crosshair; }
    .toolbar { position: absolute; top: 8px; right: 8px; display: flex; gap: 6px; z-index: 10; }
    .toolbar button { background: rgba(0,0,0,0.7); color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; }
    .toolbar button:hover { background: rgba(0,0,0,0.9); }
    .url-bar { position: absolute; top: 0; left: 0; right: 0; background: rgba(255,255,255,0.95); padding: 6px 12px; font-size: 12px; color: #333; border-bottom: 1px solid #ddd; z-index: 5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🌐 浏览器远程控制 - Cookie 采集</h1>
    <div class="status">
      <div class="status-dot" id="statusDot"></div>
      <span id="statusText">连接中...</span>
    </div>
  </div>
  <div class="browser-container">
    <div id="browser-frame">
      <div class="url-bar" id="urlBar">加载中...</div>
      <div class="toolbar">
        <button onclick="refreshPage()">刷新</button>
        <button onclick="goBack()">← 后退</button>
        <button onclick="extractCookies()">采集Cookie</button>
      </div>
      <img id="screenshot" alt="browser" draggable="false">
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
      setTimeout(requestFrame, 50); // ~20fps
    } else {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'url') urlBar.textContent = msg.url;
        if (msg.type === 'cookies') {
          alert('Cookie 已采集！数量: ' + msg.count + '\\n\\n' + (msg.loggedIn ? '✅ 已检测到登录态' : '⚠️ 未检测到登录态'));
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
  ws.send(JSON.stringify({ type: 'keydown', key: e.key, code: e.code, modifiers: getModifiers(e) }));
});
document.addEventListener('keyup', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  ws.send(JSON.stringify({ type: 'keyup', key: e.key, code: e.code, modifiers: getModifiers(e) }));
});

function getModifiers(e) {
  return { alt: e.altKey, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey };
}

function refreshPage() {
  ws.send(JSON.stringify({ type: 'refresh' }));
}
function goBack() {
  ws.send(JSON.stringify({ type: 'back' }));
}
function extractCookies() {
  ws.send(JSON.stringify({ type: 'extractCookies' }));
}

connect();
</script>
</body>
</html>`;
    res.send(html);
  });

  // WebSocket 处理
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const sessionId = url.searchParams.get('session');
    
    if (!sessionId || !sessions.has(sessionId)) {
      ws.close();
      return;
    }

    const session = sessions.get(sessionId);
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
            ws.send(JSON.stringify({ type: 'cookies', count: cookies.length, cookieString: cookieStr, loggedIn: cookies.some(c => c.name === 'z_c0' || c.name === 'sessionid') }));
            break;
        }
      } catch (e) {
        console.error('[remote] Error handling message:', e.message);
      }
    });

    ws.on('close', () => {
      console.log('[remote] Client disconnected');
    });
  });

  return { server, sessions };
}

module.exports = { registerRemoteControl, sessions };
