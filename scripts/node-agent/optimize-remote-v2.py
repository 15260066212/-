#!/usr/bin/env python3
"""
Harvester 浏览器远程控制流畅度优化 v2
精确匹配服务器上的代码格式
"""

import re
import time

SERVER_JS = '/home/ubuntu/geo-assistant-clean/harvester/server.js'
REMOTE_JS = '/home/ubuntu/geo-assistant-clean/harvester/routes/remote.js'

def backup(path):
    bak = f"{path}.bak.{int(time.time())}"
    with open(path, 'r') as src, open(bak, 'w') as dst:
        dst.write(src.read())
    print(f"  已备份: {bak}")
    return bak

def optimize_server_js():
    """优化 server.js"""
    print("\n=== 优化 server.js ===")
    
    with open(SERVER_JS, 'r') as f:
        lines = f.readlines()
    
    content = ''.join(lines)
    
    # ─── 1. 替换 QUALITY_MODES ───────────────────────────────────────
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

    function ema(current, sample, alpha) {
      alpha = alpha || 0.2;
      return current * (1 - alpha) + sample * alpha;
    }"""
    
    if old_modes in content:
        content = content.replace(old_modes, new_modes)
        print("  ✅ 质量模式 FPS 已提升 + 添加性能指标变量")
    else:
        print("  ❌ 未找到 QUALITY_MODES")
        return False
    
    # ─── 2. 替换 sendFrame 函数 ──────────────────────────────────────
    # sendFrame 函数从 "    async function sendFrame() {" 开始
    # 到 "    function startStreaming() {" 之前结束
    start_marker = "    async function sendFrame() {"
    end_marker = "    function startStreaming() {"
    
    start_idx = content.find(start_marker)
    end_idx = content.find(end_marker)
    
    if start_idx == -1 or end_idx == -1 or start_idx >= end_idx:
        print(f"  ❌ 未找到 sendFrame 边界: start={start_idx}, end={end_idx}")
        return False
    
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

        // Adaptive quality with hysteresis and RTT awareness
        if (adaptiveQuality) {
          frameCount++;
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
        } else {
          frameCount++;
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
        // Ignore screenshot errors
      } finally {
        isScreenshotting = false;
        if (streaming) {
          const elapsed = Date.now() - startTime;
          // Backpressure: schedule next frame ASAP, minFrameInterval as floor
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
    
    content = content[:start_idx] + new_sendframe + content[end_idx:]
    print("  ✅ sendFrame 已优化（背压调度 + 滞回自适应 + RTT）")
    
    # ─── 3. 更新 startStreaming 函数 ────────────────────────────────
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
        print("  ⚠️  未找到 startStreaming 函数（可能已被修改）")
    
    # ─── 4. 更新 stopStreaming 函数 ────────────────────────────────
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
    
    # ─── 5. 添加 pong case 到 switch ───────────────────────────────
    # 在 "case 'startStream':" 之前插入 pong case
    old_start_case = """          case 'startStream':"""
    
    new_start_case = """          case 'pong':
            handlePong(Number(msg.t) || 0);
            break;

          case 'startStream':"""
    
    if old_start_case in content:
        # 只替换第一个出现的位置
        content = content.replace(old_start_case, new_start_case, 1)
        print("  ✅ 已添加 pong 消息处理")
    else:
        print("  ⚠️  未找到 startStream case")
    
    # ─── 6. 更新 dragStart/dragEnd ────────────────────────────────
    old_drag = """          case 'dragStart':
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
            break;"""
    
    new_drag = """          case 'dragStart':
            // Boost quality during drag for better precision
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
            break;

          case 'dragEnd':
            {
              const mode = QUALITY_MODES[qualityMode] || QUALITY_MODES.balanced;
              quality = mode.quality;
              targetFPS = mode.targetFPS;
              adaptiveQuality = mode.adaptiveQuality;
              goodFrames = 0;
              badFrames = 0;
            }
            minFrameInterval = 1000 / targetFPS;
            break;"""
    
    if old_drag in content:
        content = content.replace(old_drag, new_drag)
        print("  ✅ dragStart/dragEnd 已优化")
    else:
        print("  ⚠️  未找到 dragStart/dragEnd case")
    
    # 写入
    with open(SERVER_JS, 'w') as f:
        f.write(content)
    
    print("  server.js 优化完成")
    return True

def optimize_remote_js():
    """优化 routes/remote.js 前端"""
    print("\n=== 优化 routes/remote.js ===")
    
    with open(REMOTE_JS, 'r') as f:
        content = f.read()
    
    # 先看看实际的渲染函数是什么样的
    # 搜索关键特征
    if 'createImageBitmap' not in content:
        print("  ⚠️  前端使用 img 方式而非 Canvas，跳过渲染优化")
        # 检查是否是 img 标签方式
    else:
        print("  前端使用 Canvas + createImageBitmap")
    
    # ─── 1. 添加变量声明 ────────────────────────────────────────────
    old_ws = "let ws;"
    new_ws = """let ws;
let reconnectDelay = 1000;
let lastMessageTime = 0;
let disconnectTimer = null;"""
    
    if old_ws in content:
        content = content.replace(old_ws, new_ws, 1)
        print("  ✅ 已添加重连变量")
    else:
        print("  ⚠️  未找到 ws 变量")
    
    # ─── 2. 添加 ping 响应 ──────────────────────────────────────────
    old_url = "if (msg.type === 'url') urlBar.textContent = msg.url;"
    new_url = """if (msg.type === 'url') urlBar.textContent = msg.url;
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', t: msg.t }));
        }"""
    
    if old_url in content:
        content = content.replace(old_url, new_url)
        print("  ✅ 已添加 ping 响应")
    else:
        print("  ⚠️  未找到 url 消息处理")
    
    # ─── 3. 更新 onopen ────────────────────────────────────────────
    old_onopen = "    statusText.textContent = '已连接';\n    ws.send(JSON.stringify"
    new_onopen = "    statusText.textContent = '已连接';\n    reconnectDelay = 1000;\n    lastMessageTime = performance.now();\n    startDisconnectMonitor();\n    ws.send(JSON.stringify"
    
    if old_onopen in content:
        content = content.replace(old_onopen, new_onopen)
        print("  ✅ onopen 已更新")
    else:
        print("  ⚠️  未找到 onopen 模式")
    
    # ─── 4. 更新 onclose ────────────────────────────────────────────
    old_onclose = "statusText.textContent = '已断开，重连中...';\n    setTimeout(connect, 2000);"
    new_onclose = """statusText.textContent = '已断开，重连中...';
    stopDisconnectMonitor();
    const delay = reconnectDelay;
    reconnectDelay = Math.min(8000, reconnectDelay * 2);
    setTimeout(connect, delay);"""
    
    if old_onclose in content:
        content = content.replace(old_onclose, new_onclose)
        print("  ✅ onclose 指数退避已更新")
    else:
        print("  ⚠️  未找到 onclose 模式")
    
    # ─── 5. 更新 onmessage 时间戳 ──────────────────────────────────
    old_onmsg_start = "ws.onmessage = (e) => {\n    if (e.data instanceof Blob)"
    new_onmsg_start = "ws.onmessage = (e) => {\n    lastMessageTime = performance.now();\n    if (e.data instanceof Blob)"
    
    if old_onmsg_start in content:
        content = content.replace(old_onmsg_start, new_onmsg_start)
        print("  ✅ onmessage 时间戳已更新")
    else:
        print("  ⚠️  未找到 onmessage 开始")
    
    # ─── 6. 添加断线检测函数 ────────────────────────────────────────
    old_toggle = "function toggleInputPanel() {"
    new_toggle = """function startDisconnectMonitor() {
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
    
    if old_toggle in content:
        content = content.replace(old_toggle, new_toggle, 1)
        print("  ✅ 断线检测函数已添加")
    else:
        print("  ⚠️  未找到 toggleInputPanel 函数")
    
    # 写入
    with open(REMOTE_JS, 'w') as f:
        f.write(content)
    
    print("  remote.js 优化完成")
    return True

def main():
    print("开始优化浏览器远程控制流畅度 v2...")
    
    backup(SERVER_JS)
    backup(REMOTE_JS)
    
    try:
        optimize_server_js()
    except Exception as e:
        print(f"  ❌ server.js 优化失败: {e}")
        import traceback
        traceback.print_exc()
    
    try:
        optimize_remote_js()
    except Exception as e:
        print(f"  ❌ remote.js 优化失败: {e}")
        import traceback
        traceback.print_exc()
    
    print("\n=== 优化完成 ===")
    print("请重启 harvester 服务: pm2 restart harvester")

if __name__ == '__main__':
    main()
