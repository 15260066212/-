/**
 * Shared types, interfaces, and constants for remote WebSocket actions.
 *
 * All action modules (stream-actions, mouse-actions, input-actions, nav-actions)
 * import shared types from here to avoid circular dependencies and duplication.
 */

import type { Page } from 'playwright';
import type { WebSocket } from 'ws';
import type { RemoteSession } from '../remote-browser.js';

// ─── Quality Mode Types ───────────────────────────────────────────────────────

export type QualityMode = 'fast' | 'balanced' | 'high' | 'captcha';

export interface QualityModeConfig {
  quality: number;
  targetFPS: number;
  adaptiveQuality: boolean;
  minQ: number;
  maxQ: number;
  minFPS: number;
  maxFPS: number;
}

export const QUALITY_MODES: Record<QualityMode, QualityModeConfig> = {
  fast:     { quality: 20, targetFPS: 8,  adaptiveQuality: true,  minQ: 15, maxQ: 35, minFPS: 5,  maxFPS: 12 },
  balanced: { quality: 50, targetFPS: 18, adaptiveQuality: true,  minQ: 35, maxQ: 70, minFPS: 12, maxFPS: 24 },
  high:     { quality: 65, targetFPS: 24, adaptiveQuality: true,  minQ: 50, maxQ: 82, minFPS: 15, maxFPS: 30 },
  captcha:  { quality: 85, targetFPS: 28, adaptiveQuality: false, minQ: 80, maxQ: 92, minFPS: 18, maxFPS: 30 },
};

// ─── Stream State ─────────────────────────────────────────────────────────────

/**
 * Mutable stream state shared across action handlers.
 * Passed by reference so handlers can mutate directly.
 */
export interface StreamState {
  quality: number;
  targetFPS: number;
  minFrameInterval: number;
  adaptiveQuality: boolean;
  qualityMode: QualityMode;
  streaming: boolean;
  frameCount: number;
  lastQualityAdjust: number;
  isScreenshotting: boolean;
  lastUrl: string;
  frameTimeout: ReturnType<typeof setTimeout> | null;

  // ─── Performance metrics ────────────────────────────────────────────────────
  /** Rolling average of screenshot + encode time in ms */
  avgFrameTime: number;
  /** Rolling average of frame size in KB */
  avgFrameSize: number;
  /** Current estimated round-trip time in ms (from ping/pong) */
  rtt: number;
  /** Last ping timestamp */
  lastPingTime: number;
  /** Ping interval handle */
  pingInterval: ReturnType<typeof setInterval> | null;
  /** Consecutive low-buffer frames (for quality ramp-up) */
  goodFrames: number;
  /** Consecutive high-buffer frames (for quality ramp-down) */
  badFrames: number;
}

export function createStreamState(): StreamState {
  const mode = QUALITY_MODES.balanced;
  return {
    quality: mode.quality,
    targetFPS: mode.targetFPS,
    minFrameInterval: 1000 / mode.targetFPS,
    adaptiveQuality: mode.adaptiveQuality,
    qualityMode: 'balanced',
    streaming: false,
    frameCount: 0,
    lastQualityAdjust: 0,
    isScreenshotting: false,
    lastUrl: '',
    frameTimeout: null,

    // Performance metrics
    avgFrameTime: 30,
    avgFrameSize: 100,
    rtt: 50,
    lastPingTime: 0,
    pingInterval: null,
    goodFrames: 0,
    badFrames: 0,
  };
}

// ─── Action Context ───────────────────────────────────────────────────────────

/**
 * Context object passed to every action handler.
 * Contains all shared dependencies: page, session, ws, and stream state.
 */
export interface ActionContext {
  page: Page;
  session: RemoteSession;
  ws: WebSocket;
  state: StreamState;
}

// ─── Input Helpers JS ─────────────────────────────────────────────────────────

/**
 * Helper code injected into page.evaluate() for setting input values
 * in a way that triggers framework reactivity (Vue/React/Angular).
 * Injected via eval() inside each evaluate callback.
 */
export const INPUT_HELPERS_JS = `
  function __setInputVal(el, val) {
    if (!el) return false;
    var tag = el.tagName;
    var proto;
    if (tag === 'INPUT') proto = HTMLInputElement.prototype;
    else if (tag === 'TEXTAREA') proto = HTMLTextAreaElement.prototype;
    else proto = Object.getPrototypeOf(el);
    var desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, val);
    else el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  function __deleteBackwards(el) {
    if (!el) return { handled: false };
    var start = el.selectionStart ?? 0;
    var end = el.selectionEnd ?? 0;
    var newStart = start;
    var newValue;
    if (start === end && start > 0) {
      newValue = el.value.slice(0, start - 1) + el.value.slice(end);
      newStart = start - 1;
    } else if (start !== end) {
      newValue = el.value.slice(0, start) + el.value.slice(end);
    } else {
      return { handled: false };
    }
    __setInputVal(el, newValue);
    el.selectionStart = el.selectionEnd = newStart;
    return { handled: true, newStart: newStart };
  }
`;

/**
 * Ambient declarations so TypeScript knows the helper function signatures
 * inside page.evaluate() callbacks.  They do not exist at Node.js runtime —
 * they are only defined in the browser context via the INPUT_HELPERS_JS string.
 */
declare global {
  function __setInputVal(el: HTMLInputElement | HTMLTextAreaElement, val: string): boolean;
  function __deleteBackwards(el: HTMLInputElement | HTMLTextAreaElement): { handled: boolean; newStart: number };
}
