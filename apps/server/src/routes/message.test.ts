import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DB } from '../db.js';
import { DatabaseAccess } from '../db.js';
import { createTestDatabase } from '../test-helpers.js';
import { createMessageRoutes } from './message.js';
import { createEmptySession } from '@zemingengine/shared';

let db: DB;
let dbAccess: DatabaseAccess;

beforeEach(() => {
  ({ db, dbAccess } = createTestDatabase();
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

const validProfileRequest = {
  fullName: '测试企业有限公司',
  shortName: '测试企业',
  description: '专注于测试领域的企业',
  scale: '50-100人',
  location: '北京',
  website: 'https://example.com',
  foundedYear: '2020',
  phone: '010-12345678',
  email: 'test@example.com',
  address: '北京市朝阳区测试路1号',
  productsText: '测试产品A\n测试产品B',
  brandStory: '从2020年创立至今，致力于提供优质服务',
  trustAnchorsText: 'ISO认证\n专利证书',
  brandToneText: '专业、可靠',
  userPainPointsText: '效率低\n成本高',
};

describe('Message Routes', () => {
  let app: ReturnType<typeof createMessageRoutes>;
  let sessionId: string;

  beforeEach(() => {
    sessionId = dbAccess.sessions.createSession('test-user');
    app = createMessageRoutes(dbAccess);
  });

  describe('POST /:id/profile-review', () => {
    it('session不存在应返回404', async () => {
      const res = await app.request('/nonexistent/profile-review', jsonReq('POST', validProfileRequest));
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.success).toBe(false);
    });

    it('有效的企业配置应保存全部字段', async () => {
      const res = await app.request(`/${sessionId}/profile-review`, jsonReq('POST', validProfileRequest));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);

      const entry = dbAccess.sessions.getSessionEntry(sessionId);
      const enterprise = entry?.engine.getSession().enterprise;
      expect(enterprise?.fullName).toBe('测试企业有限公司');
      expect(enterprise?.shortName).toBe('测试企业');
      expect(enterprise?.foundedYear).toBe('2020');
      expect(enterprise?.phone).toBe('010-12345678');
      expect(enterprise?.email).toBe('test@example.com');
      expect(enterprise?.address).toBe('北京市朝阳区测试路1号');
      expect(enterprise?.brandTone).toContain('专业');
      expect(enterprise?.userPainPoints).toContain('效率低');
      expect(enterprise?.products).toHaveLength(2);
      expect(enterprise?.products[0].isPrimary).toBe(true);
    });

    it('不含可选字段时应保留旧值', async () => {
      await app.request(`/${sessionId}/profile-review`, jsonReq('POST', validProfileRequest));

      const partialRequest = { ...validProfileRequest };
      delete (partialRequest as any).foundedYear;
      delete (partialRequest as any).brandToneText;
      delete (partialRequest as any).userPainPointsText;

      const res = await app.request(`/${sessionId}/profile-review`, jsonReq('POST', partialRequest));
      expect(res.status).toBe(200);

      const entry = dbAccess.sessions.getSessionEntry(sessionId);
      const enterprise = entry?.engine.getSession().enterprise;
      expect(enterprise?.foundedYear).toBe('2020');
      expect(enterprise?.brandTone).toContain('专业');
      expect(enterprise?.userPainPoints).toContain('效率低');
    });
  });
});
