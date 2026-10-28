/**
 * Platform configuration for the harvester service.
 *
 * Thin re-export layer built on top of @zemingengine/shared's platform-registry.
 * Lookup tables are keyed by harvesterName for backward compatibility.
 *
 * Keys use the harvester naming convention (e.g. "baijiahao", "toutiaohao")
 * matching the `harvesterName` field in platform-registry.
 */

import { listAllPlatforms, type PlatformInfo, type PlatformLoginConfig } from '@zemingengine/shared';

// Build lookup tables keyed by harvesterName
const platformsByHarvesterName: Record<string, PlatformInfo> = {};
for (const p of listAllPlatforms()) {
  if (p.harvesterName) {
    platformsByHarvesterName[p.harvesterName] = p;
  }
}

/** Platform homepage URLs, keyed by harvester name */
export const PLATFORM_URLS: Record<string, string> = /*@__PURE__*/ (() => {
  const result: Record<string, string> = {};
  for (const [key, p] of Object.entries(platformsByHarvesterName)) {
    result[key] = p.homepage ?? p.editorUrl ?? p.url ?? '';
  }
  return result;
})();

/** Platform display names (Chinese), keyed by harvester name */
export const PLATFORM_NAMES: Record<string, string> = /*@__PURE__*/ (() => {
  const result: Record<string, string> = {};
  for (const [key, p] of Object.entries(platformsByHarvesterName)) {
    result[key] = p.label;
  }
  return result;
})();

/** Health check / verify login URLs, keyed by harvester name */
export const CHECK_URLS: Record<string, string> = /*@__PURE__*/ (() => {
  const result: Record<string, string> = {};
  for (const [key, p] of Object.entries(platformsByHarvesterName)) {
    result[key] = p.checkUrl ?? p.editorUrl ?? p.homepage ?? p.url ?? '';
  }
  return result;
})();

/** Login redirect URL patterns, keyed by harvester name */
export const PLATFORM_LOGIN_REDIRECTS: Record<string, string[]> = /*@__PURE__*/ (() => {
  const result: Record<string, string[]> = {};
  for (const [key, p] of Object.entries(platformsByHarvesterName)) {
    result[key] = p.loginRedirectPatterns ?? [];
  }
  return result;
})();

/** Login page text fragments, keyed by harvester name */
export const PLATFORM_LOGIN_TEXTS: Record<string, string[]> = /*@__PURE__*/ (() => {
  const result: Record<string, string[]> = {};
  for (const [key, p] of Object.entries(platformsByHarvesterName)) {
    result[key] = p.loginTexts ?? [];
  }
  return result;
})();

/** Logged-in indicator CSS selectors, keyed by harvester name */
export const PLATFORM_LOGGED_IN_SELECTORS: Record<string, string[]> = /*@__PURE__*/ (() => {
  const result: Record<string, string[]> = {};
  for (const [key, p] of Object.entries(platformsByHarvesterName)) {
    result[key] = p.loggedInSelectors ?? [];
  }
  return result;
})();

/** Auto-login configuration, keyed by harvester name */
export const LOGIN_CONFIG: Record<string, PlatformLoginConfig> = /*@__PURE__*/ (() => {
  const result: Record<string, PlatformLoginConfig> = {};
  for (const [key, p] of Object.entries(platformsByHarvesterName)) {
    if (p.loginConfig) {
      result[key] = p.loginConfig;
    }
  }
  return result;
})();
