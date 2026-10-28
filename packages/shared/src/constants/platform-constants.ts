/**
 * Platform-related derived constants (names, labels, URLs).
 *
 * These are computed from the unified platform registry for single-source-of-truth.
 */

import type { PlatformId } from '../types/platform.types.js';
import { listAllPlatforms } from './platform-registry.js';

/**
 * Chinese display names for publishing platforms.
 * Derived from the unified platform registry for single-source-of-truth.
 */
export const PLATFORM_NAMES: Record<string, string> = /*@__PURE__*/ (() => {
  const result: Record<string, string> = {};
  for (const p of listAllPlatforms()) {
    result[p.id] = p.label;
  }
  return result;
})();

/** Chinese display labels for all platforms (publishing + AI monitoring). */
export const PLATFORM_LABELS: Record<string, string> = {
  ...PLATFORM_NAMES,
  deepseek: 'DeepSeek',
  kimi: 'Kimi',
  doubao: '豆包',
  yuanbao: '元宝',
  qianwen: '千问',
};

/**
 * Editor/publish page URLs for each RPA-supported platform.
 * Derived from the unified platform registry for single-source-of-truth.
 * Both rpa-handlers and session-health selector-registry reference this map.
 */
export const PLATFORM_URLS: Partial<Record<PlatformId, string>> = /*@__PURE__*/ (() => {
  const result: Partial<Record<PlatformId, string>> = {};
  for (const p of listAllPlatforms()) {
    const url = p.editorUrl ?? p.url;
    if (url) {
      result[p.id] = url;
    }
  }
  return result;
})();
