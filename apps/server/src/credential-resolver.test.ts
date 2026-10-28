import { describe, it, expect, vi } from 'vitest';
import type { PlatformCredentials } from '@zemingengine/shared';
import { resolvePublishCredential, resolveAccountIdFromBody } from './credential-resolver.js';

function createMockCred(overrides: Partial<PlatformCredentials> = {}): PlatformCredentials {
  return {
    platform: 'weixin',
    accountId: 'acc1',
    type: 'cookie',
    data: { cookie: 'test_cookie' },
    status: 'active',
    ...overrides,
  };
}

function createMockDb(opts: {
  credential?: PlatformCredentials | null;
  platformCreds?: PlatformCredentials[];
  brandCreds?: PlatformCredentials[];
}) {
  return {
    credentials: {
      getCredential: vi.fn().mockReturnValue(opts.credential ?? null),
      getActiveCredentialsForPlatform: vi.fn().mockReturnValue(opts.platformCreds ?? []),
      getActiveCredentialsForPlatformAndBrand: vi.fn().mockReturnValue(opts.brandCreds ?? []),
    },
  };
}

describe('resolvePublishCredential', () => {
  it('指定账号且状态为 active 时直接返回', () => {
    const cred = createMockCred({ accountId: 'acc1', status: 'active' });
    const db = createMockDb({ credential: cred });

    const result = resolvePublishCredential(db as any, 'weixin', 'user1', { accountId: 'acc1' });

    expect(result.success).toBe(true, 'should have correct success flag when 指定账号且状态为 active 时直接返回');
    if (result.success) {
      expect(result.credentials.accountId).toBe('acc1', 'should have correct accountId when 指定账号且状态为 active 时直接返回');
    }
    expect(db.credentials.getCredential).toHaveBeenCalledWith('weixin', 'user1', 'acc1');
  });

  it('指定账号不存在时从平台池中查找备选', () => {
    const altCred = createMockCred({ accountId: 'acc2', status: 'active' });
    const db = createMockDb({
      credential: null,
      platformCreds: [altCred],
    });

    const result = resolvePublishCredential(db as any, 'weixin', 'user1', { accountId: 'acc1' });

    expect(result.success).toBe(true, 'should have correct success flag when 指定账号不存在时从平台池中查找备选');
    if (result.success) {
      expect(result.credentials.accountId).toBe('acc2', 'should have correct accountId when 指定账号不存在时从平台池中查找备选');
    }
    expect(db.credentials.getActiveCredentialsForPlatform).toHaveBeenCalled('should have been called for 指定账号不存在时从平台池中查找备选');
  });

  it('指定账号过期时从品牌池中查找备选', () => {
    const expired = createMockCred({ accountId: 'acc1', status: 'expired' });
    const brandCred = createMockCred({ accountId: 'brand-acc', status: 'active' });
    const db = createMockDb({
      credential: expired,
      brandCreds: [brandCred],
    });

    const result = resolvePublishCredential(db as any, 'weixin', 'user1', {
      accountId: 'acc1',
      brandId: 1,
    });

    expect(result.success).toBe(true, 'should have correct success flag when 指定账号过期时从品牌池中查找备选');
    if (result.success) {
      expect(result.credentials.accountId).toBe('brand-acc', 'should have correct accountId when 指定账号过期时从品牌池中查找备选');
    }
    expect(db.credentials.getActiveCredentialsForPlatformAndBrand).toHaveBeenCalledWith('weixin', 1, 'user1');
  });

  it('无任何可用凭证时返回失败和原因', () => {
    const db = createMockDb({ credential: null, platformCreds: [] });

    const result = resolvePublishCredential(db as any, 'weixin', 'user1', { accountId: 'acc1' });

    expect(result.success).toBe(false, 'should have correct success flag when 无任何可用凭证时返回失败和原因');
    if (!result.success) {
      expect(result.reason).toContain('Cookie未采集', 'should contain expected value in reason for 无任何可用凭证时返回失败和原因');
      expect(result.failureType).toBe('auth', 'should have correct failureType when 无任何可用凭证时返回失败和原因');
    }
  });

  it('主凭证过期且无备选时返回过期原因', () => {
    const expired = createMockCred({ accountId: 'acc1', status: 'expired' });
    const db = createMockDb({ credential: expired, platformCreds: [] });

    const result = resolvePublishCredential(db as any, 'weixin', 'user1', { accountId: 'acc1' });

    expect(result.success).toBe(false, 'should have correct success flag when 主凭证过期且无备选时返回过期原因');
    if (!result.success) {
      expect(result.reason).toContain('过期', 'should contain expected value in reason for 主凭证过期且无备选时返回过期原因');
    }
  });

  it('主凭证无效且无备选时返回无效原因', () => {
    const invalid = createMockCred({ accountId: 'acc1', status: 'invalid' });
    const db = createMockDb({ credential: invalid, platformCreds: [] });

    const result = resolvePublishCredential(db as any, 'weixin', 'user1', { accountId: 'acc1' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toContain('无效');
    }
  });

  it('排除指定 cookie 的备选凭证', () => {
    const sameCookie = createMockCred({ accountId: 'acc2', status: 'active', data: { cookie: 'same_cookie' } });
    const differentCookie = createMockCred({ accountId: 'acc3', status: 'active', data: { cookie: 'diff_cookie' } });
    const db = createMockDb({
      credential: null,
      platformCreds: [sameCookie, differentCookie],
    });

    const result = resolvePublishCredential(db as any, 'weixin', 'user1', {
      accountId: 'acc1',
      excludeCookie: 'same_cookie',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.credentials.accountId).toBe('acc3');
    }
  });
});

describe('resolveAccountIdFromBody', () => {
  it('优先使用 accountIds 中平台特定的账号', () => {
    const db = createMockDb({});
    const result = resolveAccountIdFromBody(
      { accountId: 'shared', accountIds: { weixin: 'weixin-acc' } },
      'weixin',
      db as any,
      'user1',
    );
    expect(result).toBe('weixin-acc');
  });

  it('没有平台特定账号时使用通用 accountId', () => {
    const db = createMockDb({});
    const result = resolveAccountIdFromBody(
      { accountId: 'shared' },
      'weixin',
      db as any,
      'user1',
    );
    expect(result).toBe('shared');
  });

  it('有 brandId 且无显式 accountId 时从品牌凭证中查找', () => {
    const brandCred = createMockCred({ accountId: 'brand-acc', status: 'active' });
    const db = createMockDb({ brandCreds: [brandCred] });

    const result = resolveAccountIdFromBody(
      { brandId: 1 },
      'weixin',
      db as any,
      'user1',
    );

    expect(result).toBe('brand-acc');
    expect(db.credentials.getActiveCredentialsForPlatformAndBrand).toHaveBeenCalledWith('weixin', 1, 'user1');
  });

  it('brandId 无匹配凭证时返回 undefined', () => {
    const db = createMockDb({ brandCreds: [] });
    const result = resolveAccountIdFromBody(
      { brandId: 99 },
      'weixin',
      db as any,
      'user1',
    );
    expect(result).toBeUndefined();
  });
});
