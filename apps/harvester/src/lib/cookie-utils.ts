/**
 * Cookie utilities for the harvester service.
 *
 * Core utilities (filterCookiesByDomain, isLoginRedirectUrl) are re-exported
 * from @zemingengine/shared. Platform-specific lookup tables are built from
 * the unified platform-registry, keyed by harvester name.
 *
 * Keys use the harvester naming convention (e.g. "baijiahao", "toutiaohao")
 * matching the `harvesterName` field in platform-registry.
 */

import type { Cookie } from 'playwright';
import { listAllPlatforms, filterCookiesByDomain as sharedFilterCookiesByDomain, isLoginRedirectUrl as sharedIsLoginRedirectUrl } from '@zemingengine/shared';

// Build lookup tables keyed by harvesterName
const platformsByHarvesterName: Record<string, { domains: string[]; authCookieNames: string[] }> = {};
for (const p of listAllPlatforms()) {
  if (p.harvesterName) {
    platformsByHarvesterName[p.harvesterName] = {
      domains: p.domains ?? [],
      authCookieNames: p.authCookieNames ?? [],
    };
  }
}

/**
 * Platform cookie domains for filtering
 * Built from PlatformInfo.domains in shared platform-registry
 */
export const PLATFORM_DOMAINS: Record<string, string[]> = /*@__PURE__*/ (() => {
  const result: Record<string, string[]> = {};
  for (const [key, p] of Object.entries(platformsByHarvesterName)) {
    result[key] = p.domains;
  }
  // "toutiao" alias (used in some places interchangeably with toutiaohao)
  if (result['toutiaohao'] && !result['toutiao']) {
    result['toutiao'] = result['toutiaohao'];
  }
  return result;
})();

/**
 * Get auth cookie names for a platform
 * Built from PlatformInfo.authCookieNames in shared platform-registry
 */
export function getAuthCookieNames(platform: string): string[] {
  const p = platformsByHarvesterName[platform];
  if (p) return p.authCookieNames;
  // "toutiao" alias fallback
  if (platform === 'toutiao' && platformsByHarvesterName['toutiaohao']) {
    return platformsByHarvesterName['toutiaohao'].authCookieNames;
  }
  return [];
}

/**
 * Parse cookie header string into Playwright-style cookie objects
 * (plus platform-specific domain assignment)
 * @param cookieStr - Cookie header string like "name1=value1; name2=value2"
 * @param platformOrDomain - Platform name (harvester naming) OR domain string/domain array
 */
export function parseCookieString(cookieStr: string, platformOrDomain?: string | string[]): Cookie[] {
  let primaryDomain = '';
  if (platformOrDomain) {
    if (Array.isArray(platformOrDomain)) {
      primaryDomain = platformOrDomain[0] ? `.${platformOrDomain[0].replace(/^\./, '')}` : '';
    } else if (typeof platformOrDomain === 'string') {
      // Try as platform name first
      const domains = PLATFORM_DOMAINS[platformOrDomain];
      if (domains && domains.length > 0) {
        primaryDomain = `.${domains[0]}`;
      } else {
        // Treat as raw domain string
        primaryDomain = platformOrDomain.startsWith('.') ? platformOrDomain : `.${platformOrDomain}`;
      }
    }
  }
  const cookies: Cookie[] = [];

  if (!cookieStr || typeof cookieStr !== 'string') {
    return cookies;
  }

  const pairs = cookieStr.split(';').filter((p) => p.trim());
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const name = pair.substring(0, idx).trim();
    const value = pair.substring(idx + 1).trim();
    if (!name) continue;
    cookies.push({
      name,
      value,
      domain: primaryDomain,
      path: '/',
      expires: -1,
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
    });
  }

  return cookies;
}

/**
 * Convert cookie objects to cookie header string
 */
export function cookiesToString(cookies: Array<{ name: string; value: string }>): string {
  if (!Array.isArray(cookies) || cookies.length === 0) {
    return '';
  }
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

// Wrap shared's filterCookiesByDomain with proper Cookie typing
// (shared uses a narrow Array<{domain?: string}> parameter type)
export function filterCookiesByDomain(cookies: Cookie[], domains: string[]): Cookie[] {
  return sharedFilterCookiesByDomain(cookies as Array<{ domain?: string }>, domains) as Cookie[];
}
export function isLoginRedirectUrl(url: string, targetDomains: string[]): boolean {
  return sharedIsLoginRedirectUrl(url, targetDomains);
}
