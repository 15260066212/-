/**
 * Main Server Client — Anti-Corruption Layer for main server communication.
 *
 * Encapsulates all HTTP communication with the main server so that harvester
 * business logic doesn't need to know about URLs, HTTP methods, or response
 * formats. Includes exponential backoff retry for transient failures.
 */

import { CookieCredential, buildSyncPayload } from '../lib/credential-model.js';

export interface SyncResult {
  success: boolean;
  error?: string;
}

export interface SyncAllResult {
  success: boolean;
  synced: number;
  total: number;
  results: Array<{
    platform: string;
    accountName: string;
    success: boolean;
    error?: string;
  }>;
}

export class MainServerClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  /**
   * Sync a single cookie credential to the main server.
   * Uses exponential backoff retry for transient failures.
   *
   * - 4xx errors are NOT retried (client errors won't succeed on retry)
   * - 5xx errors and network errors ARE retried with exponential backoff
   */
  async syncCredential(
    cred: CookieCredential,
    options?: { maxRetries?: number }
  ): Promise<SyncResult> {
    const maxRetries = options?.maxRetries ?? 3;
    const payload = buildSyncPayload(cred);

    let lastError: string | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const resp = await fetch(`${this.baseUrl}/api/credentials/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (resp.ok) {
          return { success: true };
        }

        const text = await resp.text().catch(() => resp.statusText);
        lastError = `Server ${resp.status}: ${text}`;

        // Don't retry client errors (4xx) - they won't succeed on retry
        if (resp.status >= 400 && resp.status < 500) {
          break;
        }

        // Only retry on 5xx or network errors
        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 5000); // 1s, 2s, 4s (capped at 5s)
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        // Network error - retry
        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    return { success: false, error: lastError };
  }

  /**
   * Sync all local credentials to the main server.
   * Iterates through each credential and syncs sequentially with retry.
   */
  async syncAllCredentials(creds: CookieCredential[]): Promise<SyncAllResult> {
    const results: SyncAllResult['results'] = [];
    let synced = 0;

    for (const cred of creds) {
      const result = await this.syncCredential(cred);
      results.push({
        platform: cred.platform,
        accountName: cred.accountName,
        success: result.success,
        error: result.error,
      });
      if (result.success) synced++;
    }

    return {
      success: synced === creds.length,
      synced,
      total: creds.length,
      results,
    };
  }
}
