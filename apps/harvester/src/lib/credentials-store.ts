import fs from 'node:fs';
import path from 'node:path';
import type { StorageState } from '@zemingengine/shared';
import { cookieStringToStorageState } from '@zemingengine/shared';
import { buildCredentialKey, type CookieCredential } from './credential-model.js';

/**
 * Credentials store for the harvester service.
 *
 * This module manages harvested session credentials stored as JSON files.
 * Data model is aligned with @zemingengine/account-vault and
 * @zemingengine/shared's StorageState format.
 *
 * Data model (per platform entry):
 * {
 *   platform: string,           // harvester platform name (e.g. "zhihu", "baijiahao")
 *   platformName: string,       // Chinese display name
 *   type: 'cookie' | 'storageState', // credential type
 *   data: {
 *     cookie?: string,          // legacy: raw cookie header string
 *     storageState?: {          // preferred: full browser state (cookies + localStorage)
 *       cookies: Array,
 *       origins: Array
 *     }
 *   },
 *   status: 'active' | 'expired' | 'unknown',
 *   cookieCount: number,
 *   lastValidatedAt: string,    // ISO timestamp
 *   updatedAt: string,          // ISO timestamp
 * }
 */

export interface CredentialData {
  cookie?: string;
  cookies?: string;
  storageState?: StorageState | string;
  [key: string]: unknown;
}

export interface CredentialEntry {
  platform: string;
  platformName?: string;
  type: 'cookie' | 'storageState';
  data: CredentialData;
  status: 'active' | 'expired' | 'unknown';
  cookieCount: number;
  lastValidatedAt?: string;
  updatedAt?: string;
  accountName?: string;
  [key: string]: unknown;
}

export type CredentialsMap = Record<string, CredentialEntry>;

/**
 * Load credentials from a JSON file.
 * Returns empty object if file doesn't exist or is invalid.
 */
export function loadCredentials(filePath: string): CredentialsMap {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as CredentialsMap;
  } catch {
    return {};
  }
}

/**
 * Save credentials to a JSON file.
 * Creates parent directory if it doesn't exist.
 */
export function saveCredentials(filePath: string, data: CredentialsMap): boolean {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (e: unknown) {
    const err = e as Error;
    console.error('[Credentials] Failed to save:', err.message);
    return false;
  }
}

/**
 * Get credentials for a specific key.
 */
export function getCredential(filePath: string, key: string): CredentialEntry | null {
  const creds = loadCredentials(filePath);
  return creds[key] || null;
}

/**
 * Get all credentials.
 */
export function getAllCredentials(filePath: string): CredentialsMap {
  return loadCredentials(filePath);
}

/**
 * Insert or update credentials for a key.
 * Automatically sets key and updatedAt timestamp.
 */
export function upsertCredential(
  filePath: string,
  key: string,
  data: Partial<CredentialEntry>
): boolean {
  const creds = loadCredentials(filePath);
  creds[key] = {
    ...(data as CredentialEntry),
    platform: key,
    updatedAt: new Date().toISOString(),
  };
  return saveCredentials(filePath, creds);
}

/**
 * Insert or update a cookie credential using the unified CookieCredential model.
 * Typed wrapper around upsertCredential for cookie-type credentials.
 */
export function upsertCookieCredential(
  filePath: string,
  cred: CookieCredential
): boolean {
  const key = buildCredentialKey(cred.accountName, cred.platform);
  return upsertCredential(filePath, key, cred as unknown as Partial<CredentialEntry>);
}

/**
 * Delete credentials for a platform.
 */
export function deleteCredential(filePath: string, platform: string): boolean {
  const creds = loadCredentials(filePath);
  if (!creds[platform]) {
    return false;
  }
  delete creds[platform];
  return saveCredentials(filePath, creds);
}

// ─── StorageState helpers (aligned with @zemingengine/shared) ───

/**
 * Resolve the storage state from credential data.
 * Mirrors: resolveStorageState in shared storage-state.ts
 *
 * Priority:
 * 1. Full storageState object (preferred)
 * 2. Legacy cookie string (converted to minimal StorageState)
 */
export function resolveStorageState(credentialData: CredentialData): StorageState | null {
  if (!credentialData || typeof credentialData !== 'object') {
    return null;
  }

  // Priority 1: Full storageState object
  if (
    credentialData.storageState &&
    typeof credentialData.storageState === 'object' &&
    Array.isArray(credentialData.storageState.cookies)
  ) {
    return credentialData.storageState;
  }

  // Priority 2: storageState as JSON string
  if (typeof credentialData.storageState === 'string' && credentialData.storageState) {
    try {
      const parsed = JSON.parse(credentialData.storageState) as StorageState;
      if (Array.isArray(parsed.cookies)) return parsed;
    } catch {
      // fall through
    }
  }

  // Priority 3: Legacy cookie string
  const cookieStr = credentialData.cookie || credentialData.cookies || '';
  if (cookieStr) {
    return cookieStringToStorageState(cookieStr);
  }

  return null;
}

/**
 * Convert a StorageState back to a legacy cookie string.
 * Mirrors: storageStateToCookieString in shared storage-state.ts
 */
export function storageStateToCookieString(state: StorageState): string {
  if (!state || !Array.isArray(state.cookies) || state.cookies.length === 0) {
    return '';
  }
  return state.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}
