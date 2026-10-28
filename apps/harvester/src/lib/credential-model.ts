/**
 * Cookie credential data structure - unified across harvester local storage and main server sync.
 */
export interface CookieCredential {
  platform: string;
  platformName?: string;
  accountName: string;
  type: 'cookie';
  data: {
    cookie: string;
  };
  status: 'active' | 'expired' | 'invalid';
  cookieCount: number;
  lastValidatedAt: string;
  updatedAt?: string;
}

/**
 * Creates a standardized cookie credential object.
 * Single source of truth for what a cookie credential looks like.
 */
export function createCookieCredential(params: {
  platform: string;
  platformName?: string;
  accountName: string;
  cookie: string;
  cookieCount: number;
  status?: 'active' | 'expired' | 'invalid';
}): CookieCredential {
  const now = new Date().toISOString();
  return {
    platform: params.platform,
    platformName: params.platformName,
    accountName: params.accountName,
    type: 'cookie',
    data: { cookie: params.cookie },
    status: params.status || 'active',
    cookieCount: params.cookieCount,
    lastValidatedAt: now,
    updatedAt: now,
  };
}

/**
 * Builds a sync payload for the main server from a CookieCredential.
 * Encapsulates the mapping between local credential model and server API format.
 */
export function buildSyncPayload(cred: CookieCredential): {
  platform: string;
  platformName?: string;
  accountId: string;
  accountName: string;
  cookie: string;
  cookieCount: number;
  status: string;
} {
  return {
    platform: cred.platform,
    platformName: cred.platformName,
    accountId: cred.accountName,
    accountName: cred.accountName,
    cookie: cred.data.cookie,
    cookieCount: cred.cookieCount,
    status: cred.status,
  };
}

/**
 * Builds the storage key for a credential (account:platform format).
 */
export function buildCredentialKey(accountName: string, platform: string): string {
  return `${accountName}:${platform}`;
}

/**
 * Parses a credential key into account and platform parts.
 */
export function parseCredentialKey(key: string): { accountName: string; platform: string } {
  const colonIdx = key.indexOf(':');
  if (colonIdx === -1) {
    return { accountName: 'default', platform: key };
  }
  return {
    accountName: key.slice(0, colonIdx),
    platform: key.slice(colonIdx + 1),
  };
}
