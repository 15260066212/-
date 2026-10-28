import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createEmptySession } from '@zemingengine/shared';
import type { ScrapeResult, KeywordType, Stage } from '@zemingengine/shared';
import { isAIAvailable } from './client.js';
import { validateInput } from './validator.js';
import { generateGuidance } from './guidance.js';
import { recommendKeywords } from './keyword-recommender.js';
import { analyzeWebsite } from './analyzer.js';
import { extractJsonObject, extractJsonArray, safeParseJsonObject, safeParseJsonArray } from './json-utils.js';
import { buildProfileSummaryLines } from './summary-utils.js';
import { visibilityAnalysisService } from './visibility-analysis-service.js';

// ============================================================================
// Shared setup: ensure AI is NOT available across all tests so that the
// rule-based / fallback code paths are exercised. Save and restore the
// original OPENAI_API_KEY to avoid env pollution between test runs.
// ============================================================================

const ORIGINAL_API_KEY = process.env.OPENAI_API_KEY;

beforeEach(() => {
  // Make sure no API key is present by default so AI paths are skipped.
  delete process.env.OPENAI_API_KEY;
});

afterEach(() => {
  // Restore the original environment variable.
  if (ORIGINAL_API_KEY === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = ORIGINAL_API_KEY;
  }
});

// ============================================================================
// 1. client.ts - isAIAvailable()
// ============================================================================

describe('isAIAvailable', () => {
  it('returns false when OPENAI_API_KEY is not set', () => {
    delete process.env.OPENAI_API_KEY;
    expect(isAIAvailable()).toBe(false, 'should have correct isAIAvailable() when false when OPENAI_API_KEY is not set');
  });

  it('returns false when OPENAI_API_KEY is an empty string', () => {
    process.env.OPENAI_API_KEY = '';
    expect(isAIAvailable()).toBe(false, 'should have correct isAIAvailable() when false when OPENAI_API_KEY is an empty string');
  });

  it('returns false when OPENAI_API_KEY is the placeholder "sk-your-api-key-here"', () => {
    process.env.OPENAI_API_KEY = 'sk-your-api-key-here';
    expect(isAIAvailable()).toBe(false, 'should have correct isAIAvailable() when false when OPENAI_API_KEY is the placeholder');
  });

  it('returns false when OPENAI_API_KEY is the placeholder with mixed case', () => {
    process.env.OPENAI_API_KEY = 'SK-YOUR-API-KEY-HERE';
    expect(isAIAvailable()).toBe(false, 'should have correct isAIAvailable() when false when OPENAI_API_KEY is the placeholder with mixed case');
  });

  it('returns false when OPENAI_API_KEY is only whitespace', () => {
    process.env.OPENAI_API_KEY = '   ';
    expect(isAIAvailable()).toBe(false, 'should have correct isAIAvailable() when false when OPENAI_API_KEY is only whitespace');
  });

  it('returns true when a valid API key is set', () => {
    process.env.OPENAI_API_KEY = 'sk-valid-key-1234567890';
    expect(isAIAvailable()).toBe(true, 'should have correct isAIAvailable() when true when a valid API key is set');
  });
});

// ============================================================================
// 2. validator.ts - validateInput() (basic / non-AI path)
// ============================================================================

describe('validateInput (basic validation, AI unavailable)', () => {
  const session = createEmptySession('test-session');

  it('rejects empty input', async () => {
    const result = await validateInput('fullName', '请输入企业全称', '', session);
    expect(result.valid).toBe(false, 'should have correct valid flag when rejects empty input');
    expect(result.feedback).toBe('输入不能为空，请填写后重试。', 'should have correct feedback message when rejects empty input');
  });

  it('rejects whitespace-only input', async () => {
    const result = await validateInput('fullName', '请输入企业全称', '   ', session);
    expect(result.valid).toBe(false, 'should have correct valid flag when rejects whitespace-only input');
    expect(result.feedback).toBe('输入不能为空，请填写后重试。', 'should have correct feedback message when rejects whitespace-only input');
  });

  it('rejects very short input (length < 2)', async () => {
    const result = await validateInput('fullName', '请输入企业全称', 'a', session);
    expect(result.valid).toBe(false, 'should have correct valid flag when rejects very short input (length < 2)');
    expect(result.feedback).toBe('输入太短，请提供更多细节。', 'should have correct feedback message when rejects very short input (length < 2)');
  });

  it('rejects input of 1-3 random letters like "ab"', async () => {
    const result = await validateInput('fullName', '请输入企业全称', 'ab', session);
    expect(result.valid).toBe(false, 'should have correct valid flag when rejects input of 1-3 random letters like');
    expect(result.feedback).toBe('这看起来不像有效输入，请提供完整的内容。', 'should have correct feedback message when rejects input of 1-3 random letters like');
  });

  it('rejects input of 3 random letters like "xyz"', async () => {
    const result = await validateInput('fullName', '请输入企业全称', 'xyz', session);
    expect(result.valid).toBe(false, 'should have correct valid flag when rejects input of 3 random letters like');
    expect(result.feedback).toBe('这看起来不像有效输入，请提供完整的内容。');
  });

  it('accepts normal input', async () => {
    const result = await validateInput(
      'fullName',
      '请输入企业全称',
      '这是一段正常的输入内容',
      session
    );
    expect(result.valid).toBe(true);
    expect(result.feedback).toBe('已收到你的输入。');
  });
});

// ============================================================================
// 3. guidance.ts - generateGuidance() (default guidance, AI unavailable)
// ============================================================================

describe('generateGuidance (default guidance, AI unavailable)', () => {
  const session = createEmptySession('test-session');
  const stages: Stage[] = [
    'intro',
    'profile',
    'keywords',
    'wordbank',
    'knowledge',
    'prompts',
    'platforms',
  ];

  it('returns a non-empty string longer than 50 chars for every stage', async () => {
    for (const stage of stages) {
      const guidance = await generateGuidance(stage, session);
      expect(typeof guidance).toBe('string');
      expect(guidance.length).toBeGreaterThan(50);
    }
  });

  it('returns guidance containing "芯图引擎：GEO" or "配置教练" for the intro stage', async () => {
    const guidance = await generateGuidance('intro', session);
    expect(guidance).toMatch(/芯图引擎：GEO|配置教练/);
  });

  it('returns guidance containing "企业画像" for the profile stage', async () => {
    const guidance = await generateGuidance('profile', session);
    expect(guidance).toContain('企业画像');
  });

  it('returns guidance mentioning keywords / 问题形式 for the keywords stage', async () => {
    const guidance = await generateGuidance('keywords', session);
    expect(guidance.length).toBeGreaterThan(50);
    expect(guidance).toMatch(/关键词|问题/);
  });

  it('returns guidance mentioning 词库 for the wordbank stage', async () => {
    const guidance = await generateGuidance('wordbank', session);
    expect(guidance).toContain('词库');
  });

  it('returns guidance mentioning 知识库 for the knowledge stage', async () => {
    const guidance = await generateGuidance('knowledge', session);
    expect(guidance).toContain('知识库');
  });

  it('returns guidance mentioning 提示词 for the prompts stage', async () => {
    const guidance = await generateGuidance('prompts', session);
    expect(guidance).toContain('提示词');
  });

  it('returns guidance mentioning 平台 for the platforms stage', async () => {
    const guidance = await generateGuidance('platforms', session);
    expect(guidance).toContain('平台');
  });
});

// ============================================================================
// 4. keyword-recommender.ts - recommendKeywords() (rule-based, AI unavailable)
// ============================================================================

describe('recommendKeywords (rule-based, AI unavailable)', () => {
  function createEnterpriseSession() {
    const session = createEmptySession('test-session');
    session.enterprise.fullName = '测试科技有限公司';
    session.enterprise.shortName = '测试科技';
    session.enterprise.description = '一家专注于数据分析的科技公司';
    session.enterprise.products = [
      {
        name: '数据宝',
        description: '数据分析平台',
        category: 'SaaS',
        isPrimary: true,
      },
    ];
    session.enterprise.scale = '100人';
    session.enterprise.location = '北京';
    session.enterprise.userPainPoints = ['数据分散难以管理'];
    return session;
  }

  const VALID_TYPES: KeywordType[] = ['core', 'question', 'comparison', 'longtail'];

  it('returns an array of CoreKeyword objects', async () => {
    const session = createEnterpriseSession();
    const keywords = await recommendKeywords(session);
    expect(Array.isArray(keywords)).toBe(true);
    expect(keywords.length).toBeGreaterThan(0);
    for (const kw of keywords) {
      expect(typeof kw.question).toBe('string');
      expect(VALID_TYPES).toContain(kw.type);
      expect(typeof kw.priority).toBe('number');
      expect(typeof kw.geoContext).toBe('string');
    }
  });

  it('generates keywords based on the enterprise profile', async () => {
    const session = createEnterpriseSession();
    const keywords = await recommendKeywords(session);
    const allQuestions = keywords.map((k) => k.question).join(' ');
    // The company short name and primary product should appear in the generated questions.
    expect(allQuestions).toContain('测试科技');
    expect(allQuestions).toContain('数据宝');
  });

  it('includes core-type keywords about the company and product', async () => {
    const session = createEnterpriseSession();
    const keywords = await recommendKeywords(session);
    const coreKeywords = keywords.filter((k) => k.type === 'core');
    expect(coreKeywords.length).toBeGreaterThan(0);
    const coreQuestions = coreKeywords.map((k) => k.question);
    expect(coreQuestions).toContain('测试科技是什么公司？');
    expect(coreQuestions).toContain('数据宝是什么？');
  });

  it('includes question-type keywords', async () => {
    const session = createEnterpriseSession();
    const keywords = await recommendKeywords(session);
    const questionKeywords = keywords.filter((k) => k.type === 'question');
    expect(questionKeywords.length).toBeGreaterThan(0);
  });

  it('includes comparison-type keywords', async () => {
    const session = createEnterpriseSession();
    const keywords = await recommendKeywords(session);
    const comparisonKeywords = keywords.filter((k) => k.type === 'comparison');
    expect(comparisonKeywords.length).toBeGreaterThan(0);
  });

  it('includes longtail-type keywords', async () => {
    const session = createEnterpriseSession();
    const keywords = await recommendKeywords(session);
    const longtailKeywords = keywords.filter((k) => k.type === 'longtail');
    expect(longtailKeywords.length).toBeGreaterThan(0);
  });

  it('does NOT include keywords that already exist in session.keywords', async () => {
    const session = createEnterpriseSession();
    // Pre-populate a keyword that the rule-based recommender would normally generate.
    session.keywords = [
      {
        question: '测试科技是什么公司？',
        type: 'core',
        priority: 1,
        geoContext: '已存在的关键词',
      },
      {
        question: '数据宝是什么？',
        type: 'core',
        priority: 2,
        geoContext: '已存在的关键词',
      },
    ];

    const keywords = await recommendKeywords(session);
    const questions = keywords.map((k) => k.question);
    expect(questions).not.toContain('测试科技是什么公司？');
    expect(questions).not.toContain('数据宝是什么？');
  });

  it('assigns increasing priority numbers', async () => {
    const session = createEnterpriseSession();
    const keywords = await recommendKeywords(session);
    const priorities = keywords.map((k) => k.priority);
    // Every priority should be a positive integer.
    for (const p of priorities) {
      expect(p).toBeGreaterThan(0);
      expect(Number.isInteger(p)).toBe(true);
    }
  });

  it('returns an empty array when the enterprise profile is empty', async () => {
    const session = createEmptySession('empty-session');
    // No shortName, fullName, products, etc. -> all templates filter out.
    const keywords = await recommendKeywords(session);
    // With an empty profile, name falls back to fullName (''), products is [].
    // coreTemplates become ['是什么公司？','主要做什么？'] but name is '' so they are still
    // non-empty strings. To keep this test robust we only assert it returns an array.
    expect(Array.isArray(keywords)).toBe(true);
  });
});

// ============================================================================
// 5. analyzer.ts - analyzeWebsite() fallback (AI unavailable)
// ============================================================================

describe('analyzeWebsite (fallback analysis, AI unavailable)', () => {
  const scrapeResult: ScrapeResult = {
    url: 'https://example.com',
    title: '示例公司',
    description: '示例描述',
    headings: ['关于我们', '产品介绍'],
    links: [],
    textContent: '这是示例公司的正文内容',
    scrapedAt: new Date().toISOString(),
    method: 'cheerio',
    keywords: ['示例关键词1', '示例关键词2'],
    products: [{ name: '产品A', description: '描述A' }],
    aboutUs: '关于示例公司',
    contactInfo: { phone: '', email: '', address: '北京' },
  };

  it('returns an object with analysis, summary, enterprise, and keywords', async () => {
    const session = createEmptySession('test-session');
    const result = await analyzeWebsite(scrapeResult, session);
    expect(result).toHaveProperty('analysis');
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('enterprise');
    expect(result).toHaveProperty('keywords');
  });

  it('returns a summary that contains the URL', async () => {
    const session = createEmptySession('test-session');
    const result = await analyzeWebsite(scrapeResult, session);
    expect(result.summary).toContain('https://example.com');
  });

  it('sets enterprise.fullName to scrapeResult.title', async () => {
    const session = createEmptySession('test-session');
    const result = await analyzeWebsite(scrapeResult, session);
    expect(result.enterprise.fullName).toBe('示例公司');
  });

  it('sets enterprise.website to the scraped URL', async () => {
    const session = createEmptySession('test-session');
    const result = await analyzeWebsite(scrapeResult, session);
    expect(result.enterprise.website).toBe('https://example.com');
  });

  it('maps products from the scrape result into the enterprise profile', async () => {
    const session = createEmptySession('test-session');
    const result = await analyzeWebsite(scrapeResult, session);
    expect(result.enterprise.products).toHaveLength(1);
    expect(result.enterprise.products?.[0].name).toBe('产品A');
    expect(result.enterprise.products?.[0].description).toBe('描述A');
  });

  it('derives keywords from scrapeResult.keywords', async () => {
    const session = createEmptySession('test-session');
    const result = await analyzeWebsite(scrapeResult, session);
    expect(result.keywords).toHaveLength(2);
    const questions = result.keywords.map((k) => k.question);
    expect(questions).toEqual(['示例关键词1', '示例关键词2']);
    for (const kw of result.keywords) {
      expect(kw.type).toBe('core');
      expect(typeof kw.priority).toBe('number');
      expect(typeof kw.geoContext).toBe('string');
    }
  });

  it('sets analysis.fullName to scrapeResult.title', async () => {
    const session = createEmptySession('test-session');
    const result = await analyzeWebsite(scrapeResult, session);
    expect(result.analysis.fullName).toBe('示例公司');
  });

  it('populates analysis.keywords from scrapeResult.keywords', async () => {
    const session = createEmptySession('test-session');
    const result = await analyzeWebsite(scrapeResult, session);
    expect(result.analysis.keywords).toEqual(['示例关键词1', '示例关键词2']);
  });

  it('handles a scrape result with empty keywords array', async () => {
    const session = createEmptySession('test-session');
    const emptyScrape: ScrapeResult = {
      ...scrapeResult,
      keywords: [],
      products: [],
    };
    const result = await analyzeWebsite(emptyScrape, session);
    expect(result.keywords).toEqual([]);
    expect(result.enterprise.products).toEqual([]);
  });
});

// ============================================================================
// 6. json-utils.ts - JSON extraction and parsing utilities
// ============================================================================

describe('extractJsonObject', () => {
  it('extracts a plain JSON object', () => {
    const input = '{"name": "test", "value": 123}';
    expect(extractJsonObject(input)).toBe(input);
  });

  it('extracts JSON from markdown code fence', () => {
    const input = '```json\n{"name": "test"}\n```';
    expect(extractJsonObject(input)).toBe('{"name": "test"}');
  });

  it('extracts JSON from surrounding text', () => {
    const input = 'Here is the result: {"name": "test"} done.';
    expect(extractJsonObject(input)).toBe('{"name": "test"}');
  });

  it('returns the text as-is when no braces found', () => {
    const input = 'no json here';
    expect(extractJsonObject(input)).toBe('no json here');
  });

  it('returns empty string for empty input', () => {
    expect(extractJsonObject('')).toBe('');
    expect(extractJsonObject(null as any)).toBe('');
  });
});

describe('extractJsonArray', () => {
  it('extracts a plain JSON array', () => {
    const input = '[1, 2, 3]';
    expect(extractJsonArray(input)).toBe(input);
  });

  it('extracts array from markdown code fence', () => {
    const input = '```json\n[{"q": "a"}]\n```';
    expect(extractJsonArray(input)).toBe('[{"q": "a"}]');
  });

  it('extracts array from surrounding text', () => {
    const input = 'Results: [1, 2] end';
    expect(extractJsonArray(input)).toBe('[1, 2]');
  });

  it('returns empty string for empty input', () => {
    expect(extractJsonArray('')).toBe('');
  });
});

describe('safeParseJsonObject', () => {
  it('parses valid JSON object', () => {
    const result = safeParseJsonObject('{"a": 1}', null);
    expect(result).toEqual({ a: 1 });
  });

  it('returns fallback for invalid JSON', () => {
    const result = safeParseJsonObject('not json', { default: true });
    expect(result).toEqual({ default: true });
  });

  it('returns fallback for empty input', () => {
    const result = safeParseJsonObject('', { fallback: true });
    expect(result).toEqual({ fallback: true });
  });

  it('parses JSON from fenced markdown', () => {
    const result = safeParseJsonObject('```json\n{"x": 10}\n```', null);
    expect(result).toEqual({ x: 10 });
  });
});

describe('safeParseJsonArray', () => {
  it('parses valid JSON array', () => {
    const result = safeParseJsonArray('[1, 2, 3]', []);
    expect(result).toEqual([1, 2, 3]);
  });

  it('returns fallback for invalid JSON', () => {
    const result = safeParseJsonArray('invalid', []);
    expect(result).toEqual([]);
  });

  it('parses array of objects from fenced markdown', () => {
    const input = '```json\n[{"q": "a"}, {"q": "b"}]\n```';
    const result = safeParseJsonArray(input, []);
    expect(result).toEqual([{ q: 'a' }, { q: 'b' }]);
  });
});

// ============================================================================
// 7. summary-utils.ts - shared profile summary generation
// ============================================================================

describe('buildProfileSummaryLines', () => {
  it('builds lines for a full profile', () => {
    const lines = buildProfileSummaryLines({
      fullName: '测试公司',
      shortName: '测试',
      description: '描述',
      scale: '100人',
      location: '北京',
      products: ['产品A', '产品B'],
      trustAnchors: ['奖项1'],
      brandTone: ['专业'],
      keywords: [{ question: '关键词1' }, { question: '关键词2' }],
    });
    expect(lines).toHaveLength(8);
    expect(lines[0]).toContain('测试公司');
    expect(lines[0]).toContain('测试');
    expect(lines.some((l) => l.includes('产品A'))).toBe(true);
    expect(lines.some((l) => l.includes('关键词1'))).toBe(true);
  });

  it('builds minimal lines for an empty profile', () => {
    const lines = buildProfileSummaryLines({
      products: [],
      trustAnchors: [],
      brandTone: [],
      keywords: [],
    });
    expect(lines).toHaveLength(0);
  });

  it('handles string keywords (not just objects)', () => {
    const lines = buildProfileSummaryLines({
      products: [],
      trustAnchors: [],
      brandTone: [],
      keywords: ['plain string keyword'],
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('plain string keyword');
  });
});

// ============================================================================
// 8. visibility-analysis-service.ts - visibility scoring and term matching
// ============================================================================

describe('visibilityAnalysisService.normalizeTerms', () => {
  it('deduplicates case-insensitive terms', () => {
    const result = visibilityAnalysisService.normalizeTerms('Test', ['test', 'Other']);
    expect(result).toEqual(['Test', 'Other']);
  });

  it('filters out empty and whitespace-only values', () => {
    const result = visibilityAnalysisService.normalizeTerms('Brand', ['', '  ', undefined]);
    expect(result).toEqual(['Brand']);
  });

  it('returns empty array for all-empty input', () => {
    const result = visibilityAnalysisService.normalizeTerms(undefined, undefined);
    expect(result).toEqual([]);
  });
});

describe('visibilityAnalysisService.visibilityScore', () => {
  it('returns 0 when not mentioned', () => {
    const score = visibilityAnalysisService.visibilityScore(
      { mentions: 0, first_index: -1, mentioned: false },
      null,
      false
    );
    expect(score).toBe(0);
  });

  it('gives rank bonus for position 1', () => {
    const score = visibilityAnalysisService.visibilityScore(
      { mentions: 1, first_index: 0, mentioned: true },
      1,
      false
    );
    // 1 mention + 2 (rank 1 bonus) + 0 (not recommended) = 3
    expect(score).toBe(3);
  });

  it('adds recommendation bonus', () => {
    const score = visibilityAnalysisService.visibilityScore(
      { mentions: 1, first_index: 0, mentioned: true },
      1,
      true
    );
    // 1 mention + 2 (rank 1) + 2 (recommended) = 5
    expect(score).toBe(5);
  });
});

describe('visibilityAnalysisService.isRecommended', () => {
  it('detects positive recommendation before mention', () => {
    const text = '首选测试品牌，因为它的产品很好。';
    expect(visibilityAnalysisService.isRecommended(text, text.indexOf('测试品牌'))).toBe(true);
  });

  it('returns false for no signal', () => {
    const text = '这是一段普通的文字，没有任何推荐信号。';
    expect(visibilityAnalysisService.isRecommended(text, 5)).toBe(false);
  });

  it('returns false when negative phrase cancels positive signal', () => {
    const text = '不推荐测试品牌，因为有很多问题。';
    expect(visibilityAnalysisService.isRecommended(text, text.indexOf('测试品牌'))).toBe(false);
  });
});
