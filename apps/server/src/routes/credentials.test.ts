import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DB } from '../db.js';
import { DatabaseAccess } from '../db.js';
import { createTestDatabase, jsonReq } from '../test-helpers.js';
import type { PlatformCredentials } from '@zemingengine/shared';
import { createCredentialRoutes } from './credentials.js';

let db: DB;
let dbAccess: DatabaseAccess;

/**
 * 验证脱敏值的行为断言：
 * - 值不为空
 * - 值不等于原始值（敏感信息被隐藏）
 * - 长值：保留前后各2个字符，中间为星号
 * - 短值（<=4）：完全替换为星号
 */
function expectMasked(maskedValue: string, originalValue: string) {
  // 脱敏后的值不应为空
  expect(maskedValue).toBeDefined();
  expect(maskedValue.length).toBeGreaterThan(0, 'masked value should not be empty');

  // 脱敏后的值不应等于原始值（敏感信息不应暴露）
  expect(maskedValue).not.toBe(originalValue, 'masked value should not equal the original secret');

  if (originalValue.length <= 4) {
    // 短值：完全脱敏，全部是星号
    expect(maskedValue).toMatch(/^\*+$/, 'short values should be fully masked with asterisks');
  } else {
    // 长值：保留前2个和后2个字符，中间为星号
    const prefix = originalValue.slice(0, 2);
    const suffix = originalValue.slice(-2);
    expect(maskedValue.startsWith(prefix)).toBe(true, `masked value should start with first 2 chars: "${prefix}"`);
    expect(maskedValue.endsWith(suffix)).toBe(true, `masked value should end with last 2 chars: "${suffix}"`);
    // 中间部分应包含星号
    const middle = maskedValue.slice(2, -2);
    expect(middle.length).toBeGreaterThan(0, 'masked value should have asterisks in the middle');
    expect(middle).toMatch(/^\*+$/, 'middle of masked value should be asterisks only');
  }
}

beforeEach(() => {
  ({ db, dbAccess } = createTestDatabase());
});

afterEach(() => {
  db.close();
});

describe('Credential Routes', () => {
  let app: ReturnType<typeof createCredentialRoutes>;

  beforeEach(() => {
    app = createCredentialRoutes(dbAccess);
  });

  it('PUT /:platform - should save credentials and return masked data', async () => {
    const originalApiKey = 'test-key-12345';
    const originalAppId = 'wx1234567890';
    const cred: PlatformCredentials = {
      platform: 'weixin',
      type: 'api_key',
      data: { apiKey: originalApiKey, appId: originalAppId },
      status: 'active',
    };

    const res = await app.request('/weixin', jsonReq('PUT', cred));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.platform).toBe('weixin');
    expect(json.data.type).toBe('api_key');
    expect(json.data.status).toBe('active');
    // 行为断言：验证脱敏行为而非具体实现
    expectMasked(json.data.data.apiKey, originalApiKey);
    expectMasked(json.data.data.appId, originalAppId);
  });

  it('PUT /:platform - should mask short values (<=4 chars) fully and long values partially', async () => {
    const originalCode = 'ab';
    const originalSession = 'very-long-session-value-123';
    const cred: PlatformCredentials = {
      platform: 'zhihu',
      type: 'cookie',
      data: { code: originalCode, session: originalSession },
      status: 'active',
    };

    const res = await app.request('/zhihu', jsonReq('PUT', cred));
    const json = await res.json();

    expect(res.status).toBe(200);
    // 短值 -> 完全脱敏
    expectMasked(json.data.data.code, originalCode);
    // 长值 -> 部分脱敏（保留前后字符）
    expectMasked(json.data.data.session, originalSession);
  });

  it('GET / - should return all credentials with masked data', async () => {
    dbAccess.credentials.upsertCredential('weixin', {
      platform: 'weixin', accountId: 'default', type: 'api_key', data: { apiKey: 'test-key-12345' }, status: 'active',
    });
    dbAccess.credentials.upsertCredential('zhihu', {
      platform: 'zhihu', accountId: 'default', type: 'cookie', data: { session: 'abcdef123456' }, status: 'active',
    });

    const res = await app.request('/');
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(2);
    // Every credential value should be masked (never equal to the raw secret)
    for (const cred of json.data) {
      for (const value of Object.values(cred.data)) {
        expect(value).not.toBe('test-key-12345');
        expect(value).not.toBe('abcdef123456', 'raw credential values should never be exposed in the response');
      }
    }
  });

  it('GET /:platform - should return 200 with masked data for an existing credential', async () => {
    const originalSession = 'csdn-secret-token-999';
    dbAccess.credentials.upsertCredential('csdn', {
      platform: 'csdn', accountId: 'default', type: 'cookie', data: { session: originalSession }, status: 'active',
    });

    const res = await app.request('/csdn?accountId=default');
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.platform).toBe('csdn');
    expect(json.data.data.session).not.toBe(originalSession);
    // 行为断言：验证脱敏行为而非具体星号数量
    expectMasked(json.data.data.session, originalSession);
  });

  it('GET /:platform - should return 404 for a non-existent credential', async () => {
    const res = await app.request('/nonexistent-platform');
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.success).toBe(false);
    expect(json.error).toBeDefined('error message should be provided for missing credentials');
  });

  it('POST /:platform/validate - should validate existing credentials successfully', async () => {
    dbAccess.credentials.upsertCredential('juejin', {
      platform: 'juejin', accountId: 'default', type: 'token', data: { token: 'some-token-value' }, status: 'active',
    });

    const res = await app.request('/juejin/validate', { method: 'POST' });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.valid).toBe(true);
    expect(json.data.status).toBe('active');
    expect(json.data.lastValidatedAt).toBeDefined('validation timestamp should be recorded');
  });

  it('POST /:platform/validate - should return 404 for a non-existent credential', async () => {
    const res = await app.request('/nonexistent-platform/validate', { method: 'POST' });
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.success).toBe(false, 'validating a non-existent credential should fail');
  });

  it('DELETE /:platform - should delete credentials and confirm deletion', async () => {
    dbAccess.credentials.upsertCredential('bilibili', {
      platform: 'bilibili', accountId: 'default', type: 'cookie', data: { session: 'bili-session' }, status: 'active',
    });

    const res = await app.request('/bilibili', { method: 'DELETE' });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.deleted).toBe(true);

    // Credential should no longer be retrievable
    const getRes = await app.request('/bilibili');
    expect(getRes.status).toBe(404, 'deleted credential should return 404 on subsequent GET');
  });
});
