#!/usr/bin/env python3
"""
Harvester 浏览器远程控制流畅度优化
修改 server.js (WebSocket + 帧调度) 和 remote.js (前端渲染)
"""

import re
import os

SERVER_JS = '/home/ubuntu/geo-assistant-clean/harvester/server.js'
REMOTE_JS = '/home/ubuntu/geo-assistant-clean/harvester/routes/remote.js'

def backup_file(path):
    """备份文件"""
    import time
    bak = f"{path}.bak.{int(time.time())}"
    with open(path, 'r') as src, open(bak, 'w') as dst:
        dst.write(src.read())
    print(f"  已备份: {bak}")
    return bak

def optimize_server_js():
    """优化 server.js 中的 WebSocket 帧调度和自适应质量"""
    print("\n=== 优化 server.js ===")
    
    with open(SERVER_JS, 'r') as f:
        content = f.read()
    
    # 1. 提升质量模式的 FPS 上限
    old_modes = """    const QUALITY_MODES = {
      fast:     { quality: 20, targetFPS: 4,  adaptiveQuality: true,  minQ: 15, maxQ: 30, minFPS: 3,  maxFPS: 6  },
      balanced: { quality: 50, targetFPS: 12, adaptiveQuality: true,  minQ: 35, maxQ: 65, minFPS: 8,  maxFPS: 15 },
      high:     { quality: 65, targetFPS: 18, adaptiveQuality: true,  minQ: 55, maxQ: 80, minFPS: 12, maxFPS: 20 },
      captcha:  { quality: 85, targetFPS: 22, adaptiveQuality: false, minQ: 80, maxQ: 92, minFPS: 15, maxFPS: 25 },
    };"""
    
    new_modes = """    const QUALITY_MODES = {
      fast:     { quality: 20, targetFPS: 8,  adaptiveQuality: true,  minQ: 15, maxQ: 35, minFPS: 5,  maxFPS: 12 },
      balanced: { quality: 50, targetFPS: 18, adaptiveQuality: true,  minQ: 35, maxQ: 70, minFPS: 12, maxFPS: 24 },
      high:     { quality: 65, targetFPS: 24, adaptiveQuality: true,  minQ: 50, maxQ: 82, minFPS: 15, maxFPS: 30 },
      captcha:  { quality: 85, targetFPS: 28, adaptiveQuality: false, minQ: 80, maxQ: 92, minFPS: 18, maxFPS: 30 },
    };
    
    // Performance metrics for adaptive quality
    let avgFrameTime = 30;
    let avgFrameSize = 100;
    let rtt = 50;
    let pingInterval = null;
    let goodFrames = 0;
    let badFrames = 0;
    
    // EMA helper for smooth metrics
    function ema(current, sample, alpha) {
      alpha = alpha || 0.2;
      return current * (1 - alpha) + sample * alpha;
    }"""
    
    if old_modes in content:
        content = content.replace(old_modes, new_modes)
        print("  ✅ 质量模式 FPS 已提升")
    else:
        print("  ⚠️  未找到 QUALITY_MODES，跳过")
    
    # 2. 替换 sendFrame 函数为背压调度 + 滞回自适应版本
    # 找到 sendFrame 函数的起始和结束
    old_sendframe_start = "    async function sendFrame() {"
    old_sendframe_end = "    function startStreaming() {"
    
    new_sendframe = """    async function sendFrame() {
      if (!streaming || ws.readyState !== ws.OPEN) return;
      if (isScreenshotting) return;

      isScreenshotting = true;
      const startTime = Date.now();

      try {
        const screenshot = await page.screenshot({
          type: 'jpeg',
          quality: Math.round(quality),
          fullPage: false,
          animations: 'disabled',
          caret: 'initial'
        });

        const frameTime = Date.now() - startTime;
        const sizeKB = screenshot.length / 1024;

        // Update rolling averages
        avgFrameTime = ema(avgFrameTime, frameTime, 0.15);
        avgFrameSize = ema(avgFrameSize, sizeKB, 0.15);

        // Adaptive quality with hysteresis
        if (adaptiveQuality) {
          const buffered = ws.bufferedAmount || 0;
          const mode = QUALITY_MODES[qualityMode] || QUALITY_MODES.balanced;
          const minQ = mode.minQ, maxQ = mode.maxQ, minFPS = mode.minFPS, maxFPS = mode.maxFPS;
          
          // Congestion scoring
          let congestionScore = 0;
          if (buffered > 500 * 1024) congestionScore += 3;
          else if (buffered > 200 * 1024) congestionScore += 2;
          else if (buffered > 80 * 1024) congestionScore += 1;
          else if (buffered < 10 * 1024) congestionScore -= 1;
          
          // RTT-based scoring
          if (rtt > 300) congestionScore += 2;
          else if (rtt > 150) congestionScore += 1;
          else if (rtt < 50) congestionScore -= 1;
          
          // Frame-time scoring
          const maxFrameBudget = minFrameInterval * 0.8;
          if (frameTime > maxFrameBudget) congestionScore += 1;
          
          // Hysteresis logic
          if (congestionScore >= 2) {
            badFrames++;
            goodFrames = 0;
            if (badFrames >= 3) {
              badFrames = 0;
              if (congestionScore >= 3) {
                quality = Math.max(minQ, quality - 15);
                targetFPS = Math.max(minFPS, targetFPS - 4);
              } else {
                quality = Math.max(minQ, quality - 8);
                targetFPS = Math.max(minFPS, targetFPS - 2);
              }
              minFrameInterval = 1000 / targetFPS;
            }
          } else if (congestionScore <= -1 && frameTime < maxFrameBudget * 0.7) {
            goodFrames++;
            badFrames = 0;
            if (goodFrames >= 5) {
              goodFrames = 0;
              quality = Math.min(maxQ, quality + 5);
              if (targetFPS < maxFPS) {
                targetFPS = Math.min(maxFPS, targetFPS + 2);
                minFrameInterval = 1000 / targetFPS;
              }
            }
          } else {
            if (goodFrames > 0) goodFrames--;
            if (badFrames > 0) badFrames--;
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

        frameCount++;
      } catch (e) {
        // Ignore screenshot errors
      } finally {
        isScreenshotting = false;
        if (streaming) {
          const elapsed = Date.now() - startTime;
          // Backpressure: schedule next frame ASAP, with minFrameInterval as floor
          const remaining = minFrameInterval - elapsed;
          if (remaining > 1) {
            frameTimeout = setTimeout(sendFrame, remaining);
          } else {
            frameTimeout = setTimeout(sendFrame, 0);
          }
        }
      }
    }

    function handlePong(pingTime) {
      const measured = Date.now() - pingTime;
      rtt = ema(rtt, measured, 0.3);
    }

    function startStreaming() {"""
    
    # 找到并替换 sendFrame 函数
    start_idx = content.find(old_sendframe_start)
    end_idx = content.find(old_sendframe_end)
    
    if start_idx != -1 and end_idx != -1 and start_idx < end_idx:
        content = content[:start_idx] + new_sendframe + content[end_idx:]
        print("  ✅ sendFrame 已优化（背压调度 + 滞回自适应 + RTT）")
    else:
        print(f"  ⚠️  未找到 sendFrame 函数边界: start={start_idx}, end={end_idx}")
    
    # 3. 更新 startStreaming 函数，添加 ping/RTT 测量
    old_start = """    function startStreaming() {
      if (streaming) return;
      streaming = true;
      sendFrame();
    }"""
    
    new_start = """    function startStreaming() {
      if (streaming) return;
      streaming = true;
      goodFrames = 0;
      badFrames = 0;
      sendFrame();
      
      // Start ping/RTT measurement (every 2 seconds)
      if (!pingInterval) {
        pingInterval = setInterval(function() {
          if (ws.readyState === ws.OPEN && streaming) {
            var t = Date.now();
            ws.send(JSON.stringify({ type: 'ping', t: t }));
          }
        }, 2000);
      }
    }"""
    
    if old_start in content:
        content = content.replace(old_start, new_start)
        print("  ✅ startStreaming 已添加 ping/RTT 测量")
    else:
        print("  ⚠️  未找到 startStreaming 函数")
    
    # 4. 更新 stopStreaming 函数，清理 ping 定时器
    old_stop = """    function stopStreaming() {
      streaming = false;
      if (frameTimeout) {
        clearTimeout(frameTimeout);
        frameTimeout = null;
      }
    }"""
    
    new_stop = """    function stopStreaming() {
      streaming = false;
      if (frameTimeout) {
        clearTimeout(frameTimeout);
        frameTimeout = null;
      }
      if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
      }
    }"""
    
    if old_stop in content:
        content = content.replace(old_stop, new_stop)
        print("  ✅ stopStreaming 已添加 ping 清理")
    else:
        print("  ⚠️  未找到 stopStreaming 函数")
    
    # 5. 添加 pong 消息处理（在 ws.on('message') 处理中）
    # 找到消息处理的 switch/case 或 if 链，添加 pong 处理
    old_msg_click = "      } else if (msg.type === 'click') {"
    
    # 在 click 处理之前，先检查是否有 setQuality 等处理
    # 让我们找到消息处理的开始
    msg_handler_marker = "    ws.on('message', async function(message) {"
    if msg_handler_marker in content:
        # 在消息处理函数中添加 pong 处理
        # 找一个合适的位置插入，比如在 'startStream' 处理之前或之后
        old_ping_handler = "      if (msg.type === 'startStream') {"
        new_ping_handler = """      if (msg.type === 'pong') {
        handlePong(Number(msg.t) || 0);
        return;
      }
      if (msg.type === 'startStream') {"""
        
        if old_ping_handler in content:
            content = content.replace(old_ping_handler, new_ping_handler)
            print("  ✅ 已添加 pong 消息处理")
        else:
            print("  ⚠️  未找到 startStream 消息处理位置")
    else:
        print("  ⚠️  未找到 ws.on('message') 处理")
    
    # 6. 优化 dragStart/dragEnd 的质量提升
    old_dragstart = """      } else if (msg.type === 'dragStart') {
        adaptiveQuality = false;
        if (qualityMode === 'captcha') {
          quality = 95;
          targetFPS = 30;
        } else {
          quality = Math.min(85, quality + 20);
          targetFPS = Math.min(25, targetFPS + 5);
        }
        minFrameInterval = 1000 / targetFPS;
      } else if (msg.type === 'dragEnd') {
        // Restore quality based on mode after drag
        var mode = QUALITY_MODES[qualityMode] || QUALITY_MODES.balanced;
        quality = mode.quality;
        targetFPS = mode.targetFPS;
        adaptiveQuality = mode.adaptiveQuality;
        minFrameInterval = 1000 / targetFPS;
      }"""
    
    new_dragstart = """      } else if (msg.type === 'dragStart') {
        adaptiveQuality = false;
        goodFrames = 0;
        badFrames = 0;
        if (qualityMode === 'captcha') {
          quality = 95;
          targetFPS = 30;
        } else {
          quality = Math.min(90, quality + 20);
          targetFPS = Math.min(30, targetFPS + 6);
        }
        minFrameInterval = 1000 / targetFPS;
      } else if (msg.type === 'dragEnd') {
        var mode = QUALITY_MODES[qualityMode] || QUALITY_MODES.balanced;
        quality = mode.quality;
        targetFPS = mode.targetFPS;
        adaptiveQuality = mode.adaptiveQuality;
        minFrameInterval = 1000 / targetFPS;
        goodFrames = 0;
        badFrames = 0;
      }"""
    
    if old_dragstart in content:
        content = content.replace(old_dragstart, new_dragstart)
        print("  ✅ 拖拽质量提升已优化")
    else:
        print("  ⚠️  未找到 dragStart/dragEnd 处理")
    
    # 写入文件
    with open(SERVER_JS, 'w') as f:
        f.write(content)
    
    print("  server.js 优化完成")

def optimize_remote_js():
    """优化 routes/remote.js 中的前端渲染逻辑"""
    print("\n=== 优化 routes/remote.js ===")
    
    with open(REMOTE_JS, 'r') as f:
        content = f.read()
    
    # 1. 替换渲染逻辑：isRendering → renderScheduled + requestAnimationFrame
    old_render = """let pendingFrame = null;
let isRendering = false;
let frameCount = 0;
let lastFpsTime = Date.now();
let currentFps = 0;

function renderFrame() {
  if (!pendingFrame || isRendering) return;
  isRendering = true;
  const blob = pendingFrame;
  pendingFrame = null;

  createImageBitmap(blob).then((bitmap) => {
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    isRendering = false;

    // FPS counter
    frameCount++;
    const now = Date.now();
    if (now - lastFpsTime >= 1000) {
      currentFps = frameCount;
      frameCount = 0;
      lastFpsTime = now;
      fpsDisplay.textContent = currentFps + ' FPS';
    }

    // Render next pending frame if any (skip frames if behind)
    if (pendingFrame) renderFrame();
  }).catch(() => {
    isRendering = false;
  });
}"""

    new_render = """let pendingFrame = null;
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
    if (pendingFrame) scheduleRender();
  });
}"""

    if old_render in content:
        content = content.replace(old_render, new_render)
        print("  ✅ 渲染逻辑已优化（requestAnimationFrame）")
    else:
        print("  ⚠️  未找到 renderFrame 函数")
    
    # 2. 更新 ws.onmessage 中的帧处理
    old_onmessage_frame = """      pendingFrame = e.data;
      if (!isRendering) {
        renderFrame();
      }"""
    
    new_onmessage_frame = """      pendingFrame = e.data;
      scheduleRender();"""
    
    if old_onmessage_frame in content:
        content = content.replace(old_onmessage_frame, new_onmessage_frame)
        print("  ✅ onmessage 帧处理已更新")
    else:
        print("  ⚠️  未找到 onmessage 帧处理")
    
    # 3. 添加 ping 响应
    old_url_handler = """        if (msg.type === 'url') urlBar.textContent = msg.url;"""
    
    new_url_handler = """        if (msg.type === 'url') urlBar.textContent = msg.url;
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', t: msg.t }));
        }"""
    
    if old_url_handler in content:
        content = content.replace(old_url_handler, new_url_handler)
        print("  ✅ 已添加 ping 响应")
    else:
        print("  ⚠️  未找到 url 消息处理")
    
    # 4. 添加断线检测和指数退避重连
    old_ws_var = "let ws;"
    new_ws_var = """let ws;
let reconnectDelay = 1000;
let lastMessageTime = 0;
let disconnectTimer = null;"""
    
    if old_ws_var in content:
        content = content.replace(old_ws_var, new_ws_var, 1)
        print("  ✅ 已添加重连变量")
    else:
        print("  ⚠️  未找到 ws 变量声明")
    
    # 5. 更新 ws.onopen
    old_onopen = """  ws.onopen = () => {
    statusDot.classList.add('connected');
    statusText.textContent = '已连接';
    ws.send(JSON.stringify({ type: 'startStream', mode: currentQualityMode }));
  };"""
    
    new_onopen = """  ws.onopen = () => {
    statusDot.classList.add('connected');
    statusText.textContent = '已连接';
    reconnectDelay = 1000;
    lastMessageTime = performance.now();
    ws.send(JSON.stringify({ type: 'startStream', mode: currentQualityMode }));
    startDisconnectMonitor();
  };"""
    
    if old_onopen in content:
        content = content.replace(old_onopen, new_onopen)
        print("  ✅ onopen 已更新")
    else:
        print("  ⚠️  未找到 onopen")
    
    # 6. 更新 ws.onclose 为指数退避
    old_onclose = """  ws.onclose = () => {
    statusDot.classList.remove('connected');
    statusText.textContent = '已断开，重连中...';
    setTimeout(connect, 2000);
  };"""
    
    new_onclose = """  ws.onclose = () => {
    statusDot.classList.remove('connected');
    statusText.textContent = '已断开，重连中...';
    stopDisconnectMonitor();
    const delay = reconnectDelay;
    reconnectDelay = Math.min(8000, reconnectDelay * 2);
    setTimeout(connect, delay);
  };"""
    
    if old_onclose in content:
        content = content.replace(old_onclose, new_onclose)
        print("  ✅ onclose 指数退避已更新")
    else:
        print("  ⚠️  未找到 onclose")
    
    # 7. 更新 ws.onmessage 添加时间戳更新
    old_onmessage_start = """  ws.onmessage = (e) => {
    if (e.data instanceof Blob) {"""
    
    new_onmessage_start = """  ws.onmessage = (e) => {
    lastMessageTime = performance.now();
    if (e.data instanceof Blob) {"""
    
    if old_onmessage_start in content:
        content = content.replace(old_onmessage_start, new_onmessage_start)
        print("  ✅ onmessage 时间戳已更新")
    else:
        print("  ⚠️  未找到 onmessage 开始")
    
    # 8. 添加断线检测函数（在 connect 函数后面）
    old_connect_end = "}\n\nfunction toggleInputPanel() {"
    new_connect_end = """}

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

function toggleInputPanel() {"""
    
    if old_connect_end in content:
        content = content.replace(old_connect_end, new_connect_end)
        print("  ✅ 断线检测函数已添加")
    else:
        print("  ⚠️  未找到 connect 函数结束位置")
    
    # 写入文件
    with open(REMOTE_JS, 'w') as f:
        f.write(content)
    
    print("  remote.js 优化完成")

def main():
    print("开始优化浏览器远程控制流畅度...")
    
    # 备份
    backup_file(SERVER_JS)
    backup_file(REMOTE_JS)
    
    # 优化
    optimize_server_js()
    optimize_remote_js()
    
    print("\n=== 优化完成 ===")
    print("请重启 harvester 服务: pm2 restart harvester")

if __name__ == '__main__':
    main()
