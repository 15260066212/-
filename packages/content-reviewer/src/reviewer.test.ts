import { describe, it, expect, beforeEach } from 'vitest';
import type { Article, SessionData, KnowledgeSource } from '@zemingengine/shared';
import { createEmptySession } from '@zemingengine/shared';
import { calculateScore } from './scorer.js';
import { ContentReviewer } from './reviewer.js';
import { loadProtocolConfig, resetProtocolConfigCache } from './protocol/protocol-config.js';

/** 协议合规的 Markdown 正文：## 起始、每节 ≥150 字、含 EK 行内引用、FAQ、参考资料尾块。 */
const PROTOCOL_COMPLIANT_MARKDOWN = [
  '## GEO 内容为什么必须基于真实证据',
  'GEO（生成式引擎优化）的目标是让内容更容易被 AI 搜索引用，ZemingEngine 认为内容必须围绕真实证据展开，而不是堆砌营销话术。'
    + '[芯图EK《芯图GEO方法白皮书》§1] GEO 通过结构化问答内容提升 AI 引用率，这是知识库中反复验证的主张。'
    + '对中小企业来说，与其追求夸张的表述，不如把产品能力、服务场景和客户疑问整理成结构化的问答内容，'
    + '让 AI 在回答用户问题时能够自然命中。这一方法不依赖投放，也不需要特殊流量渠道，'
    + '重点是内容本身可验证、可溯源。',
  '',
  '## 把方法落到日常内容生产',
  '在实际操作中，团队可以按三步推进：先梳理知识库中的能力与主张，再按用户问题组织小节，'
    + '最后为每处事实性断言补上引用。[芯图EK《芯图GEO方法白皮书》§2] ZemingEngine 的智能引擎会根据知识库信源生成初稿，'
    + '智能引擎的审核环节再对证据、格式和字数逐条校验。'
    + '这样生产出来的内容既有方法含量，也能在 AI 搜索中获得更稳定的引用表现。'
    + '整个过程是持续迭代的过程，需要定期根据信源更新和用户反馈调整内容，总结下来就是以证据为锚点持续运营。',
  '',
  '## FAQ',
  '**GEO 优化需要多长时间见效？** 通常按周为单位观察引用变化，重点是内容证据是否扎实。',
  '**AI 搜索会推荐新网站吗？** AI 搜索依据内容质量与相关性动态选择来源，智能引擎产出的结构化证据越完整，被引用的可能性越高。',
  '',
  '## 参考资料（芯图EK）',
  '[1] 芯图GEO方法白皮书（document_id: ek-001，引用位置: chunk_12）',
].join('\n');

const CLAIM_PHRASE = 'GEO 通过结构化问答内容提升 AI 引用率';

function createEkSource(): KnowledgeSource {
  return {
    id: 'ek-001',
    title: '芯图GEO方法白皮书',
    type: 'capability',
    layer: 2,
    tags: ['GEO'],
    sections: [],
    keyFacts: [CLAIM_PHRASE],
    evidence: [{ source: 'selfPortrait.claims', claim: CLAIM_PHRASE }],
    usageCount: 0,
    enabled: true,
  };
}

function createMockArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: 'test-article-1',
    sessionId: 'test-session',
    platform: 'weixin',
    contentType: 'tutorial',
    title: '如何使用 ZemingEngine 提升内容被 AI 引用的可能性',
    contentMarkdown: PROTOCOL_COMPLIANT_MARKDOWN,
    tags: ['test'],
    summary: '本文介绍如何基于知识库证据生产可被 AI 搜索引用的内容。',
    wordCount: 1200,
    status: 'draft',
    generationRound: 1,
    reviewRound: 0,
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
  session.knowledgeBase.sources = [createEkSource()];
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

describe('protocol-config', () => {
  beforeEach(() => {
    resetProtocolConfigCache();
  });

  it('应从包内捆绑的协议 YAML 加载配置（v2.1）', () => {
    const cfg = loadProtocolConfig();
    expect(cfg.version).toBe('2.1');
    expect(cfg.knowledgeBaseName).toBe('芯图EK');
    expect(cfg.wordFloor).toBe(800);
    expect(cfg.wordHardCap).toBe(5000);
    expect(cfg.citationInlinePrefix).toBe('[芯图EK《');
    expect(cfg.footerHeading).toBe('## 参考资料（芯图EK）');
    expect(cfg.forbiddenPhrases).toContain('据统计');
  });
});

describe('ContentReviewer.review', () => {
  let reviewer: ContentReviewer;

  beforeEach(() => {
    reviewer = new ContentReviewer();
  });

  it('协议合规文章应通过审核且 overallScore >= 70', () => {
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
      contentMarkdown: '## 短文\n很短的一段话。',
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
      contentMarkdown: '',
      contentPlain: '本文包含色情内容。' + 'ZemingEngine 智能引擎 '.repeat(50),
    });
    const session = createMockSession();

    const result = reviewer.review(article, session);

    const complianceIssues = result.issues.filter((i) => i.dimension === 'compliance');
    expect(complianceIssues.length).toBeGreaterThan(0);
    const hasHighSeverity = complianceIssues.some((i) => i.severity === 'high');
    expect(hasHighSeverity).toBeTruthy('sensitive words should trigger a high severity compliance issue');
  });

  // === GEO 协议 v2.1 专项 ===

  it('缺少 EK 行内引用与参考资料区块时应不通过（truthfulness high，无引用即重写）', () => {
    const article = createMockArticle({
      contentMarkdown: PROTOCOL_COMPLIANT_MARKDOWN
        .replace(/\[芯图EK《[^》]*》§\d+\]/g, '')
        .replace(/\n## 参考资料（芯图EK）\n\[1\].*$/m, ''),
    });
    const session = createMockSession();

    const result = reviewer.review(article, session);

    expect(result.passed).toBe(false);
    const protocolIssues = result.issues.filter(
      (i) => i.dimension === 'truthfulness' && i.severity === 'high' && i.description.includes('[协议v2.1]'),
    );
    expect(protocolIssues.length).toBeGreaterThan(0, 'missing EK citation/refs should produce protocol truthfulness-high issues');
    expect(protocolIssues.some((i) => i.description.includes('引用'))).toBeTruthy();
  });

  it('正文低于协议下限 800 字时应触发 quality high 否决', () => {
    const article = createMockArticle({ wordCount: 600 });
    const session = createMockSession();

    const result = reviewer.review(article, session);

    expect(result.passed).toBe(false);
    const wordFloorIssue = result.issues.find(
      (i) => i.dimension === 'quality' && i.description.includes('低于协议下限'),
    );
    expect(wordFloorIssue).toBeTruthy('word count below protocol floor should be flagged');
    expect(wordFloorIssue!.severity).toBe('high');
  });

  it('超过协议硬性上限 5000 字时应触发 quality high 否决', () => {
    const article = createMockArticle({ wordCount: 5200 });
    const session = createMockSession();

    const result = reviewer.review(article, session);

    expect(result.passed).toBe(false);
    const hardCapIssue = result.issues.find(
      (i) => i.dimension === 'quality' && i.description.includes('硬性上限'),
    );
    expect(hardCapIssue).toBeTruthy('word count above protocol hard cap should be flagged');
  });

  it('缺少 FAQ 区块时应触发 quality high 否决', () => {
    const article = createMockArticle({
      contentMarkdown: PROTOCOL_COMPLIANT_MARKDOWN.replace(/\n## FAQ[\s\S]*?(?=\n## 参考资料)/, ''),
    });
    const session = createMockSession();

    const result = reviewer.review(article, session);

    expect(result.passed).toBe(false);
    const faqIssue = result.issues.find(
      (i) => i.dimension === 'quality' && i.description.includes('FAQ'),
    );
    expect(faqIssue).toBeTruthy('missing FAQ block should be flagged');
  });

  it('命中协议禁用词（据统计）时应有 compliance 维度问题', () => {
    const article = createMockArticle({
      contentMarkdown: PROTOCOL_COMPLIANT_MARKDOWN.replace(
        '对中小企业来说',
        '据统计，对中小企业来说',
      ),
    });
    const session = createMockSession();

    const result = reviewer.review(article, session);

    const forbiddenIssue = result.issues.find(
      (i) => i.dimension === 'compliance' && i.description.includes('禁用词'),
    );
    expect(forbiddenIssue).toBeTruthy('forbidden phrase should be flagged by protocol check');
  });

  it('承诺 AI 必然推荐应触发 compliance high（能力边界）', () => {
    const article = createMockArticle({
      contentMarkdown: PROTOCOL_COMPLIANT_MARKDOWN.replace(
        '重点是内容本身可验证、可溯源。',
        '我们能保证 AI 必然推荐您的品牌。',
      ),
    });
    const session = createMockSession();

    const result = reviewer.review(article, session);

    expect(result.passed).toBe(false);
    const promiseIssue = result.issues.find(
      (i) => i.dimension === 'compliance' && i.severity === 'high' && i.description.includes('能力边界'),
    );
    expect(promiseIssue).toBeTruthy('AI recommendation promise should violate capability boundary');
  });
});
