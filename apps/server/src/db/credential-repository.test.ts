import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DB } from '../db.js';
import { DatabaseAccess } from '../db.js';
import { createTestDatabase, resetMockCounters } from '../test-helpers.js';
import type { PlatformCredentials } from '@zemingengine/shared';

describe('DatabaseAccess - Credentials', () => {
  let db: DB;
  let dbAccess: DatabaseAccess;

  beforeEach(() => {
    ({ db, dbAccess } = createTestDatabase());
    resetMockCounters();
  });

  afterEach(() => {
    db.close();
  });

  it('should upsert and retrieve a credential by platform', () => {
    const cred: PlatformCredentials = {
      platform: 'weixin',
      type: 'api_key',
      data: { apiKey: 'test-key-123', appId: 'wx123' },
      status: 'active',
    };
    dbAccess.credentials.upsertCredential('weixin', cred);

    const retrieved = dbAccess.credentials.getCredential('weixin');
    expect(retrieved).toBeDefined();
    expect(retrieved!.type).toBe('api_key');
    expect(retrieved!.data.apiKey).toBe('test-key-123', 'credential data should be fully persisted');
  });

  it('canonicalizes harvester platform names (toutiaohao → toutiao) on write and read', () => {
    // 模拟 node-agent/harvester 同步写入：使用 harvester 平台名
    dbAccess.credentials.upsertCredential('toutiaohao', {
      platform: 'toutiaohao' as PlatformCredentials['platform'],
      type: 'cookie',
      data: { cookie: 'fresh-cookie' },
      status: 'active',
    });

    // 读取侧用内部平台名必须能命中同一行
    const byCanonical = dbAccess.credentials.getCredential('toutiao');
    expect(byCanonical).toBeDefined();
    expect(byCanonical!.platform).toBe('toutiao');
    expect(byCanonical!.data.cookie).toBe('fresh-cookie');

    // 用别名读也命中
    const byAlias = dbAccess.credentials.getCredential('toutiaohao');
    expect(byAlias!.data.cookie).toBe('fresh-cookie');

    // 状态更新按别名写入，按规范名读
    dbAccess.credentials.updateCredentialStatus('toutiaohao', 'expired');
    expect(dbAccess.credentials.getCredential('toutiao')!.status).toBe('expired');

    // active 池查询只按规范名
    dbAccess.credentials.updateCredentialStatus('toutiao', 'active');
    const active = dbAccess.credentials.getActiveCredentialsForPlatform('toutiao');
    expect(active).toHaveLength(1);
  });

  it('should update existing credential on upsert', () => {
    dbAccess.credentials.upsertCredential('zhihu', {
      platform: 'zhihu', type: 'cookie', data: { session: 'old' }, status: 'active',
    });
    dbAccess.credentials.upsertCredential('zhihu', {
      platform: 'zhihu', type: 'cookie', data: { session: 'new' }, status: 'active',
    });

    const retrieved = dbAccess.credentials.getCredential('zhihu');
    expect(retrieved!.data.session).toBe('new', 'upsert should overwrite existing credential data');
  });

  it('should update credential status independently', () => {
    dbAccess.credentials.upsertCredential('csdn', {
      platform: 'csdn', type: 'cookie', data: { session: 'x' }, status: 'active',
    });
    dbAccess.credentials.updateCredentialStatus('csdn', 'expired');

    const retrieved = dbAccess.credentials.getCredential('csdn');
    expect(retrieved!.status).toBe('expired', 'credential status should be updated without changing data');
  });

  it('should delete a credential and make it unretrievable', () => {
    dbAccess.credentials.upsertCredential('juejin', {
      platform: 'juejin', type: 'token', data: { token: 't' }, status: 'active',
    });
    dbAccess.credentials.deleteCredential('juejin');
    expect(dbAccess.credentials.getCredential('juejin')).toBeUndefined('deleted credential should no longer exist');
  });

  it('should return all stored credentials', () => {
    dbAccess.credentials.upsertCredential('weixin', { platform: 'weixin', type: 'api_key', data: { k: 'v' }, status: 'active' });
    dbAccess.credentials.upsertCredential('zhihu', { platform: 'zhihu', type: 'cookie', data: { s: 'v' }, status: 'active' });
    const all = dbAccess.credentials.getAllCredentials();
    expect(all.length).toBe(2, 'all inserted credentials should be returned');
  });
});

describe('DatabaseAccess - Credentials Advanced', () => {
  let db: DB;
  let dbAccess: DatabaseAccess;

  beforeEach(() => {
    ({ db, dbAccess } = createTestDatabase());
    resetMockCounters();
  });

  afterEach(() => {
    db.close();
  });

  it('should get credentials filtered by platform', () => {
    dbAccess.credentials.upsertCredential('weixin', {
      platform: 'weixin',
      accountId: 'default',
      type: 'api_key',
      data: { key: 'value123' },
      status: 'active',
    });
    dbAccess.credentials.upsertCredential('zhihu', {
      platform: 'zhihu',
      accountId: 'default',
      type: 'cookie',
      data: { cookie: 'abc=123' },
      status: 'active',
    });

    const weixinCreds = dbAccess.credentials.getCredentialsByPlatform('weixin');
    expect(weixinCreds.length).toBe(1);
    expect(weixinCreds[0].platform).toBe('weixin');

    const zhihuCreds = dbAccess.credentials.getCredentialsByPlatform('zhihu');
    expect(zhihuCreds.length).toBe(1);
    expect(zhihuCreds[0].platform).toBe('zhihu', 'credentials should be filterable by platform');
  });

  it('should handle multi-account credentials on the same platform', () => {
    dbAccess.credentials.upsertCredential('csdn', {
      platform: 'csdn',
      accountId: 'account-a',
      accountName: '账号A',
      type: 'cookie',
      data: { cookie: 'a_cookie' },
      status: 'active',
    });
    dbAccess.credentials.upsertCredential('csdn', {
      platform: 'csdn',
      accountId: 'account-b',
      accountName: '账号B',
      type: 'cookie',
      data: { cookie: 'b_cookie' },
      status: 'active',
    });

    const allCsdn = dbAccess.credentials.getCredentialsByPlatform('csdn');
    expect(allCsdn.length).toBe(2);

    const accountA = dbAccess.credentials.getCredential('csdn', 'user_default', 'account-a');
    expect(accountA).toBeDefined();
    expect(accountA!.accountId).toBe('account-a');
    expect(accountA!.accountName).toBe('账号A');

    const accountB = dbAccess.credentials.getCredential('csdn', 'user_default', 'account-b');
    expect(accountB).toBeDefined();
    expect(accountB!.accountId).toBe('account-b', 'each account credential should be retrievable by accountId');
  });

  it('should return credentials due for health check', () => {
    // Insert an active credential
    dbAccess.credentials.upsertCredential('juejin', {
      platform: 'juejin',
      accountId: 'default',
      type: 'cookie',
      data: { cookie: 'test' },
      status: 'active',
    });

    const due = dbAccess.credentials.getCredentialsDueForCheck(5);
    // Newly inserted credential with no last_checked_at should be due
    expect(due.length).toBe(1, 'new credentials with no last_checked_at should be due for check');
  });

  it('should record health check and preserve active status when valid', () => {
    dbAccess.credentials.upsertCredential('sohu', {
      platform: 'sohu',
      accountId: 'default',
      type: 'cookie',
      data: { cookie: 'test' },
      status: 'active',
    });

    dbAccess.credentials.recordHealthCheck('sohu', 'user_default', 'valid', 'OK', 'default');

    const cred = dbAccess.credentials.getCredential('sohu');
    expect(cred).toBeDefined();
    expect(cred!.status).toBe('active', 'valid health check should keep credential active');
  });
});
