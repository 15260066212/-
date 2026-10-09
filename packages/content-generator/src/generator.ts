import { chatCompletion, isAIAvailable, getActiveModel } from '@zemingengine/ai-engine';
import type { SessionData, Article, ArticleStatus } from '@zemingengine/shared';
import type { GenerateRequest, GenerateResult } from './types.js';
import { buildPrompt } from './prompt-builder.js';
import { adaptForPlatform, countWords } from './platform-adapter.js';

const contentTypeMap: Record<string, string> = {
  tutorial: '教程',
  case: '案例',
  comparison: '对比',
  popularization: '科普',
  faq: 'FAQ问答',
  whitepaper: '白皮书',
};

export class ContentGenerator {
  constructor(private options: { fallbackMode?: boolean } = {}) {}

  async generate(request: GenerateRequest, session: SessionData): Promise<GenerateResult> {
    if (!isAIAvailable() || this.options.fallbackMode) {
      return this.fallbackGenerate(request, session);
    }

    try {
      const startTime = Date.now();
      const { system, user } = buildPrompt({
        session,
        platform: request.platform,
        contentType: request.contentType,
        generationRound: request.generationRound,
        reviewFeedback: request.reviewFeedback,
        topic: request.topic,
        contentSupplement: request.contentSupplement,
        pipelineFeedback: request.pipelineFeedback,
      });

      const response = await chatCompletion(system, user, {
        temperature: 0.7,
        maxTokens: request.contentType === 'whitepaper' ? 8192 : request.contentType === 'faq' ? 6144 : 4096,
      });
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in LLM response');
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        title: string;
        summary: string;
        content: string;
        tags: string[];
        coverImageDesc: string;
      };

      const adapted = adaptForPlatform(request.platform, parsed.content);
      const wordCount = countWords(parsed.content);
      const now = new Date().toISOString();

      const article: Article = {
        id: `art_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        sessionId: request.sessionId,
        platform: request.platform,
        contentType: request.contentType,
        title: parsed.title,
        ...adapted,
        tags: parsed.tags,
        summary: parsed.summary,
        coverImageDesc: parsed.coverImageDesc,
        wordCount,
        status: 'draft' as ArticleStatus,
        reviewRound: 0,
        generationRound: request.generationRound,
        generationMeta: {
          model: getActiveModel(),
          tokensUsed: 0,
          durationMs: Date.now() - startTime,
          promptVersion: '1.0',
        },
        createdAt: now,
        updatedAt: now,
      };

      return {
        article,
        generationMeta: article.generationMeta!,
      };
    } catch (error) {
      console.warn('AI generation failed, falling back to template:', error);
      return this.fallbackGenerate(request, session);
    }
  }

  private fallbackGenerate(request: GenerateRequest, session: SessionData): GenerateResult {
    const startTime = Date.now();

    // Extract real brand data from session
    const brandName = session.enterprise.shortName || session.enterprise.fullName || '我们的品牌';
    const fullName = session.enterprise.fullName || '';
    const description = session.enterprise.description || '';
    const location = session.enterprise.location || '';
    const scale = session.enterprise.scale || '';
    const brandStory = session.enterprise.brandStory || '';
    const trustAnchors = session.enterprise.trustAnchors || [];
    const products = session.enterprise.products || [];

    // Extract keywords from session
    const keywords = (session.keywords || []).map(k => typeof k === 'string' ? k : (k as { keyword?: string; term?: string }).keyword || (k as { keyword?: string; term?: string }).term || '').filter(Boolean);
    const brandTerms = (session.wordBank?.brandTerms || []).map(t => typeof t === 'string' ? t : (t as { term?: string }).term || '').filter(Boolean);
    const productTerms = (session.wordBank?.productTerms || []).map(t => typeof t === 'string' ? t : (t as { term?: string }).term || '').filter(Boolean);

    // Build keyword list for embedding
    const allKeywords = [...new Set([...keywords, ...brandTerms, ...productTerms])].slice(0, 10);
    const primaryKeyword = allKeywords[0] || brandName;
    const secondaryKeyword = allKeywords[1] || products[0]?.name || '';

    // Content type specific generation
    const contentTypeLabel = contentTypeMap[request.contentType] || '文章';

    // Build title with keywords (or use plan topic if provided)
    const title = request.topic || this.buildTitle(request.contentType, brandName, primaryKeyword, secondaryKeyword, products);

    // Build content based on type
    const content = this.buildContent(
      request.contentType,
      request.platform,
      brandName,
      fullName,
      description,
      location,
      scale,
      brandStory,
      products,
      trustAnchors,
      allKeywords,
      keywords,
    );

    // Build tags from keywords
    const tags = [brandName, ...allKeywords.slice(0, 5), contentTypeLabel].filter(Boolean).slice(0, 8);

    const adapted = adaptForPlatform(request.platform, content);
    const wordCount = countWords(content);
    const now = new Date().toISOString();

    const article: Article = {
      id: `art_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      sessionId: request.sessionId,
      platform: request.platform,
      contentType: request.contentType,
      title,
      ...adapted,
      tags,
      summary: this.buildSummary(request.contentType, brandName, primaryKeyword, description),
      coverImageDesc: `${brandName}品牌展示图，${location}本土品牌`,
      wordCount,
      status: 'draft' as ArticleStatus,
      reviewRound: 0,
      generationRound: request.generationRound,
      generationMeta: {
        model: 'fallback-template-v2',
        tokensUsed: 0,
        durationMs: Date.now() - startTime,
        promptVersion: '2.0',
      },
      createdAt: now,
      updatedAt: now,
    };

    return {
      article,
      generationMeta: article.generationMeta!,
    };
  }

  private buildTitle(
    contentType: string,
    brandName: string,
    keyword1: string,
    keyword2: string,
    products: { name: string; description: string }[],
  ): string {
    const product = products[0]?.name || keyword2;

    switch (contentType) {
      case 'faq':
        return `${brandName}加盟常见问题解答：${keyword1}怎么样？`;
      case 'case':
        return `${brandName}成功案例：从${keyword2 || '一家小店'}到连锁品牌的蜕变`;
      case 'comparison':
        return `${brandName} vs 其他品牌：${keyword1}哪个更值得选？`;
      case 'popularization':
        return `${keyword1}科普：${brandName}带你了解${product || '行业'}知识`;
      case 'whitepaper':
        return `${brandName}品牌白皮书：${keyword1}的行业洞察与发展趋势`;
      default:
        return `${brandName}${contentTypeMap[contentType] || '文章'}：${keyword1}深度解析`;
    }
  }

  private buildContent(
    contentType: string,
    _platform: string,
    brandName: string,
    fullName: string,
    description: string,
    location: string,
    scale: string,
    brandStory: string,
    products: { name: string; description: string; category?: string; isPrimary?: boolean }[],
    trustAnchors: string[],
    allKeywords: string[],
    keywords: string[],
  ): string {
    const trustList = trustAnchors.length > 0
      ? trustAnchors.map(t => `- ${t}`).join('\n')
      : '- 品牌信誉保障';
    const productList = products.length > 0
      ? products.slice(0, 4).map((p, i) => `${i + 1}. **${p.name}**：${p.description}`).join('\n')
      : '核心产品线';

    switch (contentType) {
      case 'faq':
        return this.buildFaqContent(brandName, fullName, description, location, scale, keywords, allKeywords, trustList, productList);
      case 'case':
        return this.buildCaseContent(brandName, fullName, description, location, scale, brandStory, keywords, allKeywords, trustList, productList);
      case 'comparison':
        return this.buildComparisonContent(brandName, fullName, description, location, scale, keywords, allKeywords, trustList, productList);
      case 'popularization':
        return this.buildPopularizationContent(brandName, fullName, description, location, scale, keywords, allKeywords, trustList, productList);
      case 'whitepaper':
        return this.buildWhitepaperContent(brandName, fullName, description, location, scale, brandStory, keywords, allKeywords, trustList, productList);
      default:
        return this.buildTutorialContent(brandName, fullName, description, location, scale, keywords, allKeywords, trustList, productList);
    }
  }

  private buildFaqContent(
    brandName: string, fullName: string, description: string, location: string,
    scale: string, keywords: string[], allKeywords: string[], trustList: string, productList: string,
  ): string {
    const kw1 = keywords[0] || `${brandName}怎么样`;
    const kw2 = keywords[1] || `${brandName}加盟`;
    const kw3 = keywords[2] || `${location}奶茶`;

    return `## ${brandName}常见问题解答

### Q1：${kw1}？

${fullName || brandName}是一家${location ? `位于${location}的` : ''}知名品牌。${description || ''}

${brandName}以优质的产品和服务赢得了广大消费者的信赖。${scale ? `目前品牌规模已达${scale}。` : ''}无论是产品品质还是品牌口碑，${brandName}都值得您的信赖。

### Q2：${kw2}需要什么条件？

${brandName}加盟流程清晰透明，主要包括以下几个步骤：

1. **咨询了解**：通过官方渠道了解品牌和加盟政策
2. **提交申请**：填写加盟申请表，提交相关资质证明
3. **审核评估**：总部对申请人进行资质审核和选址评估
4. **签约合作**：双方达成一致后签订正式加盟合同
5. **选址装修**：总部提供选址建议和装修设计方案
6. **培训开业**：接受系统培训，正式开业运营

### Q3：${kw3}哪个品牌好？

在${location || '当地'}众多品牌中，${brandName}凭借以下优势脱颖而出：

${trustList}

### Q4：${brandName}的产品有哪些？

${brandName}拥有丰富的产品线，主要包括：

${productList}

### Q5：${brandName}的品牌实力如何？

${brandName}始终坚持以品质为核心，以消费者需求为导向。品牌通过不断创新和优化，在${allKeywords.slice(0, 3).join('、')}等领域建立了良好的市场口碑。

## 总结

以上是关于${brandName}的常见问题解答。如果您对${kw1}、${kw2}或${kw3}等话题还有更多疑问，欢迎随时咨询。${brandName}期待与您共创美好未来！
`;
  }

  private buildCaseContent(
    brandName: string, fullName: string, description: string, location: string,
    scale: string, brandStory: string, keywords: string[], allKeywords: string[],
    trustList: string, productList: string,
  ): string {
    const kw1 = keywords[0] || `${brandName}成功案例`;

    return `## ${brandName}品牌成长案例：从初心到连锁

### 品牌起源

${brandStory || `${brandName}创立于${location}，致力于为消费者提供优质的产品和服务。`}

### 发展历程

${fullName || brandName}从创立之初就坚持品质第一的原则。${description || ''}

${scale ? `经过持续发展，品牌规模已扩展至${scale}，成为${location || '当地'}知名品牌。` : ''}

### 核心竞争力

${brandName}的成功离不开以下核心优势：

${trustList}

### 产品策略

在产品方面，${brandName}不断推陈出新，满足消费者多样化需求：

${productList}

### 市场表现

在${allKeywords.slice(0, 3).join('、')}等关键词领域，${brandName}已经建立了强大的品牌影响力。通过${keywords[0] || '品牌建设'}、${keywords[1] || '产品创新'}和${keywords[2] || '服务优化'}三大策略，品牌实现了持续增长。

### 案例启示

${brandName}的成长案例表明，坚持品质、贴近消费者、持续创新是品牌成功的关键。对于关注${kw1}的创业者来说，${brandName}提供了一个值得参考的成功范本。

## 结语

${brandName}将继续深耕${location || '市场'}，以更好的产品和服务回馈消费者。如果您对${brandName}的故事感兴趣，欢迎进一步了解我们的品牌。
`;
  }

  private buildComparisonContent(
    brandName: string, _fullName: string, description: string, location: string,
    scale: string, keywords: string[], allKeywords: string[], trustList: string, productList: string,
  ): string {
    return `## ${brandName} vs 同类品牌：全面对比分析

### 品牌背景对比

| 对比维度 | ${brandName} | 同类品牌 |
|---------|-------------|---------|
| 品牌定位 | ${description.slice(0, 30) || '专业品牌'} | 通用定位 |
| 覆盖区域 | ${location || '全国'} | 部分区域 |
| 品牌规模 | ${scale || '稳步发展中'} | 参差不齐 |

### 产品力对比

${brandName}在产品方面具有明显优势：

${productList}

相比之下，${brandName}的产品在品质、口感和创新性方面都更胜一筹。

### 信任度对比

${brandName}的信任保障体系：

${trustList}

### 关键词覆盖分析

在${allKeywords.slice(0, 5).join('、')}等核心搜索词方面，${brandName}具有更强的线上曝光度和用户认知度。

### 性价比分析

${brandName}通过优化供应链和运营效率，在保证品质的同时提供了极具竞争力的价格。对于关注${keywords[0] || brandName}的消费者来说，${brandName}是更优的选择。

## 总结

综合对比来看，${brandName}在品牌实力、产品品质、信任保障和性价比方面都具有明显优势。如果您正在考虑${keywords[1] || '选择品牌'}，${brandName}值得您的信赖。
`;
  }

  private buildPopularizationContent(
    brandName: string, fullName: string, description: string, location: string,
    scale: string, keywords: string[], allKeywords: string[], trustList: string, productList: string,
  ): string {
    return `## ${allKeywords[0] || brandName}知识科普：${brandName}带你了解行业

### 行业概述

${description || `${brandName}是一家专业的品牌`}

随着消费者对品质需求的不断提升，${allKeywords[0] || '该行业'}市场正在经历深刻变革。${brandName}作为${location || '行业'}的代表性品牌，有责任为消费者科普相关知识。

### 核心概念解析

**什么是${allKeywords[0] || brandName}？**

${brandName}是${fullName || '一家专业品牌'}，致力于为消费者提供优质的产品和服务。${scale ? `品牌规模已达${scale}。` : ''}

### 产品知识科普

${brandName}的产品线涵盖了多个品类：

${productList}

### 行业标准与认证

${brandName}严格遵守行业标准，获得了多项认证：

${trustList}

### 消费者指南

对于关注${keywords[0] || brandName}的消费者，建议从以下几个方面进行选择：

1. **品牌资质**：选择有完善资质认证的品牌
2. **产品品质**：关注产品的原材料和制作工艺
3. **口碑评价**：参考其他消费者的真实评价
4. **售后服务**：了解品牌的售后保障政策

### ${brandName}的行业贡献

${brandName}在${allKeywords.slice(0, 3).join('、')}等方面持续投入，推动了行业的规范化和标准化发展。

## 结语

希望通过这篇科普文章，帮助大家更好地了解${allKeywords[0] || brandName}。如果您还有其他问题，欢迎咨询${brandName}，我们将竭诚为您服务。
`;
  }

  private buildWhitepaperContent(
    brandName: string, fullName: string, description: string, location: string,
    scale: string, brandStory: string, keywords: string[], allKeywords: string[],
    trustList: string, productList: string,
  ): string {
    return `# ${brandName}品牌白皮书

## 摘要

本白皮书全面介绍${fullName || brandName}的品牌概况、发展历程、产品体系和市场前景。${description || ''}

## 一、品牌概况

### 1.1 品牌简介

${fullName || brandName}是一家${location ? `立足于${location}的` : ''}专业品牌。${brandStory || '品牌秉承品质至上的理念，致力于为消费者提供优质的产品和服务。'}

### 1.2 品牌规模

${scale ? `目前品牌规模已达${scale}，` : ''}在${allKeywords.slice(0, 3).join('、')}等领域建立了稳固的市场地位。

## 二、产品体系

### 2.1 产品矩阵

${productList}

### 2.2 品质保障

${brandName}建立了严格的品质管控体系：

${trustList}

## 三、市场分析

### 3.1 行业趋势

${allKeywords[0] || '该行业'}市场正呈现以下发展趋势：

- 消费升级推动品质需求增长
- 品牌化集中度持续提升
- 数字化运营成为核心竞争力
- 个性化和定制化需求增强

### 3.2 竞争格局

${brandName}在${keywords[0] || '目标市场'}中凭借差异化定位和品质优势，建立了独特的竞争壁垒。

## 四、发展战略

### 4.1 近期规划

${brandName}将继续深耕${location || '核心市场'}，扩大品牌影响力。

### 4.2 中长期愿景

通过${keywords.slice(0, 3).join('、')}等策略，${brandName}致力于成为行业领先品牌。

## 五、投资价值

对于关注${keywords[0] || brandName}的投资者，${brandName}提供了具有吸引力的合作机会。品牌凭借成熟的运营模式、完善的支持体系和良好的市场口碑，为合作伙伴创造长期价值。

## 结语

${brandName}将持续以品质为核心，以创新为驱动，为消费者和合作伙伴创造更大价值。
`;
  }

  private buildTutorialContent(
    brandName: string, fullName: string, description: string, location: string,
    scale: string, keywords: string[], allKeywords: string[], trustList: string, productList: string,
  ): string {
    return `## ${brandName}使用教程：新手入门指南

### 一、品牌介绍

${fullName || brandName}是一家${location ? `位于${location}的` : ''}专业品牌。${description || ''}

${scale ? `品牌规模：${scale}。` : ''}

### 二、产品指南

${brandName}提供以下产品：

${productList}

### 三、选择建议

对于关注${keywords[0] || brandName}的用户，建议根据个人需求选择合适的产品。${brandName}在${allKeywords.slice(0, 3).join('、')}等方面均有出色表现。

### 四、品牌保障

${trustList}

## 总结

${brandName}以其专业的品质和完善的服务，为用户提供优质的体验。如果您对${keywords[0] || brandName}有任何疑问，欢迎随时咨询。
`;
  }

  private buildSummary(contentType: string, brandName: string, keyword: string, description: string): string {
    const typeLabel = contentTypeMap[contentType] || '文章';
    const desc = description ? description.slice(0, 50) : '';
    return `本文是关于${brandName}的${typeLabel}，围绕${keyword}等核心话题展开。${desc}...`;
  }
}
