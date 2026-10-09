import type { DatabaseAccess } from './db.js';
import type { PlatformCredentials } from '@zemingengine/shared';

/**
 * Options for resolving publish credentials.
 *
 * Resolution order:
 * 1. Explicit accountId (if provided) → look up that specific credential
 * 2. Brand-based lookup (if brandId provided) → find first active credential for the brand
 * 3. Dynamic pool fallback → find any active credential for the platform
 */
export interface ResolveCredentialOptions {
  /** Explicit account ID to use. If provided, this credential is tried first. */
  accountId?: string;
  /** Brand ID for brand-scoped credential pool lookup. */
  brandId?: number;
  /** Cookie string to exclude from alternatives (avoid reusing a known-bad cookie). */
  excludeCookie?: string;
}

/** Result of credential resolution. */
export type CredentialResolutionResult =
  | { success: true; credentials: PlatformCredentials }
  | { success: false; reason: string; failureType: 'auth' | 'platform' };

/**
 * Resolve credentials for publishing to a platform.
 *
 * Tries, in order:
 * 1. The explicitly specified account (if accountId provided)
 * 2. Brand-specific active credentials (if brandId provided)
 * 3. Any active credential from the platform pool
 *
 * Returns the first usable active credential found, or a failure reason.
 */
export function resolvePublishCredential(
  db: DatabaseAccess,
  platform: string,
  userId: string,
  options: ResolveCredentialOptions = {},
): CredentialResolutionResult {
  const { accountId, brandId, excludeCookie } = options;
  const effectiveAccountId = accountId ?? 'default';

  // Step 1: Try the explicit account first
  const primary = db.credentials.getCredential(platform, userId, effectiveAccountId);
  if (primary && primary.status === 'active') {
    return { success: true, credentials: primary };
  }

  const primaryStatus = primary?.status ?? 'not_found';

  // Step 2: Try brand-scoped pool, then general pool
  const alternatives = brandId
    ? db.credentials.getActiveCredentialsForPlatformAndBrand(platform, brandId, userId)
    : db.credentials.getActiveCredentialsForPlatform(platform, userId);

  const usable = alternatives.filter((c) => {
    if (c.status !== 'active') return false;
    if (c.accountId === effectiveAccountId && primary?.status === 'active') return false;
    if (excludeCookie && c.data?.cookie === excludeCookie) return false;
    return true;
  });

  if (usable.length > 0) {
    return { success: true, credentials: usable[0] };
  }

  // No usable credential found — determine the failure reason
  let reason: string;
  let failureType: 'auth' | 'platform' = 'auth';

  if (!primary && alternatives.length === 0) {
    reason = `${platform}平台Cookie未采集，请先在「账号管理」中采集Cookie后再发布`;
  } else if (primaryStatus === 'expired') {
    reason = '账号登录态已过期，且无可用替代账号';
  } else if (primaryStatus === 'invalid') {
    reason = '账号凭证无效，且无可用替代账号';
  } else {
    reason = `No active credentials available for platform: ${platform}`;
  }

  return { success: false, reason, failureType };
}

/**
 * Resolve accountId from a request body with multiple possible sources.
 *
 * Priority:
 * 1. body.accountIds[platform] — per-platform account map
 * 2. body.accountId — single shared account ID
 * 3. body.brandId → look up first active credential for the brand
 * 4. undefined — caller will use 'default'
 */
export function resolveAccountIdFromBody(
  body: { accountId?: string; accountIds?: Partial<Record<string, string>>; brandId?: number },
  platform: string,
  db: DatabaseAccess,
  userId: string,
): string | undefined {
  let accountId = body.accountIds?.[platform] ?? body.accountId;
  if (!accountId && body.brandId) {
    const brandCreds = db.credentials.getActiveCredentialsForPlatformAndBrand(
      platform,
      body.brandId,
      userId,
    );
    if (brandCreds.length > 0) {
      accountId = brandCreds[0].accountId;
    }
  }
  return accountId;
}
