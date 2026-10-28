/**
 * Harvester service entry point.
 *
 * Original 2700-line monolith split into focused modules:
 *   config/         - shared state, constants, credential helpers
 *   config/platforms.js - platform URLs, names, selectors, login config
 *   routes/remote.js    - GET /remote/:sessionId (WebSocket control page)
 *   routes/session.js   - POST/GET /api/session/* (start, status, cookies, close)
 *   routes/info.js      - GET /api/platforms, /api/sessions, /api/credentials/*, /health
 *   routes/rpa.js       - POST /api/rpa/* (check-session, refresh-cookies, relogin, etc.)
 *   routes/publish.js   - POST /rpa/publish, /api/llmwiki/publish
 *   remote-browser.js   - shared sessions Map for WebSocket control
 */

const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('ws');

const { PORT, remoteSessions, upsertCredential, MAIN_SERVER_URL, NODE_ID, NODE_NAME } = require('./config');
const { getAuthCookieNames, filterCookiesByDomain, cookiesToString, PLATFORM_DOMAINS } = require('./lib/cookie-utils');
const { PLATFORM_NAMES } = require('./config/platforms');
const { registerRemoteRoute } = require('./routes/remote');
const { registerSessionRoutes } = require('./routes/session');
const { registerInfoRoutes } = require('./routes/info');
const { registerRpaRoutes } = require('./routes/rpa');
const { registerPublishRoutes } = require('./routes/publish');
const { registerProfileRoutes } = require('./routes/profiles');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Register all route modules
registerRemoteRoute(app);
registerSessionRoutes(app);
registerInfoRoutes(app);
registerRpaRoutes(app);
registerPublishRoutes(app);
registerProfileRoutes(app);

if (require.main === module) {
  const server = http.createServer(app);
  const wss = new Server({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const sessionId = url.searchParams.get('session');

    if (!sessionId || !remoteSessions.has(sessionId)) {
      ws.close();
      return;
    }

    const session = remoteSessions.get(sessionId);
    const page = session.page;

    // Push-based frame streaming - optimized for low latency
    let isScreenshotting = false;
    let lastUrl = '';
    let streaming = false;
    let frameTimeout = null;
    let quality = 50;          // JPEG quality (0-100)
    let targetFPS = 12;        // Target frames per second
    let minFrameInterval = 1000 / targetFPS;
    let adaptiveQuality = true;
    let frameCount = 0;
    let lastQualityAdjust = 0;
    let qualityMode = 'balanced'; // 'fast' | 'balanced' | 'high' | 'captcha'

    const QUALITY_MODES = {
      fast:     { quality: 20, targetFPS: 4,  adaptiveQuality: true,  minQ: 15, maxQ: 30, minFPS: 3,  maxFPS: 6  },
      balanced: { quality: 50, targetFPS: 12, adaptiveQuality: true,  minQ: 35, maxQ: 65, minFPS: 8,  maxFPS: 15 },
      high:     { quality: 65, targetFPS: 18, adaptiveQuality: true,  minQ: 55, maxQ: 80, minFPS: 12, maxFPS: 20 },
      captcha:  { quality: 85, targetFPS: 22, adaptiveQuality: false, minQ: 80, maxQ: 92, minFPS: 15, maxFPS: 25 },
    };

    const DEFAULT_ACCOUNT_NAME = 'default';
    const COOKIE_SYNC_ENDPOINT = '/api/credentials/sync';

    // 根据节点ID计算默认的 accountId，确保多机部署时凭证互不覆盖
    // 规则：如果 NODE_ID 不是 'default'，就用 NODE_ID 作为默认 accountId
    function getDefaultAccountId() {
      return NODE_ID !== 'default' ? NODE_ID : DEFAULT_ACCOUNT_NAME;
    }

    async function sendFrame() {
      if (!streaming || ws.readyState !== ws.OPEN) return;
      if (isScreenshotting) return;
      
      isScreenshotting = true;
      const startTime = Date.now();
      
      try {
        const screenshot = await page.screenshot({ 
          type: 'jpeg', 
          quality: Math.round(quality), 
          fullPage: false,
          animations: 'disabled'
        });
        
        // Adaptive quality adjustment (every 8 frames) based on network congestion
        frameCount++;
        if (adaptiveQuality && frameCount - lastQualityAdjust >= 8) {
          lastQualityAdjust = frameCount;
          const buffered = ws.bufferedAmount || 0;
          const frameTime = Date.now() - startTime;
          const sizeKB = screenshot.length / 1024;
          
          // Get quality bounds based on current mode
          const mode = QUALITY_MODES[qualityMode] || QUALITY_MODES.balanced;
          const minQ = mode.minQ, maxQ = mode.maxQ, minFPS = mode.minFPS, maxFPS = mode.maxFPS;
          
          if (buffered > 300 * 1024) {
            // Heavy congestion - drop quality fast
            quality = Math.max(minQ, quality - 10);
            if (sizeKB > 150) {
              targetFPS = Math.max(minFPS, targetFPS - 2);
              minFrameInterval = 1000 / targetFPS;
            }
          } else if (buffered > 100 * 1024) {
            // Mild congestion - slight drop
            quality = Math.max(minQ, quality - 3);
          } else if (buffered < 10 * 1024 && frameTime < minFrameInterval * 0.6) {
            // Very smooth - increase quality
            quality = Math.min(maxQ, quality + 3);
            if (targetFPS < maxFPS) {
              targetFPS = Math.min(maxFPS, targetFPS + 1);
              minFrameInterval = 1000 / targetFPS;
            }
          }
        }
        
        if (ws.readyState === ws.OPEN) {
          ws.send(screenshot);
        }
        
        const currentUrl = page.url();
        if (currentUrl !== lastUrl) {
          lastUrl = currentUrl;
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'url', url: currentUrl }));
          }
        }
        
      } catch (e) {
        // Ignore screenshot errors (page might be navigating)
      } finally {
        isScreenshotting = false;
        if (streaming) {
          const elapsed = Date.now() - startTime;
          const nextDelay = Math.max(50, minFrameInterval - elapsed);
          frameTimeout = setTimeout(sendFrame, nextDelay);
        }
      }
    }

    function startStreaming() {
      if (streaming) return;
      streaming = true;
      sendFrame();
    }

    function stopStreaming() {
      streaming = false;
      if (frameTimeout) {
        clearTimeout(frameTimeout);
        frameTimeout = null;
      }
    }

    async function extractPlatformCookies(page, platform) {
      const allCookies = await page.context().cookies();
      const domains = PLATFORM_DOMAINS[platform] || [];
      const platformCookies = filterCookiesByDomain(allCookies, domains);
      const cookieStr = cookiesToString(platformCookies);
      const authNames = getAuthCookieNames(platform);
      const hasAuth = platformCookies.some(c => authNames.includes(c.name));
      return { cookieStr, count: platformCookies.length, hasAuth };
    }

    function saveCredentialLocal(platform, accountName, cookieStr, count) {
      const credKey = `${accountName || DEFAULT_ACCOUNT_NAME}:${platform}`;
      return upsertCredential(credKey, {
        type: 'cookie',
        data: { cookie: cookieStr },
        status: 'active',
        cookieCount: count,
        lastValidatedAt: new Date().toISOString(),
        platformName: PLATFORM_NAMES[platform],
        accountName: accountName || DEFAULT_ACCOUNT_NAME,
        platform: platform,
      });
    }

    async function syncCredentialToServer(platform, platformName, accountId, accountName, cookieStr, count, status) {
      try {
        const syncRes = await fetch(`${MAIN_SERVER_URL}${COOKIE_SYNC_ENDPOINT}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            platform: platform,
            platformName: platformName,
            accountId: accountId,
            accountName: accountName,
            nodeId: NODE_ID,
            nodeName: NODE_NAME,
            cookie: cookieStr,
            cookieCount: count,
            status: status,
          }),
        });
        if (syncRes.ok) {
          console.log(`[Remote] Synced credentials to main server for ${platform}`);
          return { synced: true, error: null };
        } else {
          const errText = await syncRes.text().catch(() => syncRes.statusText);
          const error = `${syncRes.status}: ${errText}`;
          console.log(`[Remote] Failed to sync to main server: ${error}`);
          return { synced: false, error };
        }
      } catch (syncErr) {
        console.log(`[Remote] Error syncing to main server:`, syncErr.message);
        return { synced: false, error: syncErr.message };
      }
    }

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());

        switch (msg.type) {
          case 'startStream':
            // Optional: mode from frontend
            if (msg.mode && QUALITY_MODES[msg.mode]) {
              qualityMode = msg.mode;
              const mode = QUALITY_MODES[qualityMode];
              quality = mode.quality;
              targetFPS = mode.targetFPS;
              adaptiveQuality = mode.adaptiveQuality;
              minFrameInterval = 1000 / targetFPS;
            }
            startStreaming();
            break;

          case 'setQuality':
            if (msg.mode && QUALITY_MODES[msg.mode]) {
              qualityMode = msg.mode;
              const mode = QUALITY_MODES[qualityMode];
              quality = mode.quality;
              targetFPS = mode.targetFPS;
              adaptiveQuality = mode.adaptiveQuality;
              minFrameInterval = 1000 / targetFPS;
            }
            break;

          case 'stopStream':
            stopStreaming();
            break;

          case 'frame':
            // Legacy pull mode - still supported but prefer push
            if (!isScreenshotting) {
              await sendFrame();
            }
            break;

          case 'click':
            await page.mouse.move(msg.x, msg.y);
            await page.mouse.click(msg.x, msg.y, { button: msg.button || 'left', clickCount: msg.clickCount || 1, delay: 20 });
            // Smart focus: try to focus the input element at click position via JS
            if (msg.button === 'left' || !msg.button) {
              try {
                await page.evaluate(({ x, y }) => {
                  // Helper: recursively search for input-like elements, including shadow DOM
                  function findInputElement(el) {
                    if (!el) return null;
                    // Check self
                    const tag = el.tagName?.toLowerCase();
                    if (tag === 'input' || tag === 'textarea' || tag === 'select') return el;
                    if (el.isContentEditable) return el;
                    if (el.getAttribute && (el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === '')) return el;
                    // Check shadow DOM
                    if (el.shadowRoot) {
                      const shadowEl = el.shadowRoot.elementFromPoint(x, y);
                      if (shadowEl) {
                        const found = findInputElement(shadowEl);
                        if (found) return found;
                      }
                    }
                    // Check closest (for elements inside label/wrapper)
                    const closest = el.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
                    if (closest) return closest;
                    // Check children
                    const children = el.querySelectorAll?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
                    if (children && children.length > 0) {
                      // Find the child that contains the click point
                      for (const child of children) {
                        const rect = child.getBoundingClientRect();
                        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
                          return child;
                        }
                      }
                      return children[0]; // fallback to first
                    }
                    return null;
                  }
                  
                  const el = document.elementFromPoint(x, y);
                  const inputEl = findInputElement(el);
                  if (inputEl && typeof inputEl.focus === 'function') {
                    inputEl.focus({ preventScroll: false });
                    // For contenteditable, place cursor at click position
                    if (inputEl.isContentEditable) {
                      try {
                        const range = document.caretRangeFromPoint(x, y);
                        if (range) {
                          const sel = window.getSelection();
                          sel.removeAllRanges();
                          sel.addRange(range);
                        }
                      } catch(e) {}
                    }
                    // For input/textarea, set selection range if possible
                    if (inputEl.tagName === 'INPUT' || inputEl.tagName === 'TEXTAREA') {
                      try {
                        const len = inputEl.value?.length ?? 0;
                        if (typeof inputEl.setSelectionRange === 'function') {
                          inputEl.setSelectionRange(len, len);
                        }
                      } catch(e) {}
                    }
                  }
                }, { x: msg.x, y: msg.y });
              } catch(e) {
                console.log('[smart-focus] error:', e.message);
              }
            }
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
            await page.mouse.move(msg.x, msg.y, { steps: 3 });
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

          case 'dragStart':
            // Boost quality during drag for better precision (e.g. slider captchas)
            adaptiveQuality = false;
            // Captcha mode: max quality, no compromise
            if (qualityMode === 'captcha') {
              quality = 95;
              targetFPS = 30;
            } else {
              quality = Math.min(85, quality + 20);
              targetFPS = Math.min(25, targetFPS + 5);
            }
            minFrameInterval = 1000 / targetFPS;
            break;

          case 'dragEnd':
            // Restore quality based on mode after drag
            {
              const mode = QUALITY_MODES[qualityMode] || QUALITY_MODES.balanced;
              quality = mode.quality;
              targetFPS = mode.targetFPS;
              adaptiveQuality = mode.adaptiveQuality;
            }
            minFrameInterval = 1000 / targetFPS;
            break;

          case 'keydown':
            // Smart keyboard: if an input element is focused, inject the character via JS
            // This is much more reliable than page.keyboard on framework-driven pages
            try {
              const handled = await page.evaluate((key) => {
                const el = document.activeElement;
                if (!el) return false;
                const isInput = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
                const isEditable = el.isContentEditable;
                if (!isInput && !isEditable) return false;

                // Handle printable characters (single character)
                if (key.length === 1) {
                  if (isInput) {
                    const start = el.selectionStart ?? el.value.length;
                    const end = el.selectionEnd ?? el.value.length;
                    const value = el.value;
                    const newValue = value.slice(0, start) + key + value.slice(end);
                    // Use prototype setter for framework reactivity
                    const proto = Object.getPrototypeOf(el);
                    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                    if (setter) {
                      setter.call(el, newValue);
                    } else {
                      el.value = newValue;
                    }
                    el.selectionStart = el.selectionEnd = start + key.length;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                  } else {
                    // contenteditable
                    document.execCommand('insertText', false, key);
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                  }
                  return true;
                }

                // Handle special keys
                switch (key) {
                  case 'Backspace':
                    if (isInput) {
                      const start = el.selectionStart ?? 0;
                      const end = el.selectionEnd ?? 0;
                      if (start === end && start > 0) {
                        const value = el.value;
                        const newValue = value.slice(0, start - 1) + value.slice(end);
                        const proto = Object.getPrototypeOf(el);
                        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                        if (setter) {
                          setter.call(el, newValue);
                        } else {
                          el.value = newValue;
                        }
                        el.selectionStart = el.selectionEnd = start - 1;
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                      } else if (start !== end) {
                        const value = el.value;
                        const newValue = value.slice(0, start) + value.slice(end);
                        const proto = Object.getPrototypeOf(el);
                        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                        if (setter) {
                          setter.call(el, newValue);
                        } else {
                          el.value = newValue;
                        }
                        el.selectionStart = el.selectionEnd = start;
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                      }
                    } else {
                      document.execCommand('delete', false);
                      el.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                    return true;
                  case 'Enter':
                    if (isInput && el.tagName === 'INPUT') {
                      el.dispatchEvent(new Event('change', { bubbles: true }));
                      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                    } else if (isEditable || el.tagName === 'TEXTAREA') {
                      document.execCommand('insertLineBreak', false);
                      el.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                    return true;
                  case 'ArrowLeft':
                  case 'ArrowRight':
                  case 'ArrowUp':
                  case 'ArrowDown':
                    // Let native browser handle navigation - just pass through
                    return false;
                  case 'Tab':
                    return false; // Let browser handle tab natively
                  default:
                    return false;
                }
              }, msg.key);
              
              if (!handled) {
                // Fall back to native keyboard for unhandled keys / non-input focus
                await page.keyboard.down(msg.key);
              }
            } catch(e) {
              await page.keyboard.down(msg.key);
            }
            break;

          case 'keyup':
            try {
              const handled = await page.evaluate((key) => {
                const el = document.activeElement;
                if (!el) return false;
                const isInput = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
                const isEditable = el.isContentEditable;
                if (!isInput && !isEditable) return false;
                // For printable chars and most special keys, keyup is handled by JS injection on keydown
                if (key.length === 1 || ['Backspace', 'Enter'].includes(key)) return true;
                return false;
              }, msg.key);
              
              if (!handled) {
                await page.keyboard.up(msg.key);
              }
            } catch(e) {
              await page.keyboard.up(msg.key);
            }
            break;

          case 'typeText':
            // Batch text input - much faster for captcha, passwords, etc.
            if (msg.text) {
              await page.keyboard.type(msg.text, { delay: msg.delay || 0 });
            }
            break;

          case 'pasteText':
            // Paste text via clipboard simulation
            if (msg.text) {
              await page.evaluate((text) => {
                const el = document.activeElement;
                if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
                  const start = el.selectionStart ?? 0;
                  const end = el.selectionEnd ?? 0;
                  const value = el.value ?? el.textContent ?? '';
                  const newValue = value.slice(0, start) + text + value.slice(end);
                  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                    // Use prototype setter to trigger framework reactivity (Vue/React)
                    const proto = Object.getPrototypeOf(el);
                    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                    if (setter) {
                      setter.call(el, newValue);
                    } else {
                      el.value = newValue;
                    }
                    el.selectionStart = el.selectionEnd = start + text.length;
                  } else {
                    el.textContent = newValue;
                  }
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                }
              }, msg.text);
            }
            break;

          case 'fillInputAt':
            // Fill the input element at (x, y) with text using JS — more reliable than keyboard
            // for framework-driven inputs (Vue/React) and virtual keyboards
            {
              const { x, y, text } = msg;
              await page.evaluate(({ x, y, text }) => {
                const el = document.elementFromPoint(x, y);
                if (!el) return false;
                // Find actual input element (might be wrapped)
                let inputEl = el.closest('input, textarea, [contenteditable="true"]');
                if (!inputEl) {
                  const childInput = el.querySelector('input, textarea, [contenteditable="true"]');
                  if (childInput) inputEl = childInput;
                }
                if (!inputEl) return false;

                const tag = inputEl.tagName.toLowerCase();
                if (tag === 'input' || tag === 'textarea') {
                  inputEl.focus();
                  inputEl.select();
                  // Set value via prototype to trigger framework reactivity
                  const proto = Object.getPrototypeOf(inputEl);
                  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                  if (setter) {
                    setter.call(inputEl, text);
                  } else {
                    inputEl.value = text;
                  }
                  inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                  inputEl.dispatchEvent(new Event('change', { bubbles: true }));
                  inputEl.dispatchEvent(new Event('blur', { bubbles: true }));
                  return true;
                }
                if (inputEl.isContentEditable) {
                  inputEl.focus();
                  document.execCommand('selectAll', false);
                  document.execCommand('insertText', false, text);
                  inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                  inputEl.dispatchEvent(new Event('change', { bubbles: true }));
                  return true;
                }
                return false;
              }, { x, y, text });
            }
            break;

          case 'refresh':
            await page.reload({ waitUntil: 'domcontentloaded' });
            break;

          case 'back':
            try { await page.goBack({ waitUntil: 'domcontentloaded' }); } catch(e) {}
            break;

          case 'extractCookies':
            {
              const { cookieStr, count, hasAuth } = await extractPlatformCookies(page, session.platform);
              // accountId 规则：
              //   - 用户手动指定了 accountName → 用账号名（同一账号跨机器共享）
              //   - 没有指定 → 用节点 ID（默认账号，节点隔离，互不覆盖）
              const accountId = session.accountName || getDefaultAccountId();
              const accountName = session.accountName || NODE_NAME;
              const platformName = PLATFORM_NAMES[session.platform];

              let autoSaved = false;
              let syncedToServer = false;
              let syncError = null;

              if (hasAuth && cookieStr) {
                // 标记会话已登录：closeSession 只有在该标记为 true 时，才会把临时
                // profile 目录持久化为 chrome-{accountName}-{platform}。否则账号
                // 管理页（基于 profile 列表判断）永远看不到"已保存"。
                session.loggedIn = true;
                autoSaved = saveCredentialLocal(session.platform, accountName, cookieStr, count);
                if (autoSaved) {
                  console.log(`[Remote] Auto-saved credentials for ${session.platform}`);
                }

                const syncResult = await syncCredentialToServer(
                  session.platform,
                  platformName,
                  accountId,
                  accountName,
                  cookieStr,
                  count,
                  'active'
                );
                syncedToServer = syncResult.synced;
                syncError = syncResult.error;
              }

              ws.send(JSON.stringify({
                type: 'cookies',
                count,
                cookieString: cookieStr,
                loggedIn: hasAuth,
                autoSaved,
                syncedToServer,
                syncError,
                platform: session.platform,
                platformName,
              }));
            }
            break;
        }
      } catch (e) {
        console.error('[remote] Error handling message:', e.message);
      }
    });

    ws.on('close', () => {
      stopStreaming();
      console.log(`[remote] Client disconnected for session ${sessionId}`);
    });

    console.log(`[remote] Client connected for session ${sessionId}`);
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Harvester] Cookie harvesting service running on port ${PORT}`);
    console.log(`[Harvester] Credentials storage: ${require('./config').CREDENTIALS_FILE}`);
    console.log(`[Harvester] LLMWiki publish endpoint: POST /api/llmwiki/publish`);
  });
}

module.exports = { app };
