import { describe, it, expect } from 'vitest';
import { ContentGenerator } from './generator.js';
import { createEmptySession } from '@zemingengine/shared';
import type { GenerateRequest } from './types.js';

describe('ContentGenerator', () => {
  const createSession = () => {
    const session = createEmptySession('test-session-001');
    session.enterprise = {
      fullName: '泽明引擎科技有限公司',
      shortName: '泽明引擎',
      description: '一家专注于AI营销引擎的科技公司',
      scale: '50-100人',
      location: '北京',
      foundedYear: '2020',
      website: 'https://zemingengine.com',
      products: [
        { name: 'GEO助手', description: 'AI内容生成工具', category: 'SaaS', isPrimary: true },
      ],
      brandStory: '泽明引擎致力于用AI技术帮助企业实现精准营销',
      trustAnchors: ['行业领先', '技术驱动', '客户至上'],
      brandTone: ['专业', '创新', '可靠'],
      userPainPoints: ['内容创作效率低', '营销效果难以衡量'],
    };
    session.promotionGoal = {
      productName: 'GEO助手',
      positioning: '企业级AI内容营销平台',
      coreValue: '提升内容创作效率10倍',
      targetUsers: '中小型企业市场部',
      coreSellingPoint: '一键生成多平台优质内容',
    };
    session.wordBank = {
      brandTerms: ['泽明引擎', 'GEO助手'],
      productTerms: ['AI生成', '内容营销'],
      industryTerms: ['SEO', 'SEM'],
      prefixes: ['如何', '为什么'],
      suffixes: ['教程', '指南'],
    };
    return session;
  };

  describe('fallback mode', () => {
    it('should generate article with fallback template', async () => {
      const generator = new ContentGenerator({ fallbackMode: true });
      const session = createSession();
      const request: GenerateRequest = {
        sessionId: session.id,
        platform: 'weixin',
        contentType: 'tutorial',
        generationRound: 1,
      };

      const result = await generator.generate(request, session);
      const article = result.article;

      expect(article.id.startsWith('art_')).toBeTruthy();
      expect(article.title.length).toBeGreaterThan(0);
      expect(article.contentMarkdown.length).toBeGreaterThan(0);
      expect(article.wordCount).toBeGreaterThan(0);
      expect(article.status).toBe('draft');
      expect(result.generationMeta.model).toBe('fallback-template-v2');
    });
  });

  describe('platform adaptation', () => {
    it('should return contentHtml for weixin platform', async () => {
      const generator = new ContentGenerator({ fallbackMode: true });
      const session = createSession();
      const request: GenerateRequest = {
        sessionId: session.id,
        platform: 'weixin',
        contentType: 'case',
        generationRound: 1,
      };

      const result = await generator.generate(request, session);

      expect(result.article.contentHtml).toBeTruthy();
      expect(result.article.contentPlain).toBeUndefined();
    });
  });

  describe('review feedback echo', () => {
    it('should set generationRound from request', async () => {
      const generator = new ContentGenerator({ fallbackMode: true });
      const session = createSession();
      const request: GenerateRequest = {
        sessionId: session.id,
        platform: 'weixin',
        contentType: 'tutorial',
        generationRound: 2,
        reviewFeedback: {
          issues: [
            {
              dimension: 'quality',
              severity: 'medium',
              description: '内容深度不够',
              suggestion: '增加更多案例分析',
            },
          ],
          suggestions: ['增加数据支撑', '优化段落结构'],
          overallScore: 75,
        },
      };

      const result = await generator.generate(request, session);

      expect(result.article.generationRound).toBe(2);
    });
  });

  describe('keyword embedding (SEO)', () => {
    it('should embed brand terms in generated content', async () => {
      const generator = new ContentGenerator({ fallbackMode: true });
      const session = createSession();
      const request: GenerateRequest = {
        sessionId: session.id,
        platform: 'weixin',
        contentType: 'faq',
        generationRound: 1,
      };

      const result = await generator.generate(request, session);
      const content = result.article.contentMarkdown;

      // Brand name should appear in content
      expect(content).toContain('泽明引擎');
      // Brand terms from wordBank should appear
      expect(content).toContain('GEO助手');
    });

    it('should embed keywords in tags', async () => {
      const generator = new ContentGenerator({ fallbackMode: true });
      const session = createSession();
      const request: GenerateRequest = {
        sessionId: session.id,
        platform: 'weixin',
        contentType: 'tutorial',
        generationRound: 1,
      };

      const result = await generator.generate(request, session);

      // Tags should include brand name
      expect(result.article.tags).toContain('泽明引擎');
      // Tags should have at least 2 items
      expect(result.article.tags.length).toBeGreaterThanOrEqual(2);
    });

    it('should produce content with 200+ words', async () => {
      const generator = new ContentGenerator({ fallbackMode: true });
      const session = createSession();
      const request: GenerateRequest = {
        sessionId: session.id,
        platform: 'weixin',
        contentType: 'whitepaper',
        generationRound: 1,
      };

      const result = await generator.generate(request, session);

      expect(result.article.wordCount).toBeGreaterThan(200);
    });
  });

  describe('content type differentiation', () => {
    it('should produce different titles for different content types', async () => {
      const generator = new ContentGenerator({ fallbackMode: true });
      const session = createSession();

      const tutorialResult = await generator.generate(
        { sessionId: session.id, platform: 'weixin', contentType: 'tutorial', generationRound: 1 },
        session,
      );
      const faqResult = await generator.generate(
        { sessionId: session.id, platform: 'weixin', contentType: 'faq', generationRound: 1 },
        session,
      );
      const caseResult = await generator.generate(
        { sessionId: session.id, platform: 'weixin', contentType: 'case', generationRound: 1 },
        session,
      );

      expect(tutorialResult.article.title).not.toBe(faqResult.article.title);
      expect(tutorialResult.article.title).not.toBe(caseResult.article.title);
      expect(faqResult.article.title).not.toBe(caseResult.article.title);
    });

    it('should produce different content for different content types', async () => {
      const generator = new ContentGenerator({ fallbackMode: true });
      const session = createSession();

      const tutorialResult = await generator.generate(
        { sessionId: session.id, platform: 'weixin', contentType: 'tutorial', generationRound: 1 },
        session,
      );
      const comparisonResult = await generator.generate(
        { sessionId: session.id, platform: 'weixin', contentType: 'comparison', generationRound: 1 },
        session,
      );

      expect(tutorialResult.article.contentMarkdown).not.toBe(comparisonResult.article.contentMarkdown);
      // Comparison content should contain "vs" or "对比"
      expect(comparisonResult.article.contentMarkdown).toMatch(/vs|对比/i);
    });
  });
});
