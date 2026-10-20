import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DB } from '../db.js';
import { DatabaseAccess } from '../db.js';
import { createTestDatabase } from '../test-helpers.js';
import { createAuthRoutes } from './auth.js';

let db: DB;
let dbAccess: DatabaseAccess;

beforeEach(() => {
  ({ db, dbAccess } = createTestDatabase());
});

afterEach(() => {
  db.close();
});

function jsonReq(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

describe('Auth Routes', () => {
  let app: ReturnType<typeof createAuthRoutes>;

  beforeEach(() => {
    app = createAuthRoutes(dbAccess);
  });

  describe('POST /login', () => {
    it('缺少用户名时应返回400', async () => {
      const res = await app.request('/login', jsonReq('POST', { username: '', password: '123' }));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('不能为空');
    });

    it('缺少密码时应返回400', async () => {
      const res = await app.request('/login', jsonReq('POST', { username: 'admin', password: '' }));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('不能为空');
    });

    it('不存在的用户应返回401', async () => {
      const res = await app.request('/login', jsonReq('POST', { username: 'nobody', password: '123' }));
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('账号或密码错误');
    });

    it('密码错误应返回401', async () => {
      dbAccess.users.createUser({
        username: 'testuser',
        passwordHash: '0'.repeat(64),
        displayName: 'Test',
        role: 'admin',
      });
      const res = await app.request('/login', jsonReq('POST', { username: 'testuser', password: 'wrong' }));
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.success).toBe(false);
    });

    it('正确凭证应返回用户信息', async () => {
      const { createHash } = await import('node:crypto');
      const hash = createHash('sha256').update('correctpass').digest('hex');
      dbAccess.users.createUser({
        username: 'admin',
        passwordHash: hash,
        displayName: '管理员',
        role: 'admin',
      });
      const res = await app.request('/login', jsonReq('POST', { username: 'admin', password: 'correctpass' }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.username).toBe('admin');
      expect(data.data.role).toBe('admin');
      expect(data.data.apiKey).toBeDefined();
    });
  });

  describe('POST /logout', () => {
    it('登出应返回成功', async () => {
      const res = await app.request('/logout', { method: 'POST' });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
    });
  });
});
