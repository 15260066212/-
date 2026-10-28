#!/usr/bin/env python3
"""分步优化 server.js，每步验证语法"""
import subprocess
import sys

SERVER_JS = '/home/ubuntu/geo-assistant-clean/harvester/server.js'

def check_syntax():
    """检查语法"""
    result = subprocess.run(['node', '-c', SERVER_JS], capture_output=True, text=True)
    if result.returncode == 0:
        return True, ""
    return False, result.stderr

def step1_quality_modes():
    """步骤1：提升 FPS 上限"""
    print("\n--- Step 1: 提升 FPS 上限 ---")
    with open(SERVER_JS, 'r') as f:
        content = f.read()
    
    old = """    const QUALITY_MODES = {
      fast:     { quality: 20, targetFPS: 4,  adaptiveQuality: true,  minQ: 15, maxQ: 30, minFPS: 3,  maxFPS: 6  },
      balanced: { quality: 50, targetFPS: 12, adaptiveQuality: true,  minQ: 35, maxQ: 65, minFPS: 8,  maxFPS: 15 },
      high:     { quality: 65, targetFPS: 18, adaptiveQuality: true,  minQ: 55, maxQ: 80, minFPS: 12, maxFPS: 20 },
      captcha:  { quality: 85, targetFPS: 22, adaptiveQuality: false, minQ: 80, maxQ: 92, minFPS: 15, maxFPS: 25 },
    };"""
    
    new = """    const QUALITY_MODES = {
      fast:     { quality: 20, targetFPS: 8,  adaptiveQuality: true,  minQ: 15, maxQ: 35, minFPS: 5,  maxFPS: 12 },
      balanced: { quality: 50, targetFPS: 18, adaptiveQuality: true,  minQ: 35, maxQ: 70, minFPS: 12, maxFPS: 24 },
      high:     { quality: 65, targetFPS: 24, adaptiveQuality: true,  minQ: 50, maxQ: 82, minFPS: 15, maxFPS: 30 },
      captcha:  { quality: 85, targetFPS: 28, adaptiveQuality: false, minQ: 80, maxQ: 92, minFPS: 18, maxFPS: 30 },
    };"""
    
    if old not in content:
        print("  ❌ 未找到 QUALITY_MODES")
        return False
    
    content = content.replace(old, new)
    with open(SERVER_JS, 'w') as f:
        f.write(content)
    
    ok, err = check_syntax()
    if ok:
        print("  ✅ 语法正确")
        return True
    else:
        print(f"  ❌ 语法错误: {err[:200]}")
        return False

def step2_backpressure():
    """步骤2：背压调度 + caret:initial"""
    print("\n--- Step 2: 背压调度优化 ---")
    with open(SERVER_JS, 'r') as f:
        content = f.read()
    
    # 只修改 finally 块中的调度逻辑，以及添加 caret: 'initial'
    # 找 old 的 finally 块
    old_finally = """      } finally {
        isScreenshotting = false;
        if (streaming) {
          const elapsed = Date.now() - startTime;
          const nextDelay = Math.max(50, minFrameInterval - elapsed);
          frameTimeout = setTimeout(sendFrame, nextDelay);
        }
      }"""
    
    new_finally = """      } finally {
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
      }"""
    
    if old_finally not in content:
        print("  ❌ 未找到 finally 块")
        # 调试
        idx = content.find("isScreenshotting = false;")
        if idx != -1:
            print(f"  调试: isScreenshotting = false 在位置 {idx}")
            print(repr(content[idx-50:idx+150]))
        return False
    
    content = content.replace(old_finally, new_finally)
    
    # 添加 caret: 'initial'
    old_screenshot = """        const screenshot = await page.screenshot({
          type: 'jpeg',
          quality: Math.round(quality),
          fullPage: false,
          animations: 'disabled'
        });"""
    
    new_screenshot = """        const screenshot = await page.screenshot({
          type: 'jpeg',
          quality: Math.round(quality),
          fullPage: false,
          animations: 'disabled',
          caret: 'initial'
        });"""
    
    if old_screenshot in content:
        content = content.replace(old_screenshot, new_screenshot)
    else:
        print("  ⚠️  未找到 screenshot 调用（跳过 caret）")
    
    with open(SERVER_JS, 'w') as f:
        f.write(content)
    
    ok, err = check_syntax()
    if ok:
        print("  ✅ 语法正确")
        return True
    else:
        print(f"  ❌ 语法错误: {err[:200]}")
        return False

def step3_rtt_and_hysteresis():
    """步骤3：RTT 测量 + 滞回自适应质量"""
    print("\n--- Step 3: RTT + 滞回自适应 ---")
    with open(SERVER_JS, 'r') as f:
        content = f.read()
    
    # 在 QUALITY_MODES 后添加性能变量和 ema 函数
    old_modes_end = """      captcha:  { quality: 85, targetFPS: 28, adaptiveQuality: false, minQ: 80, maxQ: 92, minFPS: 18, maxFPS: 30 },
    };"""
    
    new_modes_end = """      captcha:  { quality: 85, targetFPS: 28, adaptiveQuality: false, minQ: 80, maxQ: 92, minFPS: 18, maxFPS: 30 },
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
    
    if old_modes_end not in content:
        print("  ❌ 未找到 QUALITY_MODES 结尾")
        return False
    
    content = content.replace(old_modes_end, new_modes_end)
    
    # 替换自适应质量逻辑
    old_adaptive = """        // Adaptive quality adjustment (every 8 frames) based on network congestion
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
        }"""
    
    new_adaptive = """        const frameTime = Date.now() - startTime;
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
        }"""
    
    if old_adaptive not in content:
        print("  ❌ 未找到旧的自适应质量代码")
        # 调试
        idx = content.find("Adaptive quality adjustment")
        if idx != -1:
            print(f"  调试: 找到 'Adaptive quality adjustment' 在位置 {idx}")
            print(repr(content[idx:idx+200]))
        return False
    
    content = content.replace(old_adaptive, new_adaptive)
    with open(SERVER_JS, 'w') as f:
        f.write(content)
    
    ok, err = check_syntax()
    if ok:
        print("  ✅ 语法正确")
        return True
    else:
        print(f"  ❌ 语法错误: {err[:300]}")
        return False

def step4_ping_pong():
    """步骤4：Ping/Pong RTT 测量"""
    print("\n--- Step 4: Ping/Pong RTT 测量 ---")
    with open(SERVER_JS, 'r') as f:
        content = f.read()
    
    # 添加 handlePong 函数（在 startStreaming 之前）
    old_start = """    function startStreaming() {
      if (streaming) return;
      streaming = true;
      sendFrame();
    }"""
    
    new_start = """    function handlePong(pingTime) {
      const measured = Date.now() - pingTime;
      rtt = ema(rtt, measured, 0.3);
    }

    function startStreaming() {
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
    
    if old_start not in content:
        print("  ❌ 未找到 startStreaming 函数")
        idx = content.find("function startStreaming")
        if idx != -1:
            print(f"  调试: 位置 {idx}")
            print(repr(content[idx:idx+120]))
        return False
    
    content = content.replace(old_start, new_start)
    
    # 更新 stopStreaming
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
    else:
        print("  ⚠️  未找到 stopStreaming（跳过）")
    
    # 添加 pong case
    old_case_start = """          case 'startStream':"""
    new_case_start = """          case 'pong':
            handlePong(Number(msg.t) || 0);
            break;

          case 'startStream':"""
    
    if old_case_start in content:
        content = content.replace(old_case_start, new_case_start, 1)
    else:
        print("  ⚠️  未找到 startStream case（跳过 pong）")
    
    with open(SERVER_JS, 'w') as f:
        f.write(content)
    
    ok, err = check_syntax()
    if ok:
        print("  ✅ 语法正确")
        return True
    else:
        print(f"  ❌ 语法错误: {err[:300]}")
        return False

def step5_drag_optimize():
    """步骤5：拖拽质量优化"""
    print("\n--- Step 5: 拖拽质量优化 ---")
    with open(SERVER_JS, 'r') as f:
        content = f.read()
    
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
    
    if old_drag not in content:
        print("  ❌ 未找到 dragStart/dragEnd")
        idx = content.find("case 'dragStart'")
        if idx != -1:
            print(f"  调试: 位置 {idx}")
            print(repr(content[idx:idx+200]))
        return False
    
    content = content.replace(old_drag, new_drag)
    with open(SERVER_JS, 'w') as f:
        f.write(content)
    
    ok, err = check_syntax()
    if ok:
        print("  ✅ 语法正确")
        return True
    else:
        print(f"  ❌ 语法错误: {err[:300]}")
        return False

def main():
    print("分步优化 server.js...")
    
    steps = [
        ("FPS 上限提升", step1_quality_modes),
        ("背压调度", step2_backpressure),
        ("RTT + 滞回自适应", step3_rtt_and_hysteresis),
        ("Ping/Pong RTT 测量", step4_ping_pong),
        ("拖拽质量优化", step5_drag_optimize),
    ]
    
    for name, fn in steps:
        if not fn():
            print(f"\n❌ 步骤 [{name}] 失败，停止优化")
            sys.exit(1)
    
    print("\n=== 所有优化完成，语法验证通过 ===")

if __name__ == '__main__':
    main()
