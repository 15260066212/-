/**
 * Stream control actions — frame sending, quality modes, drag quality boost.
 *
 * Handles: startStream, stopStream, setQuality, frame, dragStart, dragEnd, ping
 * Also contains the sendFrame function which drives push-based streaming.
 *
 * Optimizations:
 * - Backpressure-based scheduling: next frame starts immediately after send
 * - RTT-aware adaptive quality (ping/pong latency measurement)
 * - Rolling average frame time/size for smoother adjustments
 * - Consecutive good/bad frame counting for stability
 */

import { QUALITY_MODES, type QualityMode, type ActionContext } from './types.js';

// ─── Unit conversion constants ───────────────────────────────────────────────
const MS_PER_SECOND = 1000;
const BYTES_PER_KB = 1024;

// ─── EMA (Exponential Moving Average) alpha values ──────────────────────────
const EMA_ALPHA_DEFAULT = 0.2;
const EMA_ALPHA_FRAME_TIME = 0.15;
const EMA_ALPHA_FRAME_SIZE = 0.15;
const EMA_ALPHA_RTT = 0.3;

// ─── Buffer congestion thresholds (bytes) ───────────────────────────────────
const BUFFER_SEVERE_BYTES = 500 * BYTES_PER_KB;
const BUFFER_MODERATE_BYTES = 200 * BYTES_PER_KB;
const BUFFER_MILD_BYTES = 80 * BYTES_PER_KB;
const BUFFER_CLEAR_BYTES = 10 * BYTES_PER_KB;

// ─── RTT thresholds (milliseconds) ──────────────────────────────────────────
const RTT_HIGH_MS = 300;
const RTT_MEDIUM_MS = 150;
const RTT_LOW_MS = 50;

// ─── Frame budget ratios (fraction of minFrameInterval) ─────────────────────
const FRAME_BUDGET_RATIO = 0.8;
const FRAME_BUDGET_GOOD_RATIO = 0.7;

// ─── Consecutive frame thresholds for quality hysteresis ────────────────────
const CONSECUTIVE_BAD_FRAMES_DOWNGRADE = 3;
const CONSECUTIVE_GOOD_FRAMES_UPGRADE = 5;

// ─── Quality adjustment step sizes ──────────────────────────────────────────
const QUALITY_DOWNGRADE_SEVERE = 15;
const FPS_DOWNGRADE_SEVERE = 4;
const QUALITY_DOWNGRADE_MODERATE = 8;
const FPS_DOWNGRADE_MODERATE = 2;
const QUALITY_UPGRADE_STEP = 5;
const FPS_UPGRADE_STEP = 2;

// ─── Drag mode quality boost parameters ─────────────────────────────────────
const DRAG_QUALITY_CAPTCHA = 95;
const DRAG_FPS_CAPTCHA = 30;
const DRAG_QUALITY_BOOST = 20;
const DRAG_QUALITY_MAX_NORMAL = 90;
const DRAG_FPS_BOOST = 6;
const DRAG_FPS_MAX_NORMAL = 30;

// ─── Ping/RTT measurement interval ──────────────────────────────────────────
const PING_INTERVAL_MS = 2000;

// ─── Frame scheduling threshold ─────────────────────────────────────────────
const MIN_FRAME_DELAY_THRESHOLD_MS = 1;

/**
 * Apply a quality mode preset to the stream state.
 */
export function applyQualityMode(
  state: ActionContext['state'],
  mode: QualityMode
): void {
  const config = QUALITY_MODES[mode] ?? QUALITY_MODES.balanced;
  state.qualityMode = mode;
  state.quality = config.quality;
  state.targetFPS = config.targetFPS;
  state.adaptiveQuality = config.adaptiveQuality;
  state.minFrameInterval = MS_PER_SECOND / config.targetFPS;
  state.goodFrames = 0;
  state.badFrames = 0;
}

/**
 * Exponential moving average for smoother metrics.
 */
function ema(current: number, sample: number, alpha = EMA_ALPHA_DEFAULT): number {
  return current * (1 - alpha) + sample * alpha;
}

/**
 * Backpressure-based frame streaming — maximizes FPS while respecting
 * the target frame interval as a lower bound.
 *
 * Instead of waiting a fixed delay after each frame, we schedule the next
 * frame as soon as the current one is sent.  The minFrameInterval acts as
 * a floor to prevent CPU overload when screenshots are very fast.
 *
 * Quality adjustments are based on:
 * - ws.bufferedAmount (network congestion)
 * - RTT (round-trip time from ping/pong)
 * - Frame time (screenshot + encode cost)
 * - Consecutive good/bad frames (stability hysteresis)
 */
export async function sendFrame(
  page: ActionContext['page'],
  ws: ActionContext['ws'],
  state: ActionContext['state']
): Promise<void> {
  if (!state.streaming || ws.readyState !== ws.OPEN) return;
  if (state.isScreenshotting) return;

  state.isScreenshotting = true;
  const startTime = performance.now();

  try {
    const screenshot = await page.screenshot({
      type: 'jpeg',
      quality: Math.round(state.quality),
      fullPage: false,
      animations: 'disabled',
      caret: 'initial',
    });

    const frameTime = performance.now() - startTime;
    const sizeKB = screenshot.length / BYTES_PER_KB;

    // Update rolling averages
    state.avgFrameTime = ema(state.avgFrameTime, frameTime, EMA_ALPHA_FRAME_TIME);
    state.avgFrameSize = ema(state.avgFrameSize, sizeKB, EMA_ALPHA_FRAME_SIZE);

    // Adaptive quality adjustment
    if (state.adaptiveQuality) {
      adjustQuality(state, ws, frameTime, sizeKB);
    }

    // Send frame
    if (ws.readyState === ws.OPEN) {
      ws.send(screenshot);
    }

    // URL change detection
    const currentUrl = page.url();
    if (currentUrl !== state.lastUrl) {
      state.lastUrl = currentUrl;
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'url', url: currentUrl }));
      }
    }

    state.frameCount++;
  } catch {
    // Ignore screenshot errors
  } finally {
    state.isScreenshotting = false;
    if (state.streaming) {
      const elapsed = performance.now() - startTime;
      // Backpressure scheduling: if frame took less than minFrameInterval,
      // wait the remainder.  Otherwise schedule immediately (next tick).
      const remaining = state.minFrameInterval - elapsed;
      if (remaining > MIN_FRAME_DELAY_THRESHOLD_MS) {
        state.frameTimeout = setTimeout(
          () => { void sendFrame(page, ws, state); },
          remaining
        );
      } else {
        // Use setImmediate-equivalent via setTimeout(0) for the next tick
        state.frameTimeout = setTimeout(
          () => { void sendFrame(page, ws, state); },
          0
        );
      }
    }
  }
}

/**
 * Adjust quality/FPS based on network congestion, RTT, and frame time.
 * Uses consecutive frame counting (hysteresis) to avoid oscillation.
 */
function adjustQuality(
  state: ActionContext['state'],
  ws: ActionContext['ws'],
  frameTime: number,
  sizeKB: number
): void {
  const buffered = ws.bufferedAmount || 0;
  const mode = QUALITY_MODES[state.qualityMode] ?? QUALITY_MODES.balanced;
  const { minQ, maxQ, minFPS, maxFPS } = mode;

  // Severity scoring: combine buffer level, RTT, and frame time
  let congestionScore = 0;

  // Buffer-based scoring (primary signal)
  if (buffered > BUFFER_SEVERE_BYTES) congestionScore += 3;       // Severe
  else if (buffered > BUFFER_MODERATE_BYTES) congestionScore += 2;  // Moderate
  else if (buffered > BUFFER_MILD_BYTES) congestionScore += 1;   // Mild
  else if (buffered < BUFFER_CLEAR_BYTES) congestionScore -= 1;   // Clear

  // RTT-based scoring (secondary signal)
  if (state.rtt > RTT_HIGH_MS) congestionScore += 2;
  else if (state.rtt > RTT_MEDIUM_MS) congestionScore += 1;
  else if (state.rtt < RTT_LOW_MS) congestionScore -= 1;

  // Frame-time scoring: if screenshotting is the bottleneck
  const maxFrameBudget = state.minFrameInterval * FRAME_BUDGET_RATIO;
  if (frameTime > maxFrameBudget) congestionScore += 1;

  // Apply hysteresis: need consecutive frames in the same direction
  if (congestionScore >= 2) {
    state.badFrames++;
    state.goodFrames = 0;
    // After N consecutive bad frames, downgrade
    if (state.badFrames >= CONSECUTIVE_BAD_FRAMES_DOWNGRADE) {
      state.badFrames = 0;
      // Aggressive downgrade for severe congestion
      if (congestionScore >= 3) {
        state.quality = Math.max(minQ, state.quality - QUALITY_DOWNGRADE_SEVERE);
        state.targetFPS = Math.max(minFPS, state.targetFPS - FPS_DOWNGRADE_SEVERE);
      } else {
        state.quality = Math.max(minQ, state.quality - QUALITY_DOWNGRADE_MODERATE);
        state.targetFPS = Math.max(minFPS, state.targetFPS - FPS_DOWNGRADE_MODERATE);
      }
      state.minFrameInterval = MS_PER_SECOND / state.targetFPS;
    }
  } else if (congestionScore <= -1 && frameTime < maxFrameBudget * FRAME_BUDGET_GOOD_RATIO) {
    state.goodFrames++;
    state.badFrames = 0;
    // After N consecutive good frames, upgrade (slower than downgrade)
    if (state.goodFrames >= CONSECUTIVE_GOOD_FRAMES_UPGRADE) {
      state.goodFrames = 0;
      state.quality = Math.min(maxQ, state.quality + QUALITY_UPGRADE_STEP);
      if (state.targetFPS < maxFPS) {
        state.targetFPS = Math.min(maxFPS, state.targetFPS + FPS_UPGRADE_STEP);
        state.minFrameInterval = MS_PER_SECOND / state.targetFPS;
      }
    }
  } else {
    // Neutral - decay the counters slowly
    if (state.goodFrames > 0) state.goodFrames--;
    if (state.badFrames > 0) state.badFrames--;
  }
}

/**
 * Start push-based frame streaming and ping/heartbeat.
 */
export function startStreaming(
  page: ActionContext['page'],
  ws: ActionContext['ws'],
  state: ActionContext['state']
): void {
  if (state.streaming) return;
  state.streaming = true;
  state.goodFrames = 0;
  state.badFrames = 0;

  // Start frame stream
  void sendFrame(page, ws, state);

  // Start ping/RTT measurement
  if (!state.pingInterval) {
    state.pingInterval = setInterval(() => {
      if (ws.readyState === ws.OPEN && state.streaming) {
        state.lastPingTime = performance.now();
        ws.send(JSON.stringify({ type: 'ping', t: state.lastPingTime }));
      }
    }, PING_INTERVAL_MS);
  }
}

/**
 * Stop push-based frame streaming and clear all timers.
 */
export function stopStreaming(state: ActionContext['state']): void {
  state.streaming = false;
  if (state.frameTimeout) {
    clearTimeout(state.frameTimeout);
    state.frameTimeout = null;
  }
  if (state.pingInterval) {
    clearInterval(state.pingInterval);
    state.pingInterval = null;
  }
}

/**
 * Handle pong response from client to measure RTT.
 */
export function handlePong(state: ActionContext['state'], pingTime: number): void {
  const rtt = performance.now() - pingTime;
  // EMA-smoothed RTT
  state.rtt = ema(state.rtt, rtt, EMA_ALPHA_RTT);
}

// ─── Message Handler ──────────────────────────────────────────────────────────

/**
 * Handle stream-related WebSocket messages.
 *
 * @returns `true` if the message was handled, `false` if it belongs to another domain
 */
export async function handleStreamActions(
  msgType: string,
  msg: any,
  ctx: ActionContext
): Promise<boolean> {
  const { page, ws, state } = ctx;

  switch (msgType) {
    case 'startStream': {
      if (msg.mode && QUALITY_MODES[msg.mode as QualityMode]) {
        applyQualityMode(state, msg.mode as QualityMode);
      }
      startStreaming(page, ws, state);
      return true;
    }

    case 'stopStream': {
      stopStreaming(state);
      return true;
    }

    case 'setQuality': {
      if (msg.mode && QUALITY_MODES[msg.mode as QualityMode]) {
        applyQualityMode(state, msg.mode as QualityMode);
      }
      return true;
    }

    case 'frame': {
      // Legacy pull mode - still supported but prefer push
      if (!state.isScreenshotting) {
        await sendFrame(page, ws, state);
      }
      return true;
    }

    case 'dragStart': {
      state.adaptiveQuality = false;
      state.goodFrames = 0;
      state.badFrames = 0;
      if (state.qualityMode === 'captcha') {
        state.quality = DRAG_QUALITY_CAPTCHA;
        state.targetFPS = DRAG_FPS_CAPTCHA;
      } else {
        state.quality = Math.min(DRAG_QUALITY_MAX_NORMAL, state.quality + DRAG_QUALITY_BOOST);
        state.targetFPS = Math.min(DRAG_FPS_MAX_NORMAL, state.targetFPS + DRAG_FPS_BOOST);
      }
      state.minFrameInterval = MS_PER_SECOND / state.targetFPS;
      return true;
    }

    case 'dragEnd': {
      // Restore quality based on mode after drag
      const mode = QUALITY_MODES[state.qualityMode] ?? QUALITY_MODES.balanced;
      state.quality = mode.quality;
      state.targetFPS = mode.targetFPS;
      state.adaptiveQuality = mode.adaptiveQuality;
      state.minFrameInterval = MS_PER_SECOND / state.targetFPS;
      state.goodFrames = 0;
      state.badFrames = 0;
      return true;
    }

    case 'pong': {
      // Client responded to our ping — measure RTT
      handlePong(state, Number(msg.t) || 0);
      return true;
    }

    default:
      return false;
  }
}
