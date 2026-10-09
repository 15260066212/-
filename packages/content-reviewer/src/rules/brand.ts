import type { Article, ReviewIssue, SessionData } from '@zemingengine/shared';

export function checkBrand(article: Article, session: SessionData): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const text = `${article.title}\n${article.contentPlain ?? article.contentMarkdown}`;
  const { enterprise } = session;

  // 1. 品牌名称提及检查 + 频率分析
  const brandNames = [enterprise.fullName, enterprise.shortName].filter(
    (name): name is string => typeof name === 'string' && name.trim().length > 0,
  );

  let brandMentionCount = 0;
  for (const name of brandNames) {
    const regex = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const matches = text.match(regex);
    brandMentionCount += matches ? matches.length : 0;
  }

  if (brandMentionCount === 0 && brandNames.length > 0) {
    issues.push({
      dimension: 'brand',
      severity: 'medium',
      description: '文章未提及企业品牌名称',
      suggestion: `建议在内容中自然融入品牌名称（如：${enterprise.shortName || enterprise.fullName}）`,
    });
  } else if (brandMentionCount > 0 && article.wordCount > 0) {
    // 品牌提及密度检查（每千字提及 1-5 次为合理范围）
    const densityPer1k = (brandMentionCount / article.wordCount) * 1000;
    if (densityPer1k > 8) {
      issues.push({
        dimension: 'brand',
        severity: 'low',
        description: `品牌名称提及密度过高（${densityPer1k.toFixed(1)}/千字），可能影响阅读体验`,
        suggestion: '适当减少品牌名称出现频次，保持自然融入',
      });
    }
  }

  // 2. 信任锚点检查（trustAnchors）
  const trustAnchors = enterprise.trustAnchors ?? [];
  if (trustAnchors.length > 0) {
    const mentionedAnchors = trustAnchors.filter((anchor) =>
      anchor && text.includes(anchor),
    );
    const anchorCoverage = mentionedAnchors.length / trustAnchors.length;

    if (anchorCoverage === 0) {
      issues.push({
        dimension: 'brand',
        severity: 'medium',
        description: `文章未提及任何信任背书（共 ${trustAnchors.length} 项可用）`,
        suggestion: `建议融入信任背书信息，如：${trustAnchors.slice(0, 3).join('、')}`,
      });
    } else if (anchorCoverage < 0.3 && trustAnchors.length >= 3) {
      issues.push({
        dimension: 'brand',
        severity: 'low',
        description: `仅提及 ${mentionedAnchors.length}/${trustAnchors.length} 项信任背书`,
        suggestion: `可补充更多信任背书：${trustAnchors.filter(a => !mentionedAnchors.includes(a)).slice(0, 3).join('、')}`,
      });
    }
  }

  // 3. 品牌调性检查
  const toneWords = enterprise.brandTone ?? [];
  if (toneWords.length > 0) {
    let toneMatchCount = 0;
    for (const word of toneWords) {
      if (word && text.includes(word)) {
        toneMatchCount++;
      }
    }
    const toneCoverage = toneMatchCount / toneWords.length;

    if (toneCoverage === 0) {
      issues.push({
        dimension: 'brand',
        severity: 'low',
        description: '文章未体现品牌调性关键词',
        suggestion: `可融入品牌调性词汇（如：${toneWords.slice(0, 3).join('、')}）`,
      });
    }
  }

  // 4. 产品名称提及检查
  const productNames = enterprise.products
    .map((p) => p.name)
    .filter((name) => name.trim().length > 0);

  const mentionedProducts = productNames.filter((name) => text.includes(name));
  if (productNames.length > 0 && mentionedProducts.length === 0) {
    issues.push({
      dimension: 'brand',
      severity: 'medium',
      description: '文章未提及任何产品名称',
      suggestion: `建议在内容中介绍相关产品（如：${productNames.slice(0, 3).join('、')}）`,
    });
  } else if (productNames.length > 1 && mentionedProducts.length === 1) {
    issues.push({
      dimension: 'brand',
      severity: 'low',
      description: `仅提及 ${mentionedProducts.length}/${productNames.length} 个产品`,
      suggestion: '可适当增加其他产品的提及，丰富品牌产品矩阵展示',
    });
  }

  // 5. 竞品提及检测（使用 wordBank 中的行业术语作为潜在竞品关键词）
  const competitorTerms = session.wordBank.industryTerms ?? [];
  if (competitorTerms.length > 0 && brandNames.length > 0) {
    const competitorMentions = competitorTerms.filter((term) =>
      term && text.toLowerCase().includes(term.toLowerCase()) &&
      !brandNames.some((bn) => bn.toLowerCase() === term.toLowerCase()),
    );

    // 检查是否有未对比的竞品提及（提及竞品但未与自身品牌做对比）
    if (competitorMentions.length > 0 && brandMentionCount === 0) {
      issues.push({
        dimension: 'brand',
        severity: 'medium',
        description: `提及了行业术语/竞品关键词但未提及自身品牌`,
        suggestion: '提及竞品或行业关键词时应同时突出自身品牌定位和优势',
      });
    }
  }

  // 6. 品牌故事元素检查
  if (enterprise.brandStory && enterprise.brandStory.length > 0) {
    const storyKeywords = enterprise.brandStory
      .split(/[,，、\s。！？\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2 && s.length <= 10)
      .slice(0, 8);

    if (storyKeywords.length > 0) {
      const storyMentioned = storyKeywords.some((kw) => text.includes(kw));
      if (!storyMentioned && article.contentType !== 'tutorial') {
        issues.push({
          dimension: 'brand',
          severity: 'low',
          description: '文章未体现品牌故事元素',
          suggestion: '可适当融入品牌故事片段，增强品牌情感连接',
        });
      }
    }
  }

  return issues;
}
