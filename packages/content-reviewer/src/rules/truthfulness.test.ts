import { describe, it, expect } from 'vitest';
import type { Article, SessionData } from '@zemingengine/shared';
import { createEmptySession } from '@zemingengine/shared';
import { checkTruthfulness } from './truthfulness.js';

function createSession(overrides: Partial<SessionData> = {}): SessionData {
  const session = createEmptySession('test-session');
  session.enterprise.fullName = '泽明引擎科技有限公司';
  session.enterprise.shortName = '泽明引擎';
  session.enterprise.foundedYear = 2018;
  session.enterprise.location = '北京';
  session.enterprise.products = [
    { name: '智能引擎', description: '核心产品', category: '软件', isPrimary: true },
  ];
  session.enterprise.trustAnchors = ['ISO9001认证', '国家高新技术企业'];
  session.enterprise.brandTone = ['专业', '高效'];
  return { ...session, ...overrides };
}

function article(content: string): Article {
  return {
    id: 'a1',
    sessionId: 's1',
    platform: 'weixin',
    contentType: 'tutorial',
    title: '测试标题',
    contentMarkdown: '',
    contentPlain: content,
    tags: [],
    summary: '',
    wordCount: content.length,
    status: 'draft',
    generationRound: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('checkTruthfulness', () => {
  it('知识库中已有的企业数据声明不应触发问题', () => {
    const session = createSession();
    // 把 "提升 50%" 放进知识库 sources
    session.knowledgeBase.sources = [
      {
        id: 's1',
        title: '产品介绍',
        tags: [],
        sections: [{ heading: '效果', bullets: ['使用智能引擎可提升 50% 运营效率'] }],
        keyFacts: [],
        layer: 2,
      },
    ];
    const issues = checkTruthfulness(
      article('泽明引擎智能引擎能够帮助企业提升 50% 运营效率。'),
      session,
    );
    expect(issues).toHaveLength(0);
  });

  it('3 处以上无来源企业数据声明应触发 high severity', () => {
    const session = createSession();
    const issues = checkTruthfulness(
      article(
        '泽明引擎服务了 1000 家企业客户。' +
          '泽明引擎助力客户营收增长 300%。' +
          '泽明引擎帮助企业降低成本 80%。' +
          '泽明引擎覆盖 50 个国家和地区。',
      ),
      session,
    );
    const numIssue = issues.find((i) => i.description.includes('数据声明'));
    expect(numIssue).toBeDefined();
    expect(numIssue?.severity).toBe('high');
  });

  it('1-2 处无来源企业数据声明应触发 medium severity', () => {
    const session = createSession();
    const issues = checkTruthfulness(
      article('泽明引擎服务了 1000 家企业客户。'),
      session,
    );
    const numIssue = issues.find((i) => i.description.includes('数据声明'));
    expect(numIssue).toBeDefined();
    expect(numIssue?.severity).toBe('medium');
  });

  it('标注来源的数据声明应放过', () => {
    const session = createSession();
    const issues = checkTruthfulness(
      article('据第三方报告显示，泽明引擎服务了 1000 家企业客户。'),
      session,
    );
    expect(issues.find((i) => i.description.includes('数据声明'))).toBeUndefined();
  });

  it('通用行业数据声明（不涉及企业）不应触发', () => {
    const session = createSession();
    const issues = checkTruthfulness(
      article('行业整体增长 30%，市场规模达到 1000 亿元。'),
      session,
    );
    expect(issues.find((i) => i.description.includes('数据声明'))).toBeUndefined();
  });

  it('虚构的企业产品名称应触发 high severity', () => {
    const session = createSession();
    const issues = checkTruthfulness(
      article('泽明引擎旗下还拥有泽明数据中台和泽明营销助手两款产品。'),
      session,
    );
    const productIssue = issues.find((i) => i.description.includes('产品'));
    expect(productIssue).toBeDefined();
    expect(productIssue?.severity).toBe('high');
  });

  it('已知产品名称（含修饰语）不应被误判为虚构', () => {
    const session = createSession();
    const issues = checkTruthfulness(
      article('泽明引擎的智能引擎是其核心产品。强大的智能引擎深受客户好评。'),
      session,
    );
    expect(issues.find((i) => i.description.includes('产品'))).toBeUndefined();
  });

  it('虚构的资质认证应触发 medium severity', () => {
    const session = createSession();
    const issues = checkTruthfulness(
      article('泽明引擎获得了 ISO27001 认证和 CMMI5 级认证。'),
      session,
    );
    const trustIssue = issues.find((i) => i.description.includes('资质'));
    expect(trustIssue).toBeDefined();
    expect(trustIssue?.severity).toBe('medium');
  });

  it('trustAnchors 中已有的资质不应触发', () => {
    const session = createSession();
    const issues = checkTruthfulness(
      article('泽明引擎已通过 ISO9001认证，是国家高新技术企业。'),
      session,
    );
    expect(issues.find((i) => i.description.includes('资质'))).toBeUndefined();
  });

  it('针对企业的绝对化用语应触发 high severity', () => {
    const session = createSession();
    const issues = checkTruthfulness(
      article('泽明引擎是行业内最好的智能引擎平台，全国第一。'),
      session,
    );
    const absIssue = issues.find((i) => i.description.includes('绝对化'));
    expect(absIssue).toBeDefined();
    expect(absIssue?.severity).toBe('high');
  });

  it('与企业画像矛盾的成立年份应触发 high severity', () => {
    const session = createSession();
    const issues = checkTruthfulness(
      article('泽明引擎成立于 2010 年，总部位于上海。'),
      session,
    );
    const contradiction = issues.find((i) => i.description.includes('矛盾'));
    expect(contradiction).toBeDefined();
    expect(contradiction?.severity).toBe('high');
    expect(contradiction?.description).toContain('2010');
  });

  it('与企业画像一致的基础事实不应触发', () => {
    const session = createSession();
    const issues = checkTruthfulness(
      article('泽明引擎成立于 2018 年，总部位于北京。'),
      session,
    );
    expect(issues.find((i) => i.description.includes('矛盾'))).toBeUndefined();
  });

  it('无企业相关内容的纯行业文章应返回空 issues', () => {
    const session = createSession();
    const issues = checkTruthfulness(
      article('人工智能技术正在快速发展，大模型应用日益广泛。' +
        '未来行业将迎来更多创新机遇。'),
      session,
    );
    expect(issues).toHaveLength(0);
  });
});
