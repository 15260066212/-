import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DB } from '../db.js';
import { DatabaseAccess } from '../db.js';
import { createTestDatabase } from '../test-helpers.js';
import { createMessageRoutes } from './message.js';
import { createSession } from '../session-store.js';

const HTTP_STATUS_OK = 200;
const HTTP_STATUS_NOT_FOUND = 404;

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
  enterpriseIntro: '公司成立于2020年，专注测试行业',
  teamStrength: '核心团队来自头部企业',
  serviceAdvantages: '7x24小时响应',
  businessPhilosophy: '客户第一',
  caseStudiesText: '客户A：效率提升30%\n客户B：成本下降20%',
  caseEntryStandard: '需提供可验证数据',
  caseIndustriesText: '制造业、零售业',
  avoidKeywordsText: '最、第一、绝对',
  productDetails: [
    {
      name: '测试产品A',
      alias: 'A系列',
      spec: '标准版',
      price: '2999元/年',
      advantages: '性能提升50%',
      scenarios: '适用于中大型企业',
    },
    { name: '  ' },
    { name: '' },
  ],
};

describe('Message Routes', () => {
  let db: DB;
  let dbAccess: DatabaseAccess;
  let app: ReturnType<typeof createMessageRoutes>;
  let sessionId: string;

  beforeEach(() => {
    ({ db, dbAccess } = createTestDatabase());
    const entry = createSession(dbAccess, 'test-user');
    sessionId = entry.data.id;
    app = createMessageRoutes(dbAccess);
  });

  afterEach(() => {
    db.close();
  });

  describe('POST /:id/profile-review', () => {
    it('session不存在应返回404', async () => {
      const res = await app.request('/nonexistent/profile-review', jsonReq('POST', validProfileRequest));
      expect(res.status).toBe(HTTP_STATUS_NOT_FOUND);
      const data = await res.json();
      expect(data.success).toBe(false);
    });

    it('应返回成功响应结构', async () => {
      const res = await app.request(`/${sessionId}/profile-review`, jsonReq('POST', validProfileRequest));
      expect(res.status).toBe(HTTP_STATUS_OK);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.sessionData).toBeDefined();
      expect(data.data.messages).toBeDefined();
      expect(Array.isArray(data.data.messages)).toBe(true);
    });

    it('应保存企业基本信息（名称、成立年份）', async () => {
      const res = await app.request(`/${sessionId}/profile-review`, jsonReq('POST', validProfileRequest));
      const data = await res.json();
      const enterprise = data.data.sessionData.enterprise;

      expect(enterprise.fullName).toBe('测试企业有限公司');
      expect(enterprise.shortName).toBe('测试企业');
      expect(enterprise.foundedYear).toBe('2020');
    });

    it('应保存企业联系信息（电话、邮箱、地址）', async () => {
      const res = await app.request(`/${sessionId}/profile-review`, jsonReq('POST', validProfileRequest));
      const data = await res.json();
      const enterprise = data.data.sessionData.enterprise;

      expect(enterprise.phone).toBe('010-12345678');
      expect(enterprise.email).toBe('test@example.com');
      expect(enterprise.address).toBe('北京市朝阳区测试路1号');
    });

    it('应保存品牌调性和用户痛点', async () => {
      const res = await app.request(`/${sessionId}/profile-review`, jsonReq('POST', validProfileRequest));
      const data = await res.json();
      const enterprise = data.data.sessionData.enterprise;

      expect(enterprise.brandTone).toContain('专业');
      expect(enterprise.userPainPoints).toContain('效率低');
    });

    it('应保存产品列表并设置主产品', async () => {
      const res = await app.request(`/${sessionId}/profile-review`, jsonReq('POST', validProfileRequest));
      const data = await res.json();
      const enterprise = data.data.sessionData.enterprise;

      expect(enterprise.products).toHaveLength(2);
      expect(enterprise.products[0].isPrimary).toBe(true);
    });

    it('应保存新客户录入表扩展字段（公司介绍/合作案例/产品详细解读/规避清单）', async () => {
      const res = await app.request(`/${sessionId}/profile-review`, jsonReq('POST', validProfileRequest));
      const data = await res.json();
      const enterprise = data.data.sessionData.enterprise;

      expect(enterprise.enterpriseIntro).toBe('公司成立于2020年，专注测试行业');
      expect(enterprise.teamStrength).toBe('核心团队来自头部企业');
      expect(enterprise.serviceAdvantages).toBe('7x24小时响应');
      expect(enterprise.businessPhilosophy).toBe('客户第一');
      expect(enterprise.caseStudies).toEqual(['客户A：效率提升30%', '客户B：成本下降20%']);
      expect(enterprise.caseEntryStandard).toBe('需提供可验证数据');
      expect(enterprise.caseIndustries).toEqual(['制造业', '零售业']);
      expect(enterprise.avoidKeywords).toEqual(['最', '第一', '绝对']);
      // 空行/纯空格的产品条目应被过滤，只保留有效产品
      expect(enterprise.productDetails).toHaveLength(1);
      expect(enterprise.productDetails[0]).toMatchObject({
        name: '测试产品A',
        alias: 'A系列',
        spec: '标准版',
        price: '2999元/年',
        advantages: '性能提升50%',
        scenarios: '适用于中大型企业',
      });
    });

    it('不含可选字段时应保留旧值', async () => {
      await app.request(`/${sessionId}/profile-review`, jsonReq('POST', validProfileRequest));

      const partialRequest = { ...validProfileRequest };
      delete (partialRequest as any).foundedYear;
      delete (partialRequest as any).brandToneText;
      delete (partialRequest as any).userPainPointsText;

      const res = await app.request(`/${sessionId}/profile-review`, jsonReq('POST', partialRequest));
      expect(res.status).toBe(HTTP_STATUS_OK);

      const data = await res.json();
      const enterprise = data.data.sessionData.enterprise;
      expect(enterprise.foundedYear).toBe('2020');
      expect(enterprise.brandTone).toContain('专业');
      expect(enterprise.userPainPoints).toContain('效率低');
    });
  });
});
