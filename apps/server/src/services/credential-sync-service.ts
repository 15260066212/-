import { PlatformCredentials, PlatformId } from '@zemingengine/shared';

// Constants
const DEFAULT_USER_ID = 'user_default';
const DEFAULT_ACCOUNT_ID = 'default';

/**
 * Validates a sync payload.
 * Returns null if valid, or an error message string if invalid.
 */
export function validateSyncPayload(body: any): string | null {
  if (!body.platform || typeof body.platform !== 'string' || body.platform.trim() === '') {
    return 'Invalid input: platform is required and must be a non-empty string';
  }
  if (!body.cookie || typeof body.cookie !== 'string' || body.cookie.trim() === '') {
    return 'Invalid input: cookie is required and must be a non-empty string';
  }
  if (body.cookieCount !== undefined && (typeof body.cookieCount !== 'number' || body.cookieCount < 0)) {
    return 'Invalid input: cookieCount must be a non-negative number';
  }
  return null;
}

/**
 * Builds a PlatformCredentials object from a sync payload.
 * Encapsulates all the rules: type is always cookie, status defaults to active,
 * platformName has a 3-tier fallback, etc.
 */
export function buildCredentialFromSyncPayload(
  body: any,
  existing: PlatformCredentials | null,
  platform: PlatformId,
  accountId: string,
): PlatformCredentials {
  return {
    platform,
    accountId,
    accountName: body.accountName || accountId,
    platformName: (existing as any)?.platformName || body.platformName || platform,
    type: 'cookie',
    data: { cookie: body.cookie },
    status: body.status || 'active',
    cookieCount: body.cookieCount ?? 0,
    lastValidatedAt: new Date().toISOString(),
    ...(existing ? { brandId: existing.brandId } : {}),
  } as PlatformCredentials;
}

/**
 * Checks if a credential is valid (has non-empty data).
 */
export function isCredentialValid(cred: PlatformCredentials): boolean {
  return Boolean(cred.data && Object.keys(cred.data).length > 0);
}

export { DEFAULT_USER_ID, DEFAULT_ACCOUNT_ID };
