import { getHarvesterPlatformName } from '@zemingengine/shared';

export interface RefreshResponse {
  success: boolean;
  valid: boolean;
  refreshedCookies?: string;
  refreshedStorageState?: string;
  refreshedFingerprintData?: string;
  reason?: string;
}

export interface ProfileInfo {
  platform: string;
  accountName: string;
  sizeBytes: number;
  sizeMB: number;
}

export interface ProfileHealthResponse {
  success: boolean;
  platform: string;
  account: string;
  loggedIn: boolean;
  url?: string;
  authCookies?: boolean;
  sizeBytes?: number;
  sizeMB?: number;
  error?: string;
}

export interface ProfileRenewResponse {
  success: boolean;
  platform: string;
  account: string;
  loggedIn: boolean;
  error?: string;
}

export interface RenewAllResponse {
  total: number;
  renewed: number;
  stillLoggedIn: number;
  failed: number;
  results: Array<{
    platform: string;
    accountName: string;
    success: boolean;
    loggedIn: boolean;
    error?: string;
  }>;
}

export interface LLMwikiPublishResponse {
  success: boolean;
  publishMode: 'profile' | 'cookie' | 'fresh';
  verificationStatus?: string;
  verificationMessage?: string;
  error?: string;
  [key: string]: unknown;
}

function hasRealAuthData(cookie: string, storageState: string): boolean {
  return (!!cookie && cookie !== 'placeholder_pending_login') || !!storageState;
}

/**
 * Encapsulates HTTP communication with the RPA harvester service.
 * Provides shared methods for building request bodies, calling endpoints,
 * and extracting credential updates from refresh responses.
 */
export class HarvesterClient {
  private readonly baseUrl: string;

  constructor(harvesterUrl: string) {
    this.baseUrl = harvesterUrl.replace(/\/+$/, '');
  }

  /**
   * Build a refresh-cookies request body from credential data.
   * Returns null if no real auth data (cookie or storageState) is present.
   */
  buildRefreshBody(
    data: Record<string, string>,
    platform: string,
  ): Record<string, string> | null {
    const cookie = data.cookie || data.cookies || '';
    const storageState = data.storageState || '';
    const fingerprintData = data.fingerprintData || '';

    if (!hasRealAuthData(cookie, storageState)) return null;

    const harvesterPlatform = getHarvesterPlatformName(platform);
    const body: Record<string, string> = { platform: harvesterPlatform };
    if (storageState) {
      body.storageState = storageState;
    } else if (cookie) {
      body.cookies = cookie;
    }
    if (fingerprintData) {
      body.fingerprintData = fingerprintData;
    }
    return body;
  }

  /** Call /api/rpa/refresh-cookies. Returns null on HTTP error or fetch failure. */
  async refreshCookies(
    body: Record<string, string>,
    timeoutMs: number = 30000,
  ): Promise<RefreshResponse | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/rpa/refresh-cookies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return null;
      return (await res.json()) as RefreshResponse;
    } catch {
      return null;
    }
  }

  /** Extract credential update fields from a successful refresh response. */
  static extractUpdateData(data: RefreshResponse): Record<string, string> {
    const updateData: Record<string, string> = {};

    if (data.refreshedStorageState) {
      updateData.storageState = data.refreshedStorageState;
      if (data.refreshedCookies) {
        updateData.cookie = data.refreshedCookies;
      }
    } else if (data.refreshedCookies) {
      updateData.cookie = data.refreshedCookies;
    }

    if (data.refreshedFingerprintData) {
      updateData.fingerprintData = data.refreshedFingerprintData;
    }

    return updateData;
  }

  // ============ Profile Management ============

  /** List all account profiles on the harvester. */
  async listProfiles(timeoutMs: number = 10000): Promise<ProfileInfo[] | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/profiles`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return null;
      const data = await res.json() as { success: boolean; profiles: ProfileInfo[] };
      return data.profiles || [];
    } catch {
      return null;
    }
  }

  /** Check login health of a specific profile. */
  async checkProfileHealth(
    platform: string,
    accountName: string,
    timeoutMs: number = 20000,
  ): Promise<ProfileHealthResponse | null> {
    try {
      const encodedAccount = encodeURIComponent(accountName);
      const res = await fetch(
        `${this.baseUrl}/api/profiles/${platform}/${encodedAccount}/health`,
        { signal: AbortSignal.timeout(timeoutMs) },
      );
      if (!res.ok) return null;
      return (await res.json()) as ProfileHealthResponse;
    } catch {
      return null;
    }
  }

  /** Delete an account profile. */
  async deleteProfile(
    platform: string,
    accountName: string,
    timeoutMs: number = 10000,
  ): Promise<boolean> {
    try {
      const encodedAccount = encodeURIComponent(accountName);
      const res = await fetch(
        `${this.baseUrl}/api/profiles/${platform}/${encodedAccount}`,
        {
          method: 'DELETE',
          signal: AbortSignal.timeout(timeoutMs),
        },
      );
      if (!res.ok) return false;
      const data = await res.json() as { success: boolean; deleted: boolean };
      return data.deleted ?? data.success;
    } catch {
      return false;
    }
  }

  /** Renew a single profile's login state. */
  async renewProfile(
    platform: string,
    accountName: string,
    timeoutMs: number = 30000,
  ): Promise<ProfileRenewResponse | null> {
    try {
      const encodedAccount = encodeURIComponent(accountName);
      const res = await fetch(
        `${this.baseUrl}/api/profiles/${platform}/${encodedAccount}/renew`,
        {
          method: 'POST',
          signal: AbortSignal.timeout(timeoutMs),
        },
      );
      if (!res.ok) return null;
      return (await res.json()) as ProfileRenewResponse;
    } catch {
      return null;
    }
  }

  /** Renew all profiles at once. */
  async renewAllProfiles(timeoutMs: number = 120000): Promise<RenewAllResponse | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/profiles/renew-all`, {
        method: 'POST',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return null;
      return (await res.json()) as RenewAllResponse;
    } catch {
      return null;
    }
  }

  // ============ LLMwiki Publish ============

  /**
   * Publish an article via LLMwiki endpoint (profile-first mode).
   * @param platform Harvester platform name (e.g. 'toutiaohao')
   * @param article Article content
   * @param options Account name + optional cookie/storageState fallback
   */
  async publishLLMwiki(
    platform: string,
    article: { title: string; contentMarkdown?: string; contentHtml?: string },
    options: {
      accountName: string;
      cookieString?: string;
      storageState?: string;
    },
    timeoutMs: number = 60000,
  ): Promise<LLMwikiPublishResponse | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/llmwiki/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          article,
          credentials: {
            accountName: options.accountName,
            platform,
            data: {
              cookie: options.cookieString || '',
              storageState: options.storageState || '',
            },
          },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        const err = await res.text().catch(() => 'Unknown error');
        return { success: false, publishMode: 'fresh', error: err } as LLMwikiPublishResponse;
      }
      return (await res.json()) as LLMwikiPublishResponse;
    } catch (err) {
      return {
        success: false,
        publishMode: 'fresh',
        error: err instanceof Error ? err.message : String(err),
      } as LLMwikiPublishResponse;
    }
  }
}
