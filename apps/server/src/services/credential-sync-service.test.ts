import { describe, it, expect } from 'vitest';
import type { PlatformCredentials } from '@zemingengine/shared';
import {
  validateSyncPayload,
  buildCredentialFromSyncPayload,
  isCredentialValid,
} from './credential-sync-service.js';

describe('validateSyncPayload', () => {
  it('returns null for valid payload', () => {
    const result = validateSyncPayload({
      platform: 'zhihu',
      cookie: 'z_c0=abc',
      cookieCount: 1,
    });
    expect(result).toBeNull();
  });

  it('rejects missing platform', () => {
    const result = validateSyncPayload({
      cookie: 'z_c0=abc',
    });
    expect(result).not.toBeNull();
    expect(result).toContain('platform');
  });

  it('rejects empty platform', () => {
    const result = validateSyncPayload({
      platform: '',
      cookie: 'z_c0=abc',
    });
    expect(result).not.toBeNull();
    expect(result).toContain('platform');
  });

  it('rejects missing cookie', () => {
    const result = validateSyncPayload({
      platform: 'zhihu',
    });
    expect(result).not.toBeNull();
    expect(result).toContain('cookie');
  });

  it('rejects negative cookieCount', () => {
    const result = validateSyncPayload({
      platform: 'zhihu',
      cookie: 'z_c0=abc',
      cookieCount: -1,
    });
    expect(result).not.toBeNull();
    expect(result).toContain('cookieCount');
  });

  it('accepts missing cookieCount (optional)', () => {
    const result = validateSyncPayload({
      platform: 'zhihu',
      cookie: 'z_c0=abc',
    });
    expect(result).toBeNull();
  });
});

describe('buildCredentialFromSyncPayload', () => {
  it('builds with all fields', () => {
    const result = buildCredentialFromSyncPayload(
      {
        platform: 'zhihu',
        platformName: '知乎',
        accountName: 'user123',
        cookie: 'z_c0=abc; d_c0=def',
        cookieCount: 2,
        status: 'expired',
      },
      null,
      'zhihu',
      'user123',
    );

    expect(result.platform).toBe('zhihu');
    expect(result.accountId).toBe('user123');
    expect(result.accountName).toBe('user123');
    expect(result.platformName).toBe('知乎');
    expect(result.type).toBe('cookie');
    expect(result.data.cookie).toBe('z_c0=abc; d_c0=def');
    expect(result.status).toBe('expired');
    expect(result.cookieCount).toBe(2);
    expect(result.lastValidatedAt).toBeDefined();
  });

  it('uses existing platformName when available', () => {
    const existing = {
      platform: 'zhihu',
      accountId: 'user123',
      type: 'cookie',
      data: { cookie: 'old' },
      status: 'active',
      platformName: '知乎平台',
    } as unknown as PlatformCredentials;

    const result = buildCredentialFromSyncPayload(
      {
        platform: 'zhihu',
        platformName: '知乎',
        cookie: 'z_c0=new',
      },
      existing,
      'zhihu',
      'user123',
    );

    expect(result.platformName).toBe('知乎平台');
  });

  it('falls back to platform when no platformName', () => {
    const result = buildCredentialFromSyncPayload(
      {
        platform: 'zhihu',
        cookie: 'z_c0=abc',
      },
      null,
      'zhihu',
      'user123',
    );

    expect(result.platformName).toBe('zhihu');
  });

  it('defaults status to active', () => {
    const result = buildCredentialFromSyncPayload(
      {
        platform: 'zhihu',
        cookie: 'z_c0=abc',
      },
      null,
      'zhihu',
      'user123',
    );

    expect(result.status).toBe('active');
  });
});

describe('isCredentialValid', () => {
  it('returns true for valid credential', () => {
    const cred = {
      platform: 'zhihu' as const,
      accountId: 'user123',
      type: 'cookie' as const,
      data: { cookie: 'z_c0=abc' },
      status: 'active' as const,
    };
    expect(isCredentialValid(cred)).toBe(true);
  });

  it('returns false for empty data', () => {
    const cred = {
      platform: 'zhihu' as const,
      accountId: 'user123',
      type: 'cookie' as const,
      data: {},
      status: 'active' as const,
    };
    expect(isCredentialValid(cred)).toBe(false);
  });
});
