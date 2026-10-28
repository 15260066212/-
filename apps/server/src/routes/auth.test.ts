import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DB } from '../db.js';
import { DatabaseAccess } from '../db.js';
import { createTestDatabase } from '../test-helpers.js';
import { createAuthRoutes } from './auth.js';

const HTTP_STATUS_OK = 200;
const HTTP_STATUS_BAD_REQUEST = 400;
const HTTP_STATUS_UNAUTHORIZED = 401;

function jsonReq(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

describe('Auth Routes', () => {
  let db: DB;
  let dbAccess: DatabaseAccess;
  let app: ReturnType<typeof createAuthRoutes>;

  beforeEach(() => {
    ({ db, dbAccess } = createTestDatabase());
    app = createAuthRoutes(dbAccess);
  });

  afterEach(() => {
    db.close();
  });

  describe('POST /login', () => {
    it('缺少用户名时应返回400', async () => {
      const res = await app.request('/login', jsonReq('POST', { username: '', password: '123' }));
      expect(res.status).toBe(HTTP_STATUS_BAD_REQUEST, 'should set status to expected value for 缺少用户名时应返回400');
      const data = await res.json();
      expect(data.success).toBe(false, 'should return false when 缺少用户名时应返回400');
      expect(data.error).toContain('不能为空', 'should contain expected value in error for 缺少用户名时应返回400');
    });

    it('缺少密码时应返回400', async () => {
      const res = await app.request('/login', jsonReq('POST', { username: 'admin', password: '' }));
      expect(res.status).toBe(HTTP_STATUS_BAD_REQUEST, 'should set status to expected value for 缺少密码时应返回400');
      const data = await res.json();
      expect(data.success).toBe(false, 'should return false when 缺少密码时应返回400');
      expect(data.error).toContain('不能为空', 'should contain expected value in error for 缺少密码时应返回400');
    });

    it('不存在的用户应返回401', async () => {
      const res = await app.request('/login', jsonReq('POST', { username: 'nobody', password: '123' }));
      expect(res.status).toBe(HTTP_STATUS_UNAUTHORIZED, 'should set status to expected value for 不存在的用户应返回401');
      const data = await res.json();
      expect(data.success).toBe(false, 'should return false when 不存在的用户应返回401');
      expect(data.error).toContain('账号或密码错误', 'should contain expected value in error for 不存在的用户应返回401');
    });

    it('密码错误应返回401', async () => {
      dbAccess.users.insertUser({
        id: 'test-user-1',
        username: 'testuser',
        passwordHash: '0'.repeat(64),
        displayName: 'Test',
        role: 'admin',
        apiKey: 'test-api-key-1',
        createdAt: Date.now(),
      });
      const res = await app.request('/login', jsonReq('POST', { username: 'testuser', password: 'wrong' }));
      expect(res.status).toBe(HTTP_STATUS_UNAUTHORIZED, 'should set status to expected value for 密码错误应返回401');
      const data = await res.json();
      expect(data.success).toBe(false, 'should return false when 密码错误应返回401');
    });

    it('正确凭证应返回用户信息', async () => {
      const { createHash } = await import('node:crypto');
      const hash = createHash('sha256').update('correctpass').digest('hex');
      dbAccess.users.insertUser({
        id: 'admin-user-1',
        username: 'admin',
        passwordHash: hash,
        displayName: '管理员',
        role: 'admin',
        apiKey: 'admin-api-key-1',
        createdAt: Date.now(),
      });
      const res = await app.request('/login', jsonReq('POST', { username: 'admin', password: 'correctpass' }));
      expect(res.status).toBe(HTTP_STATUS_OK, 'should set status to expected value for 正确凭证应返回用户信息');
      const data = await res.json();
      expect(data.success).toBe(true, 'should have correct success flag when 正确凭证应返回用户信息');
      expect(data.data.username).toBe('admin', 'should have correct username when 正确凭证应返回用户信息');
      expect(data.data.role).toBe('admin', 'should have correct role when 正确凭证应返回用户信息');
      expect(data.data.apiKey).toBeDefined('should be defined for 正确凭证应返回用户信息');
    });
  });

  describe('POST /logout', () => {
    it('登出应返回成功', async () => {
      const res = await app.request('/logout', { method: 'POST' });
      expect(res.status).toBe(HTTP_STATUS_OK, 'should have correct status code when 登出应返回成功');
      const data = await res.json();
      expect(data.success).toBe(true, 'should have correct success flag when 登出应返回成功');
    });
  });
});
