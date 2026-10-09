import type { Article, ReviewIssue, SessionData } from '@zemingengine/shared';

export function checkSEO(article: Article, session: SessionData): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const plainText = article.contentPlain ?? article.contentMarkdown;

  // 收集所有关键词
  const keywordTexts: string[] = [];
  for (const kw of session.keywords) {
    if (kw.question) {
      keywordTexts.push(kw.question);
    }
  }
  for (const term of session.wordBank.productTerms) {
    keywordTexts.push(term);
  }
  for (const term of session.wordBank.brandTerms) {
    keywordTexts.push(term);
  }

  // 1. TDK - Title length validation (ideal 20-30 chars per project spec)
  const titleLen = article.title.length;
  if (titleLen < 20) {
    issues.push({
      dimension: 'seo',
      severity: 'medium',
      description: `标题过短（${titleLen}字），TDK规范建议 20-30 字`,
      suggestion: '扩充标题长度至 20-30 字，融入核心关键词以提升搜索权重',
    });
  } else if (titleLen > 30 && titleLen <= 64) {
    issues.push({
      dimension: 'seo',
      severity: 'low',
      description: `标题偏长（${titleLen}字），TDK规范建议 20-30 字`,
      suggestion: '适当精简标题，突出核心关键词',
    });
  }

  // 2. TDK - Meta description (summary) length validation (ideal 60-80 chars)
  if (!article.summary || article.summary.trim().length === 0) {
    issues.push({
      dimension: 'seo',
      severity: 'medium',
      description: '未提供文章摘要（meta description）',
      suggestion: '添加 60-80 字摘要，有助于提升搜索展示效果和点击率',
    });
  } else {
    const summaryLen = article.summary.length;
    if (summaryLen < 60) {
      issues.push({
        dimension: 'seo',
        severity: 'medium',
        description: `摘要过短（${summaryLen}字），TDK规范建议 60-80 字`,
        suggestion: '扩充摘要至 60-80 字，包含核心关键词和价值主张',
      });
    } else if (summaryLen > 80) {
      issues.push({
        dimension: 'seo',
        severity: 'low',
        description: `摘要偏长（${summaryLen}字），TDK规范建议 60-80 字`,
        suggestion: '精简摘要至 80 字以内，搜索引擎通常只展示前 80 字',
      });
    }
  }

  // 3. 标题含关键词检查
  const titleHasKeyword = keywordTexts.some((kw) =>
    article.title.toLowerCase().includes(kw.toLowerCase())
  );
  if (!titleHasKeyword && keywordTexts.length > 0) {
    issues.push({
      dimension: 'seo',
      severity: 'medium',
      description: '标题未包含推荐关键词',
      suggestion: `建议在标题中融入关键词，如：${keywordTexts.slice(0, 3).join('、')}`,
    });
  }

  // 4. 关键词密度百分比检查（理想 1%-3%）
  const totalChars = plainText.replace(/\s+/g, '').length;
  if (totalChars > 0 && keywordTexts.length > 0) {
    let totalKeywordChars = 0;
    const keywordStats: { kw: string; count: number }[] = [];

    for (const kw of keywordTexts) {
      const regex = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const matches = plainText.match(regex);
      const count = matches ? matches.length : 0;
      totalKeywordChars += count * kw.length;
      keywordStats.push({ kw, count });

      if (count === 0) {
        issues.push({
          dimension: 'seo',
          severity: 'medium',
          description: `关键词 "${kw}" 未在正文中出现`,
          suggestion: '在正文中自然融入关键词，提升搜索引擎相关性',
        });
      } else if (count < 2) {
        issues.push({
          dimension: 'seo',
          severity: 'low',
          description: `关键词 "${kw}" 在正文中仅出现 ${count} 次`,
          suggestion: '适当增加关键词出现频次，但避免堆砌',
        });
      }
    }

    // Overall keyword density
    const density = totalKeywordChars / totalChars;
    if (density > 0.05) {
      issues.push({
        dimension: 'seo',
        severity: 'medium',
        description: `关键词密度过高（${(density * 100).toFixed(1)}%），可能被搜索引擎判定为堆砌`,
        suggestion: '将关键词密度控制在 1%-3%，自然融入而非刻意堆砌',
      });
    } else if (density < 0.005 && keywordTexts.length > 0) {
      issues.push({
        dimension: 'seo',
        severity: 'low',
        description: `关键词密度过低（${(density * 100).toFixed(1)}%），搜索引擎相关性信号弱`,
        suggestion: '适当增加关键词出现频次，目标密度 1%-3%',
      });
    }
  }

  // 5. 标题层级检查 (H1 → H2 → H3)
  const headings = (plainText.match(/^(#{1,6})\s+.+$/gm) ?? []).map((h) => {
    const match = h.match(/^(#+)/);
    return match ? match[1].length : 0;
  });

  if (headings.length > 0) {
    // Check for H1 presence (should have at most one)
    const h1Count = headings.filter((h) => h === 1).length;
    if (h1Count > 1) {
      issues.push({
        dimension: 'seo',
        severity: 'medium',
        description: `检测到 ${h1Count} 个 H1 标题，应只有一个`,
        suggestion: '保留一个 H1 标题（通常为文章标题），其余降级为 H2',
      });
    }

    // Check heading hierarchy (should not skip levels, e.g., H2 → H4)
    for (let i = 1; i < headings.length; i++) {
      if (headings[i] > headings[i - 1] + 1 && headings[i - 1] > 0) {
        issues.push({
          dimension: 'seo',
          severity: 'low',
          description: `标题层级跳跃：H${headings[i - 1]} → H${headings[i]}，缺少 H${headings[i] - 1}`,
          suggestion: '保持标题层级递进，不要跳级（如 H2 后直接 H4）',
        });
        break;
      }
    }
  } else if (article.wordCount > 500) {
    issues.push({
      dimension: 'seo',
      severity: 'medium',
      description: '文章缺少结构化标题（H2/H3），影响搜索引擎抓取',
      suggestion: '添加 H2/H3 小标题，帮助搜索引擎理解内容结构',
    });
  }

  // 6. 图片 alt 文本检查
  const images = plainText.match(/!\[([^\]]*)\]\([^)]+\)/g) ?? [];
  if (images.length > 0) {
    const missingAlt = images.filter((img) => {
      const match = img.match(/!\[([^\]]*)\]/);
      return !match || match[1].trim().length === 0;
    });
    if (missingAlt.length > 0) {
      issues.push({
        dimension: 'seo',
        severity: 'low',
        description: `${missingAlt.length} 张图片缺少 alt 文本`,
        suggestion: '为所有图片添加描述性 alt 文本，提升图片搜索 SEO',
      });
    }
  }

  // 7. 链接检查
  const internalLinks = (plainText.match(/\[([^\]]+)\]\(([^)]+)\)/g) ?? []).filter((link) => {
    const match = link.match(/\]\(([^)]+)\)/);
    const url = match ? match[1] : '';
    return url && !url.startsWith('http') && !url.startsWith('www');
  });
  const externalLinks = (plainText.match(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g) ?? []);

  if (article.wordCount > 800 && internalLinks.length === 0 && externalLinks.length === 0) {
    issues.push({
      dimension: 'seo',
      severity: 'low',
      description: '长文章缺少内链或外链',
      suggestion: '适当添加内链（指向站内相关内容）和外链（权威来源），提升 SEO 权重',
    });
  }

  return issues;
}
