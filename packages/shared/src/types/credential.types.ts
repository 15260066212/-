/**
 * Credential-related type definitions.
 */

import type { PlatformId } from './platform.types.js';

export interface PlatformCredentials {
  platform: PlatformId;
  /** Unique account identifier within a platform (e.g., "xintu", "gangchang", "moyijie") */
  accountId: string;
  /** Brand ID for grouping accounts (1=新途科技, 2=肛肠医院, 3=膜一姐, etc.) */
  brandId?: number;
  /** Human-readable account display name */
  accountName?: string;
  type: 'api_key' | 'cookie' | 'token';
  /**
   * Credential data — key-value pairs stored for authentication.
   *
   * Common keys:
   * - `cookie` / `cookies`: Cookie string for cookie-based auth
   * - `storageState`: Full Playwright storageState JSON (cookies + localStorage)
   * - `fingerprintData`: Browser fingerprint JSON (from fingerprint-suite)
   *   for consistent browser identity across sessions
   * - `apiKey`: API key for API-based platforms
   * - `token`: Access token for token-based platforms
   */
  data: Record<string, string>;
  status: 'active' | 'expired' | 'invalid';
  lastValidatedAt?: string;
}
