#!/usr/bin/env python3
"""基于行号的 server.js 优化 v3 - 修复重复行问题"""
import subprocess

SERVER_JS = '/home/ubuntu/geo-assistant-clean/harvester/server.js'

def check_syntax():
    result = subprocess.run(['node', '-c', SERVER_JS], capture_output=True, text=True)
    return result.returncode == 0, result.stderr

def find_line(pattern, start=0):
    with open(SERVER_JS, 'r') as f:
        lines = f.readlines()
    for i in range(start, len(lines)):
        if pattern in lines[i]:
            return i
    return -1

def replace_lines(start_line, end_line, new_content):
    """替换 [start_line, end_line) 行"""
    with open(SERVER_JS, 'r') as f:
        lines = f.readlines()
    new_lines = new_content.split('\n')
    new_lines = [l + '\n' for l in new_lines]
    result = lines[:start_line] + new_lines + lines[end_line:]
    with open(SERVER_JS, 'w') as f:
        f.writelines(result)

def main():
    print("优化 server.js v3...")
    
    # ─── Step 1: 质量模式 FPS 提升 + 新增变量 ─────────────────────
    print("\nStep 1: 提升 FPS 上限 + 添加性能变量")
    idx = find_line("const QUALITY_MODES = {")
    end_idx = find_line("};", idx)
    
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
    
    replace_lines(idx, end_idx + 1, new_modes)
    ok, err = check_syntax()
    if not ok:
        print(f"  ❌ 语法错误: {err[:200]}")
        return
    print("  ✅ 语法正确")
    
    # ─── Step 2: 替换 sendFrame + 插入 handlePong ──────────────────
    print("\nStep 2: 替换 sendFrame 函数")
    start_idx = find_line("async function sendFrame() {")
    end_idx = find_line("function startStreaming() {", start_idx)
    print(f"  替换行 {start_idx+1} - {end_idx} (共 {end_idx - start_idx} 行)")
    
    # 注意：new_sendframe 不包含 "function startStreaming() {" 这一行
    # 因为 end_idx 就是那一行，不会被替换
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

        frameCount++;

        // Adaptive quality with hysteresis and RTT awareness
        if (adaptiveQuality) {
          const buffered = ws.bufferedAmount || 0;
          const mode = QUALITY_MODES[qualityMode] || QUALITY_MODES.balanced;
          const minQ = mode.minQ, maxQ = mode.maxQ, minFPS = mode.minFPS, maxFPS = mode.maxFPS;

          let congestionScore = 0;
          if (buffered > 500 * 1024) congestionScore += 3;
          else if (buffered > 200 * 1024) congestionScore += 2;
          else if (buffered > 80 * 1024) congestionScore += 1;
          else if (buffered < 10 * 1024) congestionScore -= 1;

          if (rtt > 300) congestionScore += 2;
          else if (rtt > 150) congestionScore += 1;
          else if (rtt < 50) congestionScore -= 1;

          const maxFrameBudget = minFrameInterval * 0.8;
          if (frameTime > maxFrameBudget) congestionScore += 1;

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
      } catch (e) {
        // Ignore screenshot errors
      } finally {
        isScreenshotting = false;
        if (streaming) {
          const elapsed = Date.now() - startTime;
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

"""
    
    replace_lines(start_idx, end_idx, new_sendframe)
    ok, err = check_syntax()
    if not ok:
        print(f"  ❌ 语法错误: {err[:300]}")
        return
    print("  ✅ 语法正确")
    
    # ─── Step 3: 更新 startStreaming + stopStreaming ──────────────
    print("\nStep 3: 更新 startStreaming + stopStreaming")
    
    with open(SERVER_JS, 'r') as f:
        content = f.read()
    
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
        print("  ✅ startStreaming 已更新")
    else:
        print("  ⚠️  startStreaming 未匹配")
    
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
        print("  ✅ stopStreaming 已更新")
    else:
        print("  ⚠️  stopStreaming 未匹配")
    
    with open(SERVER_JS, 'w') as f:
        f.write(content)
    
    ok, err = check_syntax()
    if not ok:
        print(f"  ❌ 语法错误: {err[:300]}")
        return
    print("  ✅ 语法正确")
    
    # ─── Step 4: 添加 pong case ─────────────────────────────────────
    print("\nStep 4: 添加 pong case")
    
    with open(SERVER_JS, 'r') as f:
        content = f.read()
    
    old_case = """          case 'startStream':"""
    new_case = """          case 'pong':
            handlePong(Number(msg.t) || 0);
            break;

          case 'startStream':"""
    
    if old_case in content:
        pos = content.find(old_case)
        content = content[:pos] + new_case + content[pos+len(old_case):]
        print("  ✅ pong case 已添加")
    else:
        print("  ⚠️  未找到")
    
    with open(SERVER_JS, 'w') as f:
        f.write(content)
    
    ok, err = check_syntax()
    if not ok:
        print(f"  ❌ 语法错误: {err[:300]}")
        return
    print("  ✅ 语法正确")
    
    # ─── Step 5: 更新 drag ──────────────────────────────────────────
    print("\nStep 5: 更新拖拽质量")
    
    with open(SERVER_JS, 'r') as f:
        content = f.read()
    
    old_ds = """          case 'dragStart':
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
            break;"""
    
    new_ds = """          case 'dragStart':
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
            break;"""
    
    if old_ds in content:
        content = content.replace(old_ds, new_ds)
        print("  ✅ dragStart 已更新")
    else:
        print("  ⚠️  dragStart 未匹配")
    
    old_de = """          case 'dragEnd':
            // Restore quality based on mode after drag
            {
              const mode = QUALITY_MODES[qualityMode] || QUALITY_MODES.balanced;
              quality = mode.quality;
              targetFPS = mode.targetFPS;
              adaptiveQuality = mode.adaptiveQuality;
            }
            minFrameInterval = 1000 / targetFPS;
            break;"""
    
    new_de = """          case 'dragEnd':
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
    
    if old_de in content:
        content = content.replace(old_de, new_de)
        print("  ✅ dragEnd 已更新")
    else:
        print("  ⚠️  dragEnd 未匹配")
    
    with open(SERVER_JS, 'w') as f:
        f.write(content)
    
    ok, err = check_syntax()
    if not ok:
        print(f"  ❌ 语法错误: {err[:300]}")
        return
    print("  ✅ 语法正确")
    
    print("\n=== 所有优化完成，语法验证通过 ===")

if __name__ == '__main__':
    main()
