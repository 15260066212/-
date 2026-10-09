import type { SessionData, PlatformId, ArticleContentType, ReviewFeedback } from '@zemingengine/shared';

interface PlatformConstraint {
  tone: string;
  format: string;
  lengthRange: string;
  specialRules: string[];
}

interface ContentTypeGuide {
  description: string;
  structure: string[];
  tips: string[];
}

const PLATFORM_CONSTRAINTS: Record<PlatformId, PlatformConstraint> = {
  weixin: {
    tone: '专业、权威、有温度',
    format: '公众号文章格式，支持 Markdown',
    lengthRange: '1500-4000字',
    specialRules: [
      '标题要吸引眼球但不过度标题党',
      '开头需要快速抓住读者注意力',
      '适当使用小标题、列表、引用等排版',
      '结尾可以引导关注、转发或留言',
    ],
  },
  zhihu: {
    tone: '专业、理性、深度',
    format: '知乎回答/文章格式',
    lengthRange: '2000-6000字',
    specialRules: [
      '内容要有深度和见解',
      '适当引用数据、案例支撑观点',
      '结构清晰，逻辑严谨',
      '可以使用知乎特色表达',
    ],
  },
  baijia: {
    tone: '中立、客观、信息量大',
    format: '百家号文章格式',
    lengthRange: '1000-3000字',
    specialRules: [
      '标题关键词要前置',
      '段落简短，适合移动端阅读',
      '注意百家号内容审核规范',
      '避免过度营销和硬广',
    ],
  },
  toutiao: {
    tone: '通俗、接地气、有料',
    format: '今日头条文章格式',
    lengthRange: '1000-3000字',
    specialRules: [
      '标题要有悬念或冲突感',
      '开头直接给出核心信息',
      '多用短句和口语化表达',
      '内容要有信息增量',
    ],
  },
  csdn: {
    tone: '技术、专业、实用',
    format: 'CSDN博客格式',
    lengthRange: '1500-5000字',
    specialRules: [
      '代码块要规范，语言标识清晰',
      '步骤要详细，可复现',
      '适当使用技术图表',
      '标题要包含技术关键词',
    ],
  },
  juejin: {
    tone: '技术、前沿、简洁',
    format: '掘金文章格式',
    lengthRange: '1500-4000字',
    specialRules: [
      '内容要聚焦技术深度',
      '代码示例要精炼',
      '可以适当使用 emoji 增加可读性',
      '开头直接说明文章价值',
    ],
  },
  bilibili: {
    tone: '轻松、有趣、互动',
    format: 'B站专栏格式',
    lengthRange: '1500-4000字',
    specialRules: [
      '语言风格轻松活泼',
      '适当使用网络用语',
      '内容要有趣味性和可读性',
      '可以引导弹幕互动和三连',
    ],
  },
  sohu: {
    tone: '新闻、客观、简洁',
    format: '搜狐号文章格式',
    lengthRange: '1000-3000字',
    specialRules: [
      '标题要简洁有力',
      '内容要有时效性和新闻感',
      '段落清晰，信息密度高',
      '避免过度宣传',
    ],
  },
  netease: {
    tone: '深度、观点、品质',
    format: '网易号文章格式',
    lengthRange: '1500-4000字',
    specialRules: [
      '内容要有独特观点',
      '可以结合热点话题',
      '结构要严谨，论据充分',
      '注意网易号内容调性',
    ],
  },
  zhidao: {
    tone: '专业、准确、实用',
    format: '百度知道问答格式',
    lengthRange: '300-1500字',
    specialRules: [
      '以问答形式呈现，问题要精准',
      '回答要直接、准确、有实用价值',
      '可适当引用权威来源',
      '避免广告和推广内容',
    ],
  },
};

const CONTENT_TYPE_GUIDE: Record<ArticleContentType, ContentTypeGuide> = {
  tutorial: {
    description: '教程类内容，目的是教会读者完成某项任务或掌握某个技能',
    structure: [
      '明确学习目标',
      '步骤清晰，循序渐进',
      '提供代码/操作示例',
      '总结关键要点',
    ],
    tips: [
      '从读者角度出发，预判难点',
      '多用结构化表达',
      '提供可复现的示例',
    ],
  },
  case: {
    description: '案例类内容，通过真实或典型场景展示产品/方法的应用',
    structure: [
      '背景介绍',
      '问题描述',
      '解决方案',
      '效果展示',
      '经验总结',
    ],
    tips: [
      '案例要具体、真实',
      '数据和结果要有说服力',
      '突出核心价值',
    ],
  },
  comparison: {
    description: '对比类内容，通过对比帮助读者做出决策',
    structure: [
      '明确对比对象',
      '多维度分析',
      '客观公正',
      '给出明确建议',
    ],
    tips: [
      '避免明显偏袒',
      '对比维度要全面',
      '结论要明确',
    ],
  },
  popularization: {
    description: '科普类内容，将专业知识用通俗易懂的方式传达',
    structure: [
      '引入话题，激发兴趣',
      '概念解释',
      '原理解析',
      '实际应用',
      '总结延伸',
    ],
    tips: [
      '比喻和类比要贴切',
      '避免过多术语，必要时解释',
      '图文并茂更易理解',
    ],
  },
  faq: {
    description: 'FAQ问答类内容，以Q&A形式解答用户常见问题，适合AI搜索引擎抓取和引用',
    structure: [
      '问题标题（用户搜索意图导向）',
      '简明扼要的答案（1-3句话直接回答，BLUF原则）',
      '详细说明（补充上下文、数据、案例）',
      '行动建议（下一步操作指引）',
      '相关问答推荐（2-3个关联问题）',
    ],
    tips: [
      '问题要使用自然语言，贴近用户真实搜索习惯',
      '答案开头直接回答问题，不要绕弯子',
      '使用结构化标记（Q/A格式）便于AI解析',
      '每个问题独立成段，方便搜索引擎抓取片段',
      '关键词自然融入问题和答案中',
      '答案中可植入品牌信息但不过度营销',
    ],
  },
  whitepaper: {
    description: '白皮书/深度报告类内容，以数据和调研为基础，提供行业洞察和决策参考',
    structure: [
      '执行摘要（核心发现和建议）',
      '行业背景与现状分析',
      '调研方法与数据来源',
      '核心发现与数据展示',
      '趋势预测与机会分析',
      '行动建议与实施路径',
      '附录（数据表、术语表、参考文献）',
    ],
    tips: [
      '数据要有来源标注，增强可信度',
      '图表要清晰、专业，有数据标签',
      '分析要客观、深度，避免过度营销',
      '使用行业专业术语，但关键术语首次出现需解释',
      '结构化数据标记（Schema.org）增强AI引用概率',
      '提供可引用的数据单元（如"市场渗透率达XX%"）',
      '篇幅可较长（5000-10000字），但需分章节便于阅读',
    ],
  },
};

export function buildPrompt(params: {
  session: SessionData;
  platform: PlatformId;
  contentType: ArticleContentType;
  generationRound: number;
  reviewFeedback?: ReviewFeedback;
  topic?: string;
  contentSupplement?: string;
  pipelineFeedback?: string;
}): { system: string; user: string } {
  const { session, platform, contentType, generationRound, reviewFeedback, topic, contentSupplement, pipelineFeedback } = params;
  const platformConstraint = PLATFORM_CONSTRAINTS[platform];
  const contentGuide = CONTENT_TYPE_GUIDE[contentType];

  const systemLines: string[] = [];

  // Task description
  systemLines.push('你是一位专业的内容创作助手。请根据以下信息，为指定的平台和内容类型创作一篇高质量的文章。');
  systemLines.push('');

  // Enterprise info
  systemLines.push('=== 企业信息 ===');
  systemLines.push(`企业全称: ${session.enterprise.fullName}`);
  systemLines.push(`企业简称: ${session.enterprise.shortName}`);
  systemLines.push(`企业描述: ${session.enterprise.description}`);
  if (session.enterprise.brandStory) {
    systemLines.push(`品牌故事: ${session.enterprise.brandStory}`);
  }
  if (session.enterprise.trustAnchors.length > 0) {
    systemLines.push(`信任锚点: ${session.enterprise.trustAnchors.join('、')}`);
  }
  if (session.enterprise.brandTone.length > 0) {
    systemLines.push(`品牌调性: ${session.enterprise.brandTone.join('、')}`);
  }
  if (session.enterprise.products.length > 0) {
    systemLines.push(
      `核心产品: ${session.enterprise.products.map((p) => `${p.name}(${p.description})`).join('、')}`
    );
  }
  systemLines.push('');

  // Promotion goal
  systemLines.push('=== 推广目标 ===');
  systemLines.push(`产品名称: ${session.promotionGoal.productName}`);
  systemLines.push(`定位: ${session.promotionGoal.positioning}`);
  systemLines.push(`核心价值: ${session.promotionGoal.coreValue}`);
  systemLines.push(`目标用户: ${session.promotionGoal.targetUsers}`);
  systemLines.push(`核心卖点: ${session.promotionGoal.coreSellingPoint}`);
  systemLines.push('');

  // Platform requirements (built-in constraints)
  systemLines.push(`=== 平台要求 [${platform}] ===`);
  systemLines.push(`语气风格: ${platformConstraint.tone}`);
  systemLines.push(`格式要求: ${platformConstraint.format}`);
  systemLines.push(`字数范围: ${platformConstraint.lengthRange}`);
  if (platformConstraint.specialRules.length > 0) {
    systemLines.push('特殊规则:');
    platformConstraint.specialRules.forEach((rule) => systemLines.push(`  - ${rule}`));
  }
  systemLines.push('');

  // Platform-specific strategy from session (user-configured)
  const platformStrategy = session.platforms.find((p) => p.platform === platform);
  if (platformStrategy) {
    systemLines.push(`=== 平台策略（用户配置）[${platform}] ===`);
    if (platformStrategy.focus) systemLines.push(`内容重点: ${platformStrategy.focus}`);
    if (platformStrategy.tone) systemLines.push(`语气调性: ${platformStrategy.tone}`);
    if (platformStrategy.audience) systemLines.push(`目标受众: ${platformStrategy.audience}`);
    if (platformStrategy.frequency) systemLines.push(`发布频率: ${platformStrategy.frequency}`);
    if (platformStrategy.publishTime) systemLines.push(`最佳发布时间: ${platformStrategy.publishTime}`);
    if (platformStrategy.adaptations.length > 0) {
      systemLines.push('平台适配要点:');
      platformStrategy.adaptations.forEach((a) => systemLines.push(`  - ${a}`));
    }
    systemLines.push('');
  }

  // Content type requirements
  systemLines.push(`=== 内容类型要求 [${contentType}] ===`);
  systemLines.push(`说明: ${contentGuide.description}`);
  systemLines.push('建议结构:');
  contentGuide.structure.forEach((s) => systemLines.push(`  - ${s}`));
  systemLines.push('写作建议:');
  contentGuide.tips.forEach((t) => systemLines.push(`  - ${t}`));
  systemLines.push('');

  // Content playbook (matching contentType)
  const playbook = session.contentPlaybook.find((p) => p.contentType === contentType);
  if (playbook) {
    systemLines.push(`=== 内容配方 [${contentType}] ===`);
    if (playbook.articleType) systemLines.push(`文章类型: ${playbook.articleType}`);
    if (playbook.articleLength) systemLines.push(`篇幅要求: ${playbook.articleLength}`);
    if (playbook.style) systemLines.push(`写作风格: ${playbook.style}`);
    if (playbook.suitableKeywords.length > 0) {
      systemLines.push(`适用关键词: ${playbook.suitableKeywords.join('、')}`);
    }
    if (playbook.titleExamples.length > 0) {
      systemLines.push('标题参考示例:');
      playbook.titleExamples.forEach((t) => systemLines.push(`  - ${t}`));
    }
    systemLines.push('');
  }

  // Audience segments
  if (session.audienceSegments.length > 0) {
    systemLines.push('=== 受众画像 ===');
    session.audienceSegments.forEach((seg) => {
      systemLines.push(`- [${seg.level}] ${seg.audience}`);
      if (seg.painPoint) systemLines.push(`  痛点: ${seg.painPoint}`);
      if (seg.platforms.length > 0) systemLines.push(`  关注平台: ${seg.platforms.join('、')}`);
    });
    systemLines.push('');
  }

  // User pain points
  if (session.enterprise.userPainPoints.length > 0) {
    systemLines.push('=== 用户痛点 ===');
    session.enterprise.userPainPoints.forEach((p) => systemLines.push(`- ${p}`));
    systemLines.push('');
  }

  // Keywords
  systemLines.push('=== 关键词 ===');
  if (session.keywords.length > 0) {
    session.keywords.forEach((kw) => {
      systemLines.push(`- ${kw.question} (类型: ${kw.type}, 优先级: ${kw.priority})`);
    });
  } else {
    systemLines.push('（未配置关键词）');
  }
  systemLines.push('');

  // Word bank
  systemLines.push('=== 词库 ===');
  if (session.wordBank.brandTerms.length > 0) {
    systemLines.push(`品牌词: ${session.wordBank.brandTerms.join('、')}`);
  }
  if (session.wordBank.productTerms.length > 0) {
    systemLines.push(`产品词: ${session.wordBank.productTerms.join('、')}`);
  }
  if (session.wordBank.industryTerms.length > 0) {
    systemLines.push(`行业词: ${session.wordBank.industryTerms.join('、')}`);
  }
  if (session.wordBank.prefixes.length > 0) {
    systemLines.push(`前缀: ${session.wordBank.prefixes.join('、')}`);
  }
  if (session.wordBank.suffixes.length > 0) {
    systemLines.push(`后缀: ${session.wordBank.suffixes.join('、')}`);
  }
  systemLines.push('');

  // Keyword strategy (categories and combinations)
  if (session.keywordStrategy.categories.length > 0) {
    systemLines.push('=== 关键词策略 ===');
    session.keywordStrategy.categories.forEach((cat) => {
      systemLines.push(`- ${cat.category}: ${cat.examples.join('、')} (${cat.generationMethod})`);
    });
    if (session.keywordStrategy.questionMappings.length > 0) {
      systemLines.push('问题映射:');
      session.keywordStrategy.questionMappings.slice(0, 10).forEach((m) => {
        systemLines.push(`  ${m.keyword} → ${m.question}`);
      });
    }
    systemLines.push('');
  }

  // Knowledge base references
  if (session.knowledgeBase.documents.length > 0) {
    systemLines.push('=== 知识库参考 ===');
    session.knowledgeBase.documents.slice(0, 5).forEach((doc) => {
      systemLines.push(`- [${doc.type}] ${doc.title}`);
      if (doc.content) {
        const preview = doc.content.slice(0, 200);
        systemLines.push(`  摘要: ${preview}${doc.content.length > 200 ? '...' : ''}`);
      }
      if (doc.tags && doc.tags.length > 0) {
        systemLines.push(`  标签: ${doc.tags.join('、')}`);
      }
    });
    systemLines.push('（请在写作中适当参考以上知识库内容，但不要直接复制）');
    systemLines.push('');
  }

  // Output format
  systemLines.push('=== 输出格式要求 ===');
  systemLines.push('请严格按照以下 JSON 格式输出，不要包含任何其他内容：');
  systemLines.push(
    JSON.stringify(
      {
        title: '文章标题',
        summary: '文章摘要（100-200字）',
        content: '文章正文（支持 Markdown 格式）',
        tags: ['标签1', '标签2', '标签3'],
        coverImageDesc: '封面图片描述',
      },
      null,
      2
    )
  );
  systemLines.push('');
  systemLines.push('注意事项：');
  systemLines.push('- content 字段为文章正文，请使用 Markdown 格式');
  systemLines.push('- tags 为 3-5 个标签');
  systemLines.push('- coverImageDesc 为封面图片的详细描述，用于后续生成封面图');
  systemLines.push('- 确保 JSON 格式合法，可以被直接解析');
  systemLines.push('');

  // Review feedback for round >= 2
  if (generationRound >= 2 && reviewFeedback) {
    systemLines.push('=== 上一轮审阅反馈 ===');
    systemLines.push(`总体评分: ${reviewFeedback.overallScore}/100`);
    if (reviewFeedback.issues.length > 0) {
      systemLines.push('存在的问题:');
      reviewFeedback.issues.forEach((issue) => {
        systemLines.push(`  [${issue.dimension}] [${issue.severity}] ${issue.description}`);
        if (issue.suggestion) {
          systemLines.push(`    建议: ${issue.suggestion}`);
        }
        if (issue.location) {
          systemLines.push(`    位置: ${issue.location}`);
        }
      });
    }
    if (reviewFeedback.suggestions.length > 0) {
      systemLines.push('改进建议:');
      reviewFeedback.suggestions.forEach((s) => systemLines.push(`  - ${s}`));
    }
    systemLines.push('');
    systemLines.push('请根据以上反馈进行针对性修改和优化。');
    systemLines.push('');
  }

  const userPromptParts: string[] = [
    `请为平台「${platform}」创作一篇「${contentType}」类型的文章。`,
    `这是第 ${generationRound} 轮生成。`,
  ];

  // Inject specific topic from optimization plan
  if (topic) {
    userPromptParts.push(`本次文章必须围绕以下主题创作：「${topic}」。请以此为文章标题或核心主题展开内容。`);
  }

  // Inject content supplement from user
  if (contentSupplement && contentSupplement.trim()) {
    userPromptParts.push(`用户补充要求：请在文章中自然融入以下补充内容：\n${contentSupplement.trim()}`);
  }

  // Inject pipeline feedback (real-time user feedback during pipeline run)
  if (pipelineFeedback && pipelineFeedback.trim()) {
    userPromptParts.push(`【重要 - 用户实时反馈】请务必根据以下反馈调整文章内容和质量：\n${pipelineFeedback.trim()}`);
  }

  // Add contextual hints to user prompt
  if (platformStrategy?.focus) {
    userPromptParts.push(`内容重点: ${platformStrategy.focus}`);
  }
  if (playbook?.style) {
    userPromptParts.push(`写作风格: ${playbook.style}`);
  }

  const userPrompt = userPromptParts.join(' ');

  return {
    system: systemLines.join('\n'),
    user: userPrompt,
  };
}
