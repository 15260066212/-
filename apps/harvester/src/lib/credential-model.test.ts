import { describe, it, expect } from 'vitest';
import {
  createCookieCredential,
  buildSyncPayload,
  buildCredentialKey,
  parseCredentialKey,
} from './credential-model.js';

describe('createCookieCredential', () => {
  it('creates a valid credential with all fields', () => {
    const cred = createCookieCredential({
      platform: 'zhihu',
      platformName: '知乎',
      accountName: 'user123',
      cookie: 'z_c0=abc; d_c0=def',
      cookieCount: 2,
      status: 'active',
    });

    expect(cred.platform).toBe('zhihu');
    expect(cred.platformName).toBe('知乎');
    expect(cred.accountName).toBe('user123');
    expect(cred.type).toBe('cookie');
    expect(cred.data.cookie).toBe('z_c0=abc; d_c0=def');
    expect(cred.status).toBe('active');
    expect(cred.cookieCount).toBe(2);
    expect(cred.lastValidatedAt).toBeDefined();
    expect(cred.updatedAt).toBeDefined();
  });

  it('defaults status to active', () => {
    const cred = createCookieCredential({
      platform: 'csdn',
      accountName: 'test_user',
      cookie: 'session=xyz',
      cookieCount: 1,
    });

    expect(cred.status).toBe('active');
  });

  it('sets lastValidatedAt to ISO string', () => {
    const before = new Date().toISOString();
    const cred = createCookieCredential({
      platform: 'juejin',
      accountName: 'dev',
      cookie: 'token=123',
      cookieCount: 1,
    });
    const after = new Date().toISOString();

    expect(cred.lastValidatedAt).toBeDefined();
    expect(() => new Date(cred.lastValidatedAt)).not.toThrow();
    expect(cred.lastValidatedAt >= before).toBe(true);
    expect(cred.lastValidatedAt <= after).toBe(true);
    // updatedAt should match lastValidatedAt (both set to "now")
    expect(cred.updatedAt).toBe(cred.lastValidatedAt);
  });
});

describe('buildSyncPayload', () => {
  it('maps credential to sync payload format', () => {
    const cred = createCookieCredential({
      platform: 'zhihu',
      platformName: '知乎',
      accountName: 'user123',
      cookie: 'z_c0=abc; d_c0=def',
      cookieCount: 2,
      status: 'active',
    });

    const payload = buildSyncPayload(cred);

    expect(payload.platform).toBe('zhihu');
    expect(payload.platformName).toBe('知乎');
    expect(payload.accountName).toBe('user123');
    expect(payload.cookie).toBe('z_c0=abc; d_c0=def');
    expect(payload.cookieCount).toBe(2);
    expect(payload.status).toBe('active');
  });

  it('accountId equals accountName', () => {
    const cred = createCookieCredential({
      platform: 'bilibili',
      accountName: 'bili_user',
      cookie: 'sess=123',
      cookieCount: 1,
    });

    const payload = buildSyncPayload(cred);

    expect(payload.accountId).toBe('bili_user');
    expect(payload.accountId).toBe(payload.accountName);
  });
});

describe('buildCredentialKey', () => {
  it('builds account:platform format', () => {
    const key = buildCredentialKey('myaccount', 'zhihu');
    expect(key).toBe('myaccount:zhihu');
  });
});

describe('parseCredentialKey', () => {
  it('parses a valid key correctly', () => {
    const result = parseCredentialKey('user123:zhihu');
    expect(result.accountName).toBe('user123');
    expect(result.platform).toBe('zhihu');
  });

  it('handles key without colon gracefully', () => {
    const result = parseCredentialKey('zhihu');
    expect(result.accountName).toBe('default');
    expect(result.platform).toBe('zhihu');
  });
});
