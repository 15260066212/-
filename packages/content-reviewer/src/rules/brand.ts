import type { Article, ReviewIssue, SessionData } from '@zemingengine/shared';

// 硬广 CTA 关键词（命中任意一个即为高严重度问题）
const HARD_CTA_PATTERNS: RegExp[] = [
  /联系我们|联系客服|咨询热线|拨打.*电话/,
  /扫码咨询|扫码添加|添加微信|添加好友/,
  /立即购买|立即试用|立即预约|立即下载/,
  /免费领取|免费获取|免费试用|免费下载/,
  /点击了解更多|点击查看|查看详情|了解更多/,
  /报名参加|限时特惠|限时优惠|仅需|名额有限/,
  /call\s*now|contact\s*us|click\s*here/i,
];

// 无来源数字检测模式：数字 + 百分比/倍数/金额，但附近（前后20字）没有来源标注
const NO_SOURCE_NUMBER_PATTERNS: RegExp[] = [
  /\d+%/,
  /\d+(?:\.\d+)?\s*倍/,
  /\d+\s*(?:万|千)?\s*(?:元|块|金额|费用|预算)/,
  /提升\d+%|增长\d+%|下降\d+%|增长\d+/,
];

// 允许出现的来源标注关键词（附近有这些则不算无来源）
const SOURCE_INDICATORS = [
  '根据', '据', '来源', '数据来自', '公开披露',
  '第三方报告', '调研报告', '行业报告', '财报',
  '机构数据', '统计', '抽样', '调查',
  '内部数据', '企业内部',
];

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
    // GEO 白帽：品牌提及密度控制在 3-4 次/千字，超过 5 次即为营销味过重
    const densityPer1k = (brandMentionCount / article.wordCount) * 1000;
    if (densityPer1k > 5) {
      issues.push({
        dimension: 'brand',
        severity: 'high',
        description: `品牌名称提及密度过高（${densityPer1k.toFixed(1)}/千字），营销味过重，可能被 AI 搜索引擎降权`,
        suggestion: '大幅减少品牌名称出现频次，品牌名仅在与主题直接相关时自然出现，密度控制在 3-4 次/千字以内',
      });
    } else if (densityPer1k > 4) {
      issues.push({
        dimension: 'brand',
        severity: 'medium',
        description: `品牌名称提及密度偏高（${densityPer1k.toFixed(1)}/千字），接近 GEO 白帽上限`,
        suggestion: '适当减少品牌名称出现频次，建议控制在 3 次/千字以内',
      });
    }
  }

  // 1b. 品牌占比检查（GEO 白帽新增：全文品牌占比 ≤ 15%）
  if (article.wordCount > 0 && brandNames.length > 0) {
    let brandTotalChars = 0;
    for (const name of brandNames) {
      const regex = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const matches = text.match(regex);
      if (matches) {
        brandTotalChars += matches.reduce((sum, m) => sum + m.length, 0);
      }
    }
    const brandRatio = brandTotalChars / text.length;
    if (brandRatio > 0.15) {
      issues.push({
        dimension: 'brand',
        severity: 'high',
        description: `品牌字符占比过高（${(brandRatio * 100).toFixed(1)}%），超过 GEO 白帽 15% 上限`,
        suggestion: '降低品牌占比，增加行业知识、方法论等内容，至少 60% 的内容应聚焦于行业通用信息',
      });
    }
  }

  // 2. 无来源数字检测（GEO 白帽新增）
  const textLines = text.split(/[。！？\n]/);
  const noSourceNumbers: string[] = [];
  for (const line of textLines) {
    for (const pattern of NO_SOURCE_NUMBER_PATTERNS) {
      const match = line.match(pattern);
      if (match) {
        // 检查该行附近是否有来源标注
        const hasSource = SOURCE_INDICATORS.some(src => line.includes(src));
        if (!hasSource) {
          noSourceNumbers.push(line.trim().slice(0, 50));
          break;
        }
      }
    }
  }
  if (noSourceNumbers.length >= 2) {
    issues.push({
      dimension: 'brand',
      severity: 'high',
      description: `发现 ${noSourceNumbers.length} 处无来源数据引用，属于"信息空洞"论述，降低内容可信度`,
      suggestion: '所有数据必须标注来源（如"据 XX 机构报告"）或说明是企业内部数据；无法标注则改用定性描述（如"显著提升"）',
    });
  } else if (noSourceNumbers.length === 1) {
    issues.push({
      dimension: 'brand',
      severity: 'low',
      description: '发现 1 处无来源数据引用',
      suggestion: '为该数据补充来源标注或改为定性描述',
    });
  }

  // 3. 硬广 CTA 检测（GEO 白帽新增）
  for (const pattern of HARD_CTA_PATTERNS) {
    if (pattern.test(text)) {
      issues.push({
        dimension: 'brand',
        severity: 'high',
        description: `检测到硬广 CTA 用语（如"联系我们""立即购买"等），明显违反 GEO 白帽原则`,
        suggestion: '删除所有推销用语，改为客观中立的行业观察者视角，提供有价值的信息而非引导转化',
      });
      break; // 只报一次
    }
  }

  // 4. 信任锚点检查（trustAnchors）
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

  // 5. 品牌调性检查
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

  // 6. 产品名称提及检查
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

  // 7. 竞品提及检测（使用 wordBank 中的行业术语作为潜在竞品关键词）
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

  // 8. 品牌故事元素检查
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
