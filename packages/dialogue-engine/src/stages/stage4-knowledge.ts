import type {
  AudienceSegment,
  ContentGenerationConfig,
  DocumentItem,
  ImageAssetPlan,
  ImageItem,
  KeywordStrategy,
  KnowledgeDocumentPlan,
  PlatformStrategy,
  PromotionGoal,
  SessionData,
  DialogueMessage,
} from '@zemingengine/shared';
import type { StageHandler, Question, StageResult } from '../types.js';
import { required } from '../validators.js';
import { buildPlatformPrompts } from '../platformPromptTemplates.js';
import { buildTrackingPlan } from '../trackingPlanBuilder.js';

let messageCounter = 0;
function nextId(): string {
  return `msg_${Date.now()}_${++messageCounter}`;
}

function makeMessage(role: 'system' | 'user', content: string): DialogueMessage {
  return { id: nextId(), role, content, stage: 'knowledge', timestamp: new Date().toISOString() };
}

const questions: Question[] = [
  {
    id: 'available_materials',
    text: '请列出你们已有或可提供的资料，用逗号或换行分隔。\n\n例如：用户手册、产品说明、白皮书、行业资料、客户案例、FAQ、产品截图、架构图、功能演示视频等。\n\n我会根据这些资料生成知识库构建方案，并自动规划文档、图片、标签、内容提示词和平台发布策略。',
    geoContext: '知识库用于为后续内容生成补充真实产品信息、案例、术语、图片素材和证据来源，减少模型幻觉。',
    validator: required,
  },
];

function splitList(input: string): string[] {
  return input.split(/[,，、；;\n]/).map((item) => item.trim()).filter(Boolean);
}

function inferDocType(item: string): DocumentItem['type'] {
  if (/案例|客户|实践|场景/.test(item)) return 'case';
  if (/FAQ|问答|问题|帮助/.test(item)) return 'faq';
  if (/产品|手册|说明|功能|白皮书/.test(item)) return 'product';
  return 'brand';
}

function inferTags(item: string, session: SessionData): string[] {
  const tags = [
    session.enterprise.shortName || session.enterprise.fullName,
    session.enterprise.products[0]?.name,
  ];

  if (/手册|说明|功能|配置|演示|截图|界面|架构|流程/.test(item)) tags.push('产品资料');
  if (/白皮书|行业|趋势|报告|研究/.test(item)) tags.push('行业洞察');
  if (/案例|客户|实践|效果|对比/.test(item)) tags.push('客户案例');
  if (/FAQ|问答|问题|帮助|价格|部署|安全/.test(item)) tags.push('常见问题');

  return Array.from(new Set(tags.filter(Boolean)));
}

function buildDocumentPlan(items: string[], session: SessionData): DocumentItem[] {
  const requiredDocs = [
    '产品说明书：覆盖产品定位、核心功能、适用人群、典型使用流程',
    '用户手册：覆盖关键操作步骤、配置方法、常见问题',
    'FAQ：覆盖采购、部署、价格、效果评估、数据安全等高频问题',
    '客户案例：覆盖行业、场景、使用前后变化和可量化结果',
    '行业资料：覆盖市场趋势、用户痛点、方法论和术语解释',
  ];

  return [...items, ...requiredDocs].map((item) => ({
    title: item,
    content: `${session.enterprise.fullName || '企业'}知识库资料：${item}`,
    type: inferDocType(item),
    tags: inferTags(item, session),
  }));
}

function buildImagePlan(session: SessionData): ImageItem[] {
  const productName = session.enterprise.products[0]?.name || session.enterprise.shortName || session.enterprise.fullName || '产品';
  return [
    { url: '待上传', alt: `${productName} 产品界面截图`, category: '产品截图', tags: ['产品资料', '界面展示'] },
    { url: '待上传', alt: `${productName} 核心功能流程图`, category: '流程图', tags: ['产品资料', '工作流程'] },
    { url: '待上传', alt: `${productName} 典型应用场景图`, category: '场景图', tags: ['应用场景', '目标用户'] },
    { url: '待上传', alt: `${productName} 客户案例或效果对比图`, category: '案例图', tags: ['客户案例', '效果证明'] },
  ];
}

function buildTags(items: string[], session: SessionData) {
  const tags = [
    '产品资料',
    '行业洞察',
    '客户案例',
    '常见问题',
    '视觉素材',
    session.enterprise.shortName,
    session.enterprise.fullName,
    ...session.enterprise.products.map((product) => product.name),
    ...session.wordBank.industryTerms,
    ...session.enterprise.userPainPoints,
    ...items,
  ];
  return Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean)))
    .slice(0, 16)
    .map((name) => ({ name, count: 1 }));
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function getProductName(session: SessionData): string {
  return session.enterprise.products[0]?.name || session.enterprise.shortName || session.enterprise.fullName || '产品';
}

function getPrimaryIndustry(session: SessionData): string {
  return session.wordBank.industryTerms[0] || session.enterprise.products[0]?.category || '行业';
}

function getBusinessTerms(session: SessionData, limit = 5): string[] {
  return unique([
    ...session.wordBank.industryTerms,
    ...session.enterprise.products.map((product) => product.category),
    ...session.enterprise.products.flatMap((product) => splitList(product.description)),
    ...session.wordBank.productTerms,
  ]).slice(0, limit);
}

function getPainTerms(session: SessionData, productName: string, limit = 5): string[] {
  return unique([
    ...session.enterprise.userPainPoints,
    `${productName}解决什么问题`,
    `${productName}适合哪些企业`,
    `${productName}怎么用`,
  ]).slice(0, limit);
}

function isKeywordList(text: string): boolean {
  // Detect if text is a comma-separated keyword list rather than a real description
  if (!text || text.length < 10) return false;
  const parts = text.split(/[,，、;；]/).map(p => p.trim()).filter(Boolean);
  if (parts.length < 3) return false;
  // If average part length < 8 chars and more than 3 parts, it's likely a keyword list
  const avgLen = parts.reduce((sum, p) => sum + p.length, 0) / parts.length;
  return avgLen < 10;
}

function buildPromotionGoal(session: SessionData): PromotionGoal {
  const productName = getProductName(session);
  const product = session.enterprise.products.find((item) => item.name === productName) || session.enterprise.products[0];
  const businessTerms = getBusinessTerms(session, 4);
  const painTerms = session.enterprise.userPainPoints.slice(0, 3);
  const primaryIndustry = getPrimaryIndustry(session);

  // Use description only if it's a real description, not a keyword list
  const rawDesc = session.enterprise.description || '';
  const cleanDescription = isKeywordList(rawDesc) ? '' : rawDesc;

  // Build positioning from best available source
  const positioning = cleanDescription || product?.description || `${primaryIndustry}相关产品/服务`;

  // Build coreValue from business terms, but filter out keyword-list pollution
  const cleanBusinessTerms = businessTerms.filter(t => !t.includes(',') && !t.includes('，') && t.length < 15);
  const coreValue = cleanBusinessTerms.length > 0
    ? cleanBusinessTerms.join(' + ')
    : product?.description?.split(/[,，]/)[0] || primaryIndustry;

  // Build targetUsers
  const targetUsers = painTerms.length > 0
    ? `关注${painTerms.join('、')}的用户`
    : `${primaryIndustry}相关决策者、管理者和一线使用者`;

  // Build coreSellingPoint from product description, not from raw description field
  const coreSellingPoint = product?.description || cleanDescription || `围绕${primaryIndustry}场景提供专业能力`;

  return {
    productName,
    positioning,
    coreValue,
    targetUsers,
    coreSellingPoint,
  };
}

function buildAudienceSegments(session: SessionData): AudienceSegment[] {
  const primaryIndustry = getPrimaryIndustry(session);
  const painTerms = session.enterprise.userPainPoints;
  return [
    { level: '决策层', audience: `${primaryIndustry}采购决策者和业务负责人`, painPoint: painTerms[0] || '需要评估产品价值和投入产出', platforms: ['知乎', '公众号', 'InfoQ'] },
    { level: '使用层', audience: `${primaryIndustry}一线使用者和团队负责人`, painPoint: painTerms[1] || '需要快速理解功能、流程和适用场景', platforms: ['CSDN', '掘金'] },
    { level: '评估层', audience: `正在调研${primaryIndustry}方案的企业用户`, painPoint: painTerms[2] || '需要对比方案、案例和部署条件', platforms: ['今日头条', '百家号', 'B站'] },
  ];
}

function buildKeywordStrategy(session: SessionData): KeywordStrategy {
  const productName = getProductName(session);
  const productTerms = unique([productName, session.enterprise.shortName, ...session.wordBank.productTerms]).slice(0, 4);
  const primaryIndustry = getPrimaryIndustry(session);
  const functionTerms = getBusinessTerms(session);
  const painTerms = getPainTerms(session, productName);
  const seedKeyword = session.wordBank.industryTerms[0] || session.enterprise.description || productName;

  return {
    categories: [
      { category: '产品词', examples: productTerms, generationMethod: '自动组合' },
      { category: '功能词', examples: functionTerms, generationMethod: '自动组合' },
      { category: '痛点词', examples: painTerms, generationMethod: 'AI蒸馏' },
      { category: '对比词', examples: [`${productName} vs 竞品`, `${primaryIndustry}工具对比`], generationMethod: 'AI蒸馏' },
      { category: '教程词', examples: [`${productName}使用教程`, `${primaryIndustry}入门指南`], generationMethod: 'AI蒸馏' },
    ],
    distillation: {
      seedKeyword,
      quantity: 30,
      mode: '精准模式',
      questionTypes: ['疑问句', '推荐型', '对比型', '教程型', '案例型'],
    },
    combinations: [
      {
        name: '产品词组合',
        prefixes: ['最好', '推荐', '免费', '企业级', '在线', '2026', '最新'],
        mainKeywords: productTerms.length > 0 ? productTerms : [productName],
        suffixes: ['系统', '软件', '平台', '工具', '教程', '指南'],
      },
      {
        name: '功能词组合',
        prefixes: ['如何', '快速', '一键', '自动'],
        mainKeywords: functionTerms.length > 0 ? functionTerms : productTerms,
        suffixes: ['教程', '方法', '步骤', '指南', '工具'],
      },
      {
        name: '痛点词组合',
        prefixes: ['如何解决', '怎么做', '怎样'],
        mainKeywords: painTerms,
        suffixes: ['问题', '解决方案', '方法', '技巧'],
      },
    ],
    questionMappings: [
      { keyword: `${productName}是什么`, question: `${productName}是什么？适合哪些业务场景？` },
      { keyword: `${productName}教程`, question: `如何从零开始使用${productName}？` },
      { keyword: `${primaryIndustry}怎么做`, question: `${primaryIndustry}有哪些常见方法和工具？` },
      { keyword: `${primaryIndustry}工具`, question: `2026年${primaryIndustry}工具推荐，哪个好用？` },
      { keyword: `${productName}私有化部署`, question: `${productName}是否支持私有化部署？部署前要准备什么？` },
      { keyword: `${productName} vs 竞品`, question: `${productName}和同类产品有什么区别？适合什么场景？` },
    ],
  };
}

function buildKnowledgeDocumentPlan(session: SessionData): KnowledgeDocumentPlan[] {
  const productName = getProductName(session).replace(/\s+/g, '_');
  const primaryIndustry = getPrimaryIndustry(session);
  return [
    {
      priority: '⭐⭐⭐',
      documentType: `${getProductName(session)}产品介绍`,
      filename: `${productName}产品介绍v1.0.pdf`,
      purpose: 'AI了解产品功能',
      tags: ['产品', '功能', '公众号素材'],
      contentPoints: ['产品概述', '解决什么问题', '适用用户', '核心功能', '产品优势', '应用场景'],
    },
    {
      priority: '⭐⭐⭐',
      documentType: `${getProductName(session)}使用手册`,
      filename: `${productName}使用手册.pdf`,
      purpose: '生成教程内容',
      tags: ['教程', '培训', '公众号素材'],
      contentPoints: ['账号准备', '核心功能入口', '典型操作流程', '常见配置项', '结果查看与导出', '常见问题'],
    },
    {
      priority: '⭐⭐⭐',
      documentType: '核心功能详解',
      filename: `${productName}核心功能详解.pdf`,
      purpose: '生成功能介绍内容',
      tags: ['产品', '功能', '技术文章'],
    },
    {
      priority: '⭐⭐⭐',
      documentType: '客户案例集',
      filename: `${productName}客户案例集.pdf`,
      purpose: '生成案例内容',
      tags: ['案例', '客户', '知乎回答'],
      contentPoints: ['客户背景', '使用前痛点', '解决方案', '使用后效果数据', '客户评价'],
    },
    {
      priority: '⭐⭐',
      documentType: '产品对比分析',
      filename: `${productName}_vs_竞品对比.pdf`,
      purpose: '生成对比内容',
      tags: ['对比', '竞品', '技术文章'],
    },
    {
      priority: '⭐⭐',
      documentType: '常见问题FAQ',
      filename: `${productName}常见问题.pdf`,
      purpose: '生成问答内容',
      tags: ['FAQ', '教程', '公众号素材'],
    },
    {
      priority: '⭐',
      documentType: '行业分析报告',
      filename: `${primaryIndustry}行业趋势报告2026.pdf`,
      purpose: '生成行业内容',
      tags: ['行业', '趋势', '36氪素材'],
    },
    {
      priority: '⭐',
      documentType: '技术白皮书',
      filename: `${productName}技术架构白皮书.pdf`,
      purpose: '生成技术内容',
      tags: ['技术', '架构', 'InfoQ素材'],
    },
  ];
}

function buildImageAssetPlan(session: SessionData): ImageAssetPlan[] {
  const slug = getProductName(session).toLowerCase().replace(/\s+/g, '-');
  return [
    { imageType: 'LOGO', filename: `${slug}-logo.png`, size: '512x512px', purpose: '品牌标识', tags: ['品牌', '视觉素材'] },
    { imageType: '产品首页', filename: `${slug}-homepage.png`, size: '1920x1080px', purpose: '产品展示', tags: ['产品', '首页'] },
    { imageType: '核心功能页面', filename: `${slug}-feature.png`, size: '1920x1080px', purpose: '功能展示', tags: ['产品', '核心功能'] },
    { imageType: '典型流程页面', filename: `${slug}-workflow.png`, size: '1920x1080px', purpose: '流程展示', tags: ['产品', '使用流程'] },
    { imageType: '应用场景图', filename: `${slug}-scenario.png`, size: '1920x1080px', purpose: '场景说明', tags: ['场景', '目标用户'] },
    { imageType: '效果对比图', filename: `${slug}-comparison.png`, size: '1920x1080px', purpose: '效果展示', tags: ['案例', '效果证明'] },
  ];
}

function buildContentPlaybook(session: SessionData): ContentGenerationConfig[] {
  const productName = getProductName(session);
  return [
    {
      contentType: '教程类内容',
      suitableKeywords: [`${productName}使用教程`, `${getPrimaryIndustry(session)}入门指南`],
      articleType: '教程',
      articleLength: '长（2000-3000字）',
      style: '实用导向，步骤清晰',
      titleExamples: [
        `${productName}快速上手指南：从场景到结果`,
        `从零开始：如何使用${productName}`,
        `${getPrimaryIndustry(session)}实操：常见问题与解决思路`,
      ],
    },
    {
      contentType: '案例类内容',
      suitableKeywords: [`${getPrimaryIndustry(session)}成功案例`, `企业使用${productName}的效果`],
      articleType: '案例',
      articleLength: '中（1500-2500字）',
      style: '数据驱动，结果导向',
      titleExamples: [
        `某企业如何用${productName}解决${session.enterprise.userPainPoints[0] || '核心业务问题'}`,
        `${productName}真实案例：从问题到效果的完整复盘`,
        `3个成功案例：看企业如何用${productName}提升业务效率`,
      ],
    },
    {
      contentType: '对比类内容',
      suitableKeywords: [`${productName} vs 竞品`, `${getPrimaryIndustry(session)}工具对比`],
      articleType: '对比',
      articleLength: '中（1500-2000字）',
      style: '客观公正，突出优势',
      titleExamples: [
        `${productName} vs 竞品：${getPrimaryIndustry(session)}工具怎么选？`,
        `5款${getPrimaryIndustry(session)}工具对比，${productName}适合什么场景？`,
        `${productName}适合什么企业？一文说清`,
      ],
    },
    {
      contentType: '科普类内容',
      suitableKeywords: [getPrimaryIndustry(session), ...getBusinessTerms(session, 2)],
      articleType: '科普',
      articleLength: '中（1500-2000字）',
      style: '通俗易懂，深入浅出',
      titleExamples: [
        `${getPrimaryIndustry(session)}是什么？企业为什么需要关注`,
        `${getPrimaryIndustry(session)}工具有什么用？适合哪些场景`,
        `2026年${getPrimaryIndustry(session)}趋势：方法、工具与案例`,
      ],
    },
  ];
}

function buildPlatformStrategies(session: SessionData): PlatformStrategy[] {
  const audience = session.enterprise.userPainPoints.length > 0
    ? `关注${session.enterprise.userPainPoints.slice(0, 2).join('、')}的人群`
    : '企业内容运营、市场营销和业务决策人群';

  return [
    {
      order: 1,
      platform: '微信公众号',
      focus: '深度长文、产品介绍',
      tone: '专业严谨、有深度',
      publishTime: '21:00-22:00',
      frequency: '每周1-2篇',
      audience,
      adaptations: ['深度长文', '产品介绍', '客户案例'],
    },
    {
      order: 2,
      platform: '知乎',
      focus: '专业问答、深度分析',
      tone: '客观、顾问式、证据充分',
      publishTime: '18:00-22:00',
      frequency: '每周2-3篇',
      audience,
      adaptations: ['专业问答', '对比分析', '工具推荐'],
    },
    {
      order: 3,
      platform: 'CSDN',
      focus: '技术教程、实操指南',
      tone: '专业、结构化、可引用',
      publishTime: '10:00/21:00',
      frequency: '每周1-2篇',
      audience,
      adaptations: ['技术教程', '实操指南', '使用手册'],
    },
    {
      order: 4,
      platform: '掘金',
      focus: '技术分析、架构解读',
      tone: '技术深度、工程思维',
      publishTime: '11:30/20:00',
      frequency: '每周1篇',
      audience,
      adaptations: ['技术分析', '架构解读', '工程实践'],
    },
    {
      order: 6,
      platform: '今日头条',
      focus: '资讯文章、热点结合',
      tone: '新闻化、通俗易懂',
      publishTime: '早7-9点/晚6-9点',
      frequency: '每周2-3篇',
      audience,
      adaptations: ['资讯文章', '热点结合', '行业科普'],
    },
    {
      order: 7,
      platform: '百家号',
      focus: 'SEO文章、科普内容',
      tone: '结构清晰、易于搜索',
      publishTime: '9:00-11:00',
      frequency: '每周1-2篇',
      audience,
      adaptations: ['SEO文章', '科普内容', 'FAQ'],
    },
    {
      order: 8,
      platform: 'B站专栏',
      focus: '轻松专栏、互动内容',
      tone: '轻松幽默、年轻化',
      publishTime: '17:00-22:00',
      frequency: '每周1篇',
      audience,
      adaptations: ['轻松专栏', '工具体验', '互动话题'],
    },
  ];
}

function buildKnowledgePlanMessage(session: SessionData): string {
  const docs = session.knowledgeBase.documents.slice(0, 8).map((doc, index) => `${index + 1}. ${doc.title}（${doc.type}；标签：${doc.tags?.join('、') || '待补充'}）`).join('\n');
  const images = session.knowledgeBase.images.map((image, index) => `${index + 1}. ${image.alt}（${image.category}；标签：${image.tags?.join('、') || '待补充'}）`).join('\n');
  const tags = session.knowledgeBase.tags.map((tag) => tag.name).join('、');
  const platforms = session.platforms.map((platform) => `${platform.order}. ${platform.platform}：${platform.frequency}，${platform.publishTime}`).join('\n');

  return `产品推广实操手册已生成。

需要准备的文档：
${docs}

需要准备的图片：
${images}

归类标签：
${tags || '待补充'}

已基于企业与产品信息、知识库方案生成内容提示词：
${session.prompts.map((prompt) => `- ${prompt.platform}：${prompt.scenario}`).join('\n')}

平台发布策略：
${platforms}

同时已生成：推广目标、人群分层、关键词策略、内容生成实操、效果追踪与优化。

配置已完成，可以下载产品推广实操手册。`;
}

export const knowledgeStage: StageHandler = {
  stage: 'knowledge',
  questions,

  getIntroMessage(): string {
    return '接下来构建知识库。知识库用于为内容生成提供真实产品信息、案例、资料和图片依据，减少模型幻觉。';
  },

  handleInput(session: SessionData, questionId: string, input: string): StageResult {
    const question = questions.find((q) => q.id === questionId);
    if (!question) {
      return {
        messages: [makeMessage('system', '未知问题，请重试')],
        sessionData: session,
        stageComplete: false,
        allComplete: false,
      };
    }

    if (question.validator) {
      const result = question.validator(input);
      if (!result.valid) {
        return {
          messages: [makeMessage('system', result.error ?? '输入无效，请重试')],
          sessionData: session,
          stageComplete: false,
          allComplete: false,
        };
      }
    }

    const userMsg = makeMessage('user', input);
    const materials = splitList(input);
    const promotionGoal = buildPromotionGoal(session);
    const updated: SessionData = {
      ...session,
      currentStage: 'knowledge',
      promotionGoal,
      audienceSegments: buildAudienceSegments(session),
      knowledgeBase: {
        documents: buildDocumentPlan(materials, session),
        images: buildImagePlan(session),
        tags: buildTags(materials, session),
      },
      knowledgePlan: buildKnowledgeDocumentPlan(session),
      imagePlan: buildImageAssetPlan(session),
      keywordStrategy: buildKeywordStrategy(session),
      contentPlaybook: buildContentPlaybook(session),
      trackingPlan: buildTrackingPlan(),
    };
    updated.prompts = buildPlatformPrompts(updated);
    updated.platforms = buildPlatformStrategies(updated);

    return {
      messages: [userMsg, makeMessage('system', buildKnowledgePlanMessage(updated))],
      sessionData: updated,
      stageComplete: true,
      allComplete: true,
    };
  },

  isComplete(session: SessionData): boolean {
    return session.knowledgeBase.documents.length > 0 && session.prompts.length > 0 && session.platforms.length > 0;
  },
};
