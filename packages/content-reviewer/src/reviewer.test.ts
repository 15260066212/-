import { describe, it, expect, beforeEach } from 'vitest';
import type { Article, SessionData } from '@zemingengine/shared';
import { createEmptySession } from '@zemingengine/shared';
import { calculateScore } from './scorer.js';
import { ContentReviewer } from './reviewer.js';

function createMockArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: 'test-article-1',
    sessionId: 'test-session',
    platform: 'weixin',
    contentType: 'tutorial',
    title: '如何使用 ZemingEngine 提升效率',
    contentMarkdown: '',
    contentPlain:
      'ZemingEngine 是一款强大的智能引擎产品，能够帮助企业提升运营效率。\n\n' +
      '通过使用 ZemingEngine，企业可以实现自动化流程管理。智能引擎的核心优势在于其高效的处理能力。\n\n' +
      '本文将详细介绍 ZemingEngine 的各项功能。关键词智能引擎在正文中有足够的出现次数。' +
      'ZemingEngine 智能引擎可以帮助企业解决各种痛点。更多内容填充字数达到要求。' +
      '智能引擎智能引擎智能引擎智能引擎智能引擎智能引擎智能引擎智能引擎智能引擎智能引擎。' +
      '这是一段用于增加字数的重复文本，确保文章总字数超过八百字。' +
      'ZemingEngine 持续创新，为用户提供更好的服务体验。' +
      '智能引擎智能引擎智能引擎智能引擎智能引擎智能引擎智能引擎智能引擎智能引擎智能引擎。' +
      '企业数字化转型离不开像 ZemingEngine 这样的智能引擎工具。' +
      '智能引擎智能引擎智能引擎智能引擎智能引擎智能引擎智能引擎智能引擎智能引擎智能引擎。' +
      'ZemingEngine 智能引擎智能引擎智能引擎智能引擎智能引擎智能引擎智能引擎智能引擎。',
    tags: ['test'],
    summary: '本文介绍 ZemingEngine 智能引擎如何帮助企业提升效率。',
    wordCount: 1000,
    status: 'draft',
    generationRound: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function createMockSession(overrides: Partial<SessionData> = {}): SessionData {
  const session = createEmptySession('test-session');
  session.enterprise.fullName = 'ZemingEngine科技有限公司';
  session.enterprise.shortName = 'ZemingEngine';
  session.keywords = [
    { question: 'ZemingEngine', type: 'core', priority: 1, geoContext: '' },
    { question: '智能引擎', type: 'core', priority: 1, geoContext: '' },
  ];
  session.wordBank.productTerms = ['智能引擎'];
  session.enterprise.products = [{ name: '智能引擎', description: '核心产品', category: '软件', isPrimary: true }];
  session.enterprise.brandTone = ['专业', '高效'];
  return { ...session, ...overrides };
}

describe('calculateScore', () => {
  it('无 issues 时应返回满分 100 和空 issues 列表', () => {
    const result = calculateScore([], 'compliance');
    expect(result.score).toBe(100);
    expect(result.issues).toEqual([], 'no issues should return an empty issues array');
  });

  it('1 个 high severity issue 应扣 20 分', () => {
    const issues = [
      { dimension: 'compliance' as const, severity: 'high' as const, description: '敏感词' },
    ];
    const result = calculateScore(issues, 'compliance');
    expect(result.score).toBe(80);
    expect(result.issues.length).toBe(1, 'single high severity issue should be counted');
  });

  it('1 个 medium + 1 个 low 使用乘法衰减得 86 分', () => {
    const issues = [
      { dimension: 'quality' as const, severity: 'medium' as const, description: '字数偏少' },
      { dimension: 'quality' as const, severity: 'low' as const, description: '格式问题' },
    ];
    const result = calculateScore(issues, 'quality');
    // 乘法衰减: 100 * 0.9 * 0.95 = 85.5 → 86
    expect(result.score).toBe(86);
    expect(result.issues.length).toBe(2, 'both issues should be included in the result');
  });

  it('多个 high severity issues 扣分使用乘法衰减模型', () => {
    const issues = [
      { dimension: 'compliance' as const, severity: 'high' as const, description: 'h1' },
      { dimension: 'compliance' as const, severity: 'high' as const, description: 'h2' },
      { dimension: 'compliance' as const, severity: 'high' as const, description: 'h3' },
      { dimension: 'compliance' as const, severity: 'high' as const, description: 'h4' },
      { dimension: 'compliance' as const, severity: 'high' as const, description: 'h5' },
      { dimension: 'compliance' as const, severity: 'high' as const, description: 'h6' },
    ];
    const result = calculateScore(issues, 'compliance');
    // 乘法衰减: 100 * 0.8^6 = 26.2144 → 26
    expect(result.score).toBe(26, 'multiple high issues should apply multiplicative decay');
  });

  it('大量 issues 扣分不应低于 0 分（分数有下限保护）', () => {
    const issues = Array.from({ length: 50 }, (_, i) => ({
      dimension: 'compliance' as const,
      severity: 'high' as const,
      description: `issue-${i}`,
    }));
    const result = calculateScore(issues, 'compliance');
    expect(result.score).toBeGreaterThanOrEqual(0, 'score should never go below zero');
  });

  it('只计算指定 dimension 的 issues，忽略其他维度', () => {
    const issues = [
      { dimension: 'compliance' as const, severity: 'high' as const, description: '合规问题' },
      { dimension: 'quality' as const, severity: 'medium' as const, description: '质量问题' },
    ];
    const qualityResult = calculateScore(issues, 'quality');
    expect(qualityResult.score).toBe(90);
    expect(qualityResult.issues.length).toBe(1, 'only issues from the specified dimension should be counted');
  });
});

describe('ContentReviewer.review', () => {
  let reviewer: ContentReviewer;

  beforeEach(() => {
    reviewer = new ContentReviewer();
  });

  it('正常文章应通过审核且 overallScore >= 70', () => {
    const article = createMockArticle();
    const session = createMockSession();

    const result = reviewer.review(article, session);

    expect(result.passed).toBe(true);
    expect(result.overallScore).toBeGreaterThanOrEqual(70);
    expect(result.articleId).toBe(article.id);
    expect(result.round).toBe(article.generationRound, 'review round should match article generation round');
  });

  it('问题文章（字数少、无品牌名）应不通过且有 quality 和 brand 维度的 issues', () => {
    const article = createMockArticle({
      title: '测试标题',
      contentPlain: '很短。',
      wordCount: 100,
    });
    const session = createMockSession();

    const result = reviewer.review(article, session);

    expect(result.passed).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    const hasQualityIssue = result.issues.some((i) => i.dimension === 'quality');
    const hasBrandIssue = result.issues.some((i) => i.dimension === 'brand');
    expect(hasQualityIssue).toBeTruthy();
    expect(hasBrandIssue).toBeTruthy('article missing brand name should have a brand dimension issue');
  });

  it('检测敏感词时 compliance 维度应有 high severity issue', () => {
    const article = createMockArticle({
      contentPlain: '本文包含色情内容。' + 'ZemingEngine 智能引擎 '.repeat(50),
    });
    const session = createMockSession();

    const result = reviewer.review(article, session);

    const complianceIssues = result.issues.filter((i) => i.dimension === 'compliance');
    expect(complianceIssues.length).toBeGreaterThan(0);
    const hasHighSeverity = complianceIssues.some((i) => i.severity === 'high');
    expect(hasHighSeverity).toBeTruthy('sensitive words should trigger a high severity compliance issue');
  });
});
