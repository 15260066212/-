import type { Article, ReviewIssue, PlatformId } from '@zemingengine/shared';

const PLATFORM_REQUIREMENTS: Record<PlatformId, {
  minWordCount: number;
  maxWordCount: number;
  maxTags: number;
  minTags: number;
  titleMaxLength: number;
  needsCoverImage: boolean;
  contentFormat: 'markdown' | 'html' | 'plain';
  notes: string;
}> = {
  weixin: { minWordCount: 300, maxWordCount: 20000, maxTags: 5, minTags: 3, titleMaxLength: 64, needsCoverImage: true, contentFormat: 'html', notes: '微信公众号' },
  zhihu: { minWordCount: 500, maxWordCount: 50000, maxTags: 5, minTags: 1, titleMaxLength: 100, needsCoverImage: false, contentFormat: 'html', notes: '知乎专栏' },
  baike: { minWordCount: 300, maxWordCount: 20000, maxTags: 5, minTags: 1, titleMaxLength: 60, needsCoverImage: false, contentFormat: 'html', notes: '百度百科' },
  toutiao: { minWordCount: 400, maxWordCount: 30000, maxTags: 5, minTags: 3, titleMaxLength: 30, needsCoverImage: true, contentFormat: 'html', notes: '头条号' },
  csdn: { minWordCount: 300, maxWordCount: 50000, maxTags: 5, minTags: 1, titleMaxLength: 100, needsCoverImage: false, contentFormat: 'markdown', notes: 'CSDN' },
  juejin: { minWordCount: 500, maxWordCount: 50000, maxTags: 5, minTags: 1, titleMaxLength: 100, needsCoverImage: false, contentFormat: 'markdown', notes: '掘金' },
  sohu: { minWordCount: 400, maxWordCount: 30000, maxTags: 5, minTags: 1, titleMaxLength: 50, needsCoverImage: false, contentFormat: 'html', notes: '搜狐号' },
  netease: { minWordCount: 400, maxWordCount: 30000, maxTags: 5, minTags: 1, titleMaxLength: 50, needsCoverImage: false, contentFormat: 'html', notes: '网易号' },
  baijia: { minWordCount: 400, maxWordCount: 30000, maxTags: 5, minTags: 1, titleMaxLength: 40, needsCoverImage: false, contentFormat: 'html', notes: '百家号' },
  bilibili: { minWordCount: 300, maxWordCount: 20000, maxTags: 10, minTags: 1, titleMaxLength: 80, needsCoverImage: false, contentFormat: 'markdown', notes: '哔哩哔哩专栏' },
  zhidao: { minWordCount: 200, maxWordCount: 10000, maxTags: 5, minTags: 1, titleMaxLength: 50, needsCoverImage: false, contentFormat: 'plain', notes: '百度知道' },
};

const PLATFORM_TABOO_WORDS: Partial<Record<PlatformId, string[]>> = {
  csdn: ['加群', '私聊', '免费领取', '扫码'],
  zhihu: ['加微信', '私聊', '免费领取', '优惠券'],
  toutiao: ['微信号', '加群', '私聊', '代购'],
};

export function checkPlatformAdaptation(article: Article): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const req = PLATFORM_REQUIREMENTS[article.platform];
  if (!req) return issues;

  // 1. 字数检查
  if (article.wordCount < req.minWordCount) {
    issues.push({
      dimension: 'platform_adaptation',
      severity: 'high',
      description: `${req.notes}平台要求至少 ${req.minWordCount} 字，当前 ${article.wordCount} 字`,
      suggestion: `扩充内容至 ${req.minWordCount} 字以上以符合${req.notes}发布要求`,
    });
  } else if (article.wordCount > req.maxWordCount) {
    issues.push({
      dimension: 'platform_adaptation',
      severity: 'medium',
      description: `${req.notes}平台建议不超过 ${req.maxWordCount} 字，当前 ${article.wordCount} 字`,
      suggestion: '精简内容或拆分为多篇文章',
    });
  }

  // 2. 标题长度检查
  if (article.title.length > req.titleMaxLength) {
    issues.push({
      dimension: 'platform_adaptation',
      severity: 'high',
      description: `${req.notes}标题长度限制 ${req.titleMaxLength} 字，当前 ${article.title.length} 字`,
      suggestion: '缩短标题以符合平台要求',
    });
  }

  // 3. 标签数量检查
  if (article.tags.length < req.minTags) {
    issues.push({
      dimension: 'platform_adaptation',
      severity: 'medium',
      description: `${req.notes}建议至少添加 ${req.minTags} 个标签，当前 ${article.tags.length} 个`,
      suggestion: `添加更多标签以提升${req.notes}内容曝光度`,
    });
  } else if (article.tags.length > req.maxTags) {
    issues.push({
      dimension: 'platform_adaptation',
      severity: 'medium',
      description: `${req.notes}最多支持 ${req.maxTags} 个标签，当前 ${article.tags.length} 个`,
      suggestion: '删除多余标签以符合平台限制',
    });
  }

  // 4. 封面图要求检查
  if (req.needsCoverImage) {
    const hasCoverDesc = article.coverImageDesc && article.coverImageDesc.trim().length > 0;
    if (!hasCoverDesc) {
      issues.push({
        dimension: 'platform_adaptation',
        severity: 'medium',
        description: `${req.notes}平台需要封面图，当前未提供封面图描述`,
        suggestion: `为${req.notes}添加封面图描述，提升内容展示效果`,
      });
    }
  }

  // 5. 平台禁忌词检查
  const tabooWords = PLATFORM_TABOO_WORDS[article.platform];
  if (tabooWords) {
    const text = `${article.title}\n${article.contentPlain ?? article.contentMarkdown}`;
    for (const word of tabooWords) {
      if (text.includes(word)) {
        issues.push({
          dimension: 'platform_adaptation',
          severity: 'high',
          description: `${req.notes}平台禁止使用"${word}"等引流词汇`,
          suggestion: `移除"${word}"等平台禁忌词，避免被限流或删除`,
        });
      }
    }
  }

  // 6. 内容格式适配检查
  const contentForPlatform = article.contentMarkdown;
  if (req.contentFormat === 'markdown') {
    const hasMdSyntax = /[#*`\-\[\]()>_~]/.test(contentForPlatform);
    if (!hasMdSyntax) {
      issues.push({
        dimension: 'platform_adaptation',
        severity: 'low',
        description: `${req.notes}平台支持 Markdown 格式，当前内容缺少 Markdown 语法`,
        suggestion: '使用 Markdown 语法（标题、列表、代码块等）提升内容排版',
      });
    }
  }

  // 7. 平台特定内容风格检查
  if (article.platform === 'csdn' || article.platform === 'juejin') {
    const hasCodeBlock = /```/.test(article.contentMarkdown);
    if (!hasCodeBlock && article.contentType === 'tutorial') {
      issues.push({
        dimension: 'platform_adaptation',
        severity: 'low',
        description: '技术平台教程类文章建议包含代码示例',
        suggestion: '添加代码块以提升技术内容的专业度',
      });
    }

    // 技术平台建议包含技术关键词
    const techKeywords = ['API', 'SDK', '框架', '架构', '性能', '部署', '配置', '实例', '代码', '函数'];
    const text = article.contentMarkdown;
    const techCount = techKeywords.filter((kw) => text.includes(kw)).length;
    if (techCount === 0 && article.contentType === 'tutorial') {
      issues.push({
        dimension: 'platform_adaptation',
        severity: 'low',
        description: `${req.notes}技术内容缺少技术术语`,
        suggestion: '增加专业技术术语，提升内容在技术社区的权威性',
      });
    }
  }

  return issues;
}
