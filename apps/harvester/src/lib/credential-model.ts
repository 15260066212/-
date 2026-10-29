import { listAllPlatforms } from '@zemingengine/shared';

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
 * harvester 平台名 → 主库 PlatformId 映射（sohuhao → sohu、wangyihao → netease…）。
 * 若不转换，主库会存成 harvester 名字，而发布侧按 PlatformId 查凭证，永远查不到。
 */
const HARVESTER_TO_PLATFORM_ID: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const p of listAllPlatforms()) {
    if (p.harvesterName) map[p.harvesterName] = p.id;
  }
  return map;
})();

export function toPlatformId(harvesterPlatform: string): string {
  return HARVESTER_TO_PLATFORM_ID[harvesterPlatform] ?? harvesterPlatform;
}

/** 反向映射：主库 PlatformId → harvester 平台名（toutiao → toutiaohao）。 */
const PLATFORM_ID_TO_HARVESTER: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const p of listAllPlatforms()) {
    if (p.harvesterName) map[p.id] = p.harvesterName;
  }
  return map;
})();

/**
 * 主库/发布侧传进来的 PlatformId 转回 harvester 平台名。
 * 主库已统一存 PlatformId，而 harvester 路由（refresh-cookies/check-session）
 * 以及本地凭证 key 仍以 harvesterName 为准，所以入口需要转换。
 */
export function toHarvesterName(platformId: string): string {
  return PLATFORM_ID_TO_HARVESTER[platformId] ?? platformId;
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
    platform: toPlatformId(cred.platform),
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
