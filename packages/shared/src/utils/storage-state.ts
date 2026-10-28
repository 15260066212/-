/**
 * StorageState utilities for full browser state persistence.
 *
 * Playwright's storageState captures cookies + localStorage + IndexedDB
 * in a single JSON file. Restoring full state instead of just cookies
 * reduces "new device" detection and significantly extends session lifespan.
 *
 * Compatibility:
 * - If only legacy cookie string is available, convert it to a minimal
 *   storageState JSON with just cookies.
 * - If full storageState is available, use it directly.
 */

import type { Cookie } from 'playwright';

export interface StorageState {
  cookies: Cookie[];
  origins: Array<{
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
  }>;
}

/**
 * Parse a legacy Netscape-style cookie string into a StorageState object.
 * Used for backward compatibility when only cookie strings are available.
 */
export function cookieStringToStorageState(cookieStr: string): StorageState {
  const cookies: Cookie[] = [];
  const pairs = cookieStr.split(';');

  for (const pair of pairs) {
    const trimmed = pair.trim();
    if (!trimmed) continue;

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;

    const name = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();

    if (!name) continue;

    cookies.push({
      name,
      value,
      domain: '',
      path: '/',
      expires: -1,
      httpOnly: false,
      secure: false,
      sameSite: 'Lax' as const,
    });
  }

  return { cookies, origins: [] };
}

/**
 * Convert a StorageState back to a legacy cookie string.
 * Used for backward compatibility with systems that expect plain cookie strings.
 */
export function storageStateToCookieString(state: StorageState): string {
  return state.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

/**
 * Ensure the credential has a storageState field.
 * If only legacy cookie string is present, convert it.
 * Returns the full StorageState object.
 */
export function resolveStorageState(credentialData: Record<string, unknown>): StorageState | null {
  // Priority 1: Full storageState JSON string
  if (typeof credentialData.storageState === 'string' && credentialData.storageState) {
    try {
      return JSON.parse(credentialData.storageState) as StorageState;
    } catch {
      // Invalid JSON, fall through to cookie string
    }
  }

  // Priority 2: storageState as object
  if (
    credentialData.storageState &&
    typeof credentialData.storageState === 'object' &&
    Array.isArray((credentialData.storageState as StorageState).cookies)
  ) {
    return credentialData.storageState as StorageState;
  }

  // Priority 3: Legacy cookie string
  const cookieStr = (credentialData.cookie || credentialData.cookies || '') as string;
  if (cookieStr) {
    return cookieStringToStorageState(cookieStr);
  }

  return null;
}

/**
 * Merge refreshed cookies from the harvester into an existing storage state.
 * Preserves localStorage and other state while updating cookies.
 */
export function mergeRefreshedCookies(
  existingState: StorageState | null,
  refreshedCookies: Cookie[],
): StorageState {
  return {
    cookies: refreshedCookies,
    origins: existingState?.origins ?? [],
  };
}

/**
 * Check if a credential has full storage state (not just cookies).
 */
export function hasFullStorageState(credentialData: Record<string, unknown>): boolean {
  if (typeof credentialData.storageState !== 'string') return false;
  try {
    const state = JSON.parse(credentialData.storageState) as StorageState;
    return Array.isArray(state.origins) && state.origins.length > 0;
  } catch {
    return false;
  }
}

/**
 * Filter cookies by domain list (substring match on domain field).
 */
export function filterCookiesByDomain(
  cookies: Array<{ domain?: string }>,
  domains: string[],
): Array<{ domain?: string }> {
  if (!Array.isArray(cookies) || !Array.isArray(domains)) {
    return [];
  }
  return cookies.filter((c) => domains.some((d) => (c.domain || '').includes(d)));
}

/**
 * Check whether a URL matches any login redirect pattern.
 * @param url - URL to check
 * @param redirectPatterns - Array of patterns to match (case-insensitive substring)
 */
export function isLoginRedirectUrl(url: string, redirectPatterns: string[]): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }
  if (!Array.isArray(redirectPatterns) || redirectPatterns.length === 0) {
    return false;
  }
  const lowerUrl = url.toLowerCase();
  return redirectPatterns.some((p) => lowerUrl.includes(p.toLowerCase()));
}
