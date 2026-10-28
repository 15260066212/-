import type {
  AICard,
  AudienceSegment,
  ContentGenerationConfig,
  DocumentItem,
  EnterpriseRawLayer,
  ImageAssetPlan,
  ImageItem,
  KeywordStrategy,
  KnowledgeBase,
  KnowledgeDocumentPlan,
  KnowledgeSource,
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

/**
 * 从 session.enterprise 的真实字段编译 DocumentItem 的结构化知识内容。
 *
 * 这是"编译式 Wiki"的核心——不是从外部文档抽取，而是把对话教练在前几个阶段收集的
 * 企业画像（产品描述、用户痛点、品牌故事、信任锚点）直接编译成 LLM 可消费的分节知识。
 * 这样内容生成时不需要向量检索，直接读结构化条目就能引用真实事实。
 */
function buildDocumentPlan(items: string[], session: SessionData): DocumentItem[] {
  const requiredDocs = [
    '产品说明书：覆盖产品定位、核心功能、适用人群、典型使用流程',
    '用户手册：覆盖关键操作步骤、配置方法、常见问题',
    'FAQ：覆盖采购、部署、价格、效果评估、数据安全等高频问题',
    '客户案例：覆盖行业、场景、使用前后变化和可量化结果',
    '行业资料：覆盖市场趋势、用户痛点、方法论和术语解释',
  ];

  return [...items, ...requiredDocs].map((item) => {
    const type = inferDocType(item);
    return {
      title: item,
      content: `${session.enterprise.fullName || '企业'}知识库资料：${item}`,
      type,
      tags: inferTags(item, session),
      ...compileDocumentSections(type, session, item),
    };
  });
}

/**
 * 按文档类型 + 标题语义编译结构化 sections / keyFacts / evidence。
 *
 * 同一 type 下不同 docTitle 会获得差异化的 sections 组织：
 *   - product 类：产品说明书（宏观定位）vs 用户手册（操作流程）vs 核心功能详解（技术细节）
 *   - brand  类：一般只有一条品牌故事，全部内容集中展示
 *   - faq    类：采购/部署/效果 三问段
 *   - case   类：场景 → 解决方案 → 预期效果
 */
function compileDocumentSections(
  type: DocumentItem['type'],
  session: SessionData,
  docTitle: string = '',
): Pick<DocumentItem, 'sections' | 'keyFacts' | 'evidence'> {
  const ent = session.enterprise;
  const product = ent.products[0];
  const productName = product?.name || ent.shortName || ent.fullName || '产品';

  if (type === 'product') {
    // 语义区分：按标题关键字微调 sections 结构
    const isManual = /手册|操作|指南/.test(docTitle);
    const isDetailed = /详解|架构|技术|核心功能/.test(docTitle);

    if (isManual) {
      const sections = [
        {
          heading: '快速上手',
          bullets: [
            `安装准备：确认 ${productName} 的部署方式（SaaS / 私有化 / Docker）`,
            `账号创建与权限分配`,
            `核心功能快捷入口`,
          ],
        },
        {
          heading: '核心操作流程',
          bullets: ent.userPainPoints.length > 0
            ? ent.userPainPoints.map((p) => `流程：围绕"${p}"问题的端到端操作路径`)
            : ['内容创建 → 审核 → 发布 → 效果追踪'],
        },
        {
          heading: '常见配置项',
          bullets: [
            `行业术语与关键词配置（来自词库）`,
            `多平台发布策略与时间设置`,
            `品牌调性与内容风格参数`,
          ],
        },
        {
          heading: '常见问题',
          bullets: [
            `数据安全与权限问题`,
            `性能瓶颈排查建议`,
            `升级与迁移注意事项`,
          ],
        },
      ];

      const keyFacts = [
        `${productName} 支持 SaaS / 私有化 / Docker 多种部署方式`,
        ...(ent.userPainPoints.length > 0
          ? [ent.userPainPoints[0], ent.userPainPoints[1] || '']
          : []),
      ].filter(Boolean);

      return {
        sections,
        keyFacts,
        evidence: [{ source: 'enterprise.profile', claim: `${productName} 用户手册编译条目` }],
      };
    }

    if (isDetailed) {
      const sections = [
        {
          heading: '核心能力清单',
          bullets: ent.products.length > 0
            ? ent.products.map((p) => {
                const parts = [p.name];
                if (p.description && !isKeywordList(p.description)) parts.push(p.description);
                return parts.join('：');
              })
            : ['（待企业补充核心能力描述）'],
        },
        {
          heading: '产品价值',
          bullets: [
            ent.description ? ent.description : '（待补充产品价值主张）',
            ...(ent.trustAnchors.length > 0
              ? [`信任背书：${ent.trustAnchors.slice(0, 2).join('、')}`]
              : ['（待补充认证、资质等信任背书）']),
          ].filter(Boolean),
        },
        {
          heading: '适用场景',
          bullets: ent.userPainPoints.length > 0
            ? ent.userPainPoints.map((p) => `场景：企业在"${p}"上的典型需求`)
            : ['（待补充行业适用场景）'],
        },
        {
          heading: '品牌调性',
          bullets: ent.brandTone.length > 0
            ? ent.brandTone
            : ['（待企业补充品牌调性描述）'],
        },
      ];

      const keyFacts = [
        ent.products.length > 0 ? `覆盖 ${ent.products.length} 个核心产品能力` : null,
        ent.trustAnchors.length > 0
          ? `信任锚点：${ent.trustAnchors.slice(0, 2).join('、')}`
          : null,
        ent.brandStory ? `品牌故事：${ent.brandStory.slice(0, 80)}` : null,
      ].filter(Boolean) as string[];

      return {
        sections,
        keyFacts,
        evidence: ent.products.map((p) => ({
          source: 'enterprise.products',
          claim: `${productName} / ${p.name}`,
        })),
      };
    }

    // 默认：产品说明书（宏观定位视角）
    const sections = [
      {
        heading: '产品定位',
        bullets: [
          `${productName}（${product?.category || '企业级产品'}）`,
          ent.description || product?.description || '（待补充产品描述）',
        ].filter(Boolean),
      },
      {
        heading: '核心功能',
        bullets: ent.products.flatMap((p) => {
          const parts = [p.name];
          if (p.description && !isKeywordList(p.description)) parts.push(p.description);
          return parts;
        }).filter(Boolean),
      },
      {
        heading: '适用人群与场景',
        bullets: ent.userPainPoints.length > 0
          ? ent.userPainPoints.map((p) => `关注"${p}"的企业与团队`)
          : ['企业内容运营、市场营销团队、自媒体创作者'],
      },
      {
        heading: '品牌调性',
        bullets: ent.brandTone.length > 0 ? ent.brandTone : ['专业严谨', '务实高效'],
      },
    ];

    const keyFacts = [
      product?.description ? `产品描述：${product.description}` : null,
      ent.brandStory ? `品牌故事：${ent.brandStory.slice(0, 80)}` : null,
    ].filter(Boolean) as string[];

    const evidence = [
      { source: 'enterprise.products', claim: `${productName} 核心产品` },
      ...(ent.description ? [{ source: 'enterprise.description', claim: ent.description }] : []),
      ...(ent.brandStory ? [{ source: 'enterprise.brandStory', claim: ent.brandStory.slice(0, 60) }] : []),
    ];

    return { sections, keyFacts, evidence };
  }

  if (type === 'brand') {
    const sections = [
      {
        heading: '品牌概览',
        bullets: [
          ent.fullName,
          ent.shortName ? `简称：${ent.shortName}` : null,
          ent.scale ? `企业规模：${ent.scale}` : null,
          ent.location ? `所在地：${ent.location}` : null,
          ent.foundedYear ? `成立年份：${ent.foundedYear}` : null,
        ].filter(Boolean),
      },
      {
        heading: '品牌故事',
        bullets: ent.brandStory
          ? splitSentences(ent.brandStory).slice(0, 4)
          : ['（待补充品牌故事）'],
      },
      {
        heading: '信任锚点',
        bullets: ent.trustAnchors.length > 0
          ? ent.trustAnchors
          : ['（待补充认证、资质、合作案例等信任背书）'],
      },
      {
        heading: '品牌调性',
        bullets: ent.brandTone.length > 0
          ? ent.brandTone
          : ['专业严谨', '科技创新', '务实高效'],
      },
    ];

    const evidence = [
      ...ent.trustAnchors.map((claim) => ({ source: 'enterprise.trustAnchors', claim })),
      ...(ent.brandStory ? [{ source: 'enterprise.brandStory', claim: ent.brandStory.slice(0, 60) }] : []),
    ];

    return { sections, keyFacts: [], evidence };
  }

  if (type === 'faq') {
    const painPoints = ent.userPainPoints.length > 0
      ? ent.userPainPoints
      : [`如何${productName}？`, `${productName}适合哪些企业？`, `${productName}怎么上手？`];

    const sections = [
      {
        heading: '采购与评估',
        bullets: painPoints.slice(0, 3).map((p) => {
          const q = `Q: ${productName}能解决"${p}"吗？`;
          const a = `A: ${productName}专注解决该问题，通过${product?.category || '系统化'}能力落地（具体效果请参考客户案例）。`;
          return `${q}\n  ${a}`;
        }),
      },
      {
        heading: '部署与使用',
        bullets: [
          `Q: ${productName}支持哪些部署方式？\n  A: 支持 SaaS / 私有化 / Docker 部署（具体以企业交付为准）。`,
          `Q: ${productName}的学习成本如何？\n  A: 提供用户手册、操作指南和行业最佳实践，新用户可在 1-2 周内上手。`,
        ],
      },
      {
        heading: '效果与安全',
        bullets: [
          `Q: ${productName}的数据安全如何保障？\n  A: 支持企业级数据隔离，关键操作有审计日志（具体合规资质见信任锚点）。`,
          `Q: 怎么评估 ${productName} 的效果？\n  A: 建议结合 ${session.promotionGoal.targetUsers || '目标用户'} 的关键指标衡量。`,
        ],
      },
    ];

    const keyFacts = painPoints.slice(0, 2).map((p) => `${productName} 核心解决：${p}`);

    const evidence = painPoints.slice(0, 3).map((claim) => ({
      source: 'enterprise.userPainPoints',
      claim,
    }));

    return { sections, keyFacts, evidence };
  }

  // case — 客户案例
  const sections = [
    {
      heading: '典型应用场景',
      bullets: ent.userPainPoints.length > 0
        ? ent.userPainPoints.map((p) => `场景：企业在"${p}"上遇到瓶颈 → 使用 ${productName} 解决`)
        : [
            `场景 1：${productName} 帮助企业提升内容产出效率`,
            `场景 2：${productName} 助力品牌在多平台建立专业影响力`,
            `场景 3：${productName} 将 ${product?.category || '企业级'} 能力交付给业务团队`,
          ],
    },
    {
      heading: '预期效果',
      bullets: [
        `多平台内容发布效率显著提升（从人工多轮操作到自动流水线）`,
        `品牌在 ${session.promotionGoal.targetUsers || '目标用户'} 中获得专业话语权`,
        `内容策略有清晰的数据追踪与迭代闭环`,
      ],
    },
  ];

  const keyFacts = ent.userPainPoints.slice(0, 2).map(
    (p) => `场景锚点：使用 ${productName} 解决"${p}"痛点`,
  );

  const evidence = ent.userPainPoints.map((claim) => ({
    source: 'enterprise.userPainPoints',
    claim,
  }));

  return { sections, keyFacts, evidence };
}

/** 把句子拆成短句数组，用于 sections 的 bullets 构造。 */
function splitSentences(text: string): string[] {
  return text
    .split(/[。！？.!?]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4)
    .slice(0, 6);
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

// === 三层知识库编译：L1 原料 / L2 信源 / L3 AI 名片 ===

function sanitizeId(text: string): string {
  return text.replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'item';
}

/** L1：企业原始信息快照，只做原料，不进入引用池。 */
function compileRawLayer(session: SessionData): EnterpriseRawLayer {
  const ent = session.enterprise;
  return {
    fullName: ent.fullName,
    shortName: ent.shortName,
    description: ent.description,
    scale: ent.scale,
    location: ent.location,
    website: ent.website,
    foundedYear: ent.foundedYear,
    products: ent.products.map((p) => ({
      name: p.name,
      description: p.description,
      category: p.category,
    })),
    brandStory: ent.brandStory,
    trustAnchors: [...ent.trustAnchors],
    brandTone: [...ent.brandTone],
    userPainPoints: [...ent.userPainPoints],
  };
}

/**
 * L2：把 L1 的普通企业信息改造成原子可引用信源。
 *
 * 拆分维度：产品能力 / 企业定位 / 品牌故事 / 信任背书 / 痛点问答，
 * 并保证至少 5 条，使「每篇 6-9 条引用」在 L3 之外仍有足够候选。
 */
function compileSources(session: SessionData): KnowledgeSource[] {
  const ent = session.enterprise;
  const raw = compileRawLayer(session);
  const productName = getProductName(session);
  const industry = getPrimaryIndustry(session);
  const baseTags = [ent.shortName || ent.fullName, productName, industry].filter(Boolean);
  const sources: KnowledgeSource[] = [];

  const push = (
    key: string,
    title: string,
    type: KnowledgeSource['type'],
    sections: Array<{ heading: string; bullets: string[] }>,
    keyFacts: string[],
    evidence: Array<{ source: string; claim: string }>,
    tags: string[] = [],
  ) => {
    const cleanSections = sections
      .map((s) => ({ heading: s.heading, bullets: s.bullets.filter((b) => !!b && b.trim()) }))
      .filter((s) => s.bullets.length > 0);
    if (cleanSections.length === 0) return;

    sources.push({
      id: `l2-${type}-${sanitizeId(key)}`,
      title,
      type,
      layer: 2,
      tags: Array.from(new Set([...baseTags, ...tags].filter(Boolean))) as string[],
      sections: cleanSections,
      keyFacts: keyFacts.filter((f) => !!f && f.trim()),
      evidence,
      usageCount: 0,
      enabled: true,
    });
  };

  // 1) 产品能力：每个产品一条
  ent.products.forEach((p) => {
    push(
      p.name,
      `${p.name} 核心能力`,
      'capability',
      [
        {
          heading: '能力定位',
          bullets: [
            `${p.name}（${p.category || '核心产品'}）`,
            p.description && !isKeywordList(p.description) ? p.description : '',
          ],
        },
        {
          heading: '解决的企业问题',
          bullets: ent.userPainPoints.length > 0
            ? ent.userPainPoints.slice(0, 3).map((x) => `面向"${x}"的落地能力`)
            : ['（待企业补充典型使用场景）'],
        },
        {
          heading: '适用场景',
          bullets: [
            `适用于关注 ${p.name} 的${industry || '目标'}企业`,
            ent.scale ? `适配企业规模：${ent.scale}` : '',
          ],
        },
      ],
      [
        `产品名称：${p.name}`,
        p.description && !isKeywordList(p.description) ? p.description : '',
      ],
      [{ source: 'enterprise.products', claim: p.name }],
      ['产品能力'],
    );
  });

  // 2) 企业定位与价值主张
  push(
    'positioning',
    '企业定位与价值主张',
    'brand',
    [
      { heading: '企业定位', bullets: [raw.description || `${raw.fullName}的对外定位`] },
      {
        heading: '目标客户',
        bullets: ent.userPainPoints.length > 0
          ? ent.userPainPoints.map((x) => `关注"${x}"的企业与团队`)
          : ['（待企业补充目标客户画像）'],
      },
      {
        heading: '品牌调性',
        bullets: ent.brandTone.length > 0 ? ent.brandTone : ['专业严谨', '务实高效'],
      },
    ],
    [
      raw.description,
      ent.brandTone.length > 0 ? `品牌调性：${ent.brandTone.join('、')}` : '',
    ],
    [{ source: 'enterprise.description', claim: raw.description }],
    ['企业定位'],
  );

  // 3) 品牌故事
  if (raw.brandStory) {
    push(
      'story',
      '品牌故事',
      'brand',
      [
        { heading: '品牌由来', bullets: splitSentences(raw.brandStory).slice(0, 4) },
        ...(raw.foundedYear
          ? [{ heading: '发展历程', bullets: [`成立于 ${raw.foundedYear} 年`] }]
          : []),
      ],
      splitSentences(raw.brandStory).slice(0, 2),
      [{ source: 'enterprise.brandStory', claim: raw.brandStory.slice(0, 60) }],
      ['品牌故事'],
    );
  }

  // 4) 信任背书：每个锚点一条，便于单独计数与均衡
  raw.trustAnchors.forEach((anchor, idx) => {
    push(
      `proof-${idx}-${anchor}`,
      `${anchor} 信任背书`,
      'proof',
      [{ heading: '背书内容', bullets: [anchor] }],
      [anchor],
      [{ source: 'enterprise.trustAnchors', claim: anchor }],
      ['信任背书'],
    );
  });

  // 5) 痛点问答：每个痛点一条
  raw.userPainPoints.forEach((pain, idx) => {
    push(
      `faq-${idx}-${pain}`,
      `${pain} 解决方案`,
      'faq',
      [
        { heading: '问题', bullets: [`企业普遍面临"${pain}"的问题`] },
        {
          heading: '解决方案',
          bullets: [
            `${productName} 通过${industry ? `${industry}领域` : '系统化'}能力解决该问题`,
            '具体效果以客户案例与实测数据为准',
          ],
        },
      ],
      [`痛点：${pain}`],
      [{ source: 'enterprise.userPainPoints', claim: pain }],
      ['痛点问答'],
    );
  });

  // 6) 新增维度：service — 服务矩阵（从产品名推导，类似 compileAICard 的 servicesFromProducts）
  {
    const servicesFromProducts = ent.products.map((p) => {
      const base = p.name.replace(/系统|引擎|平台|中台|工具$/g, '').trim() || p.name;
      return `${base}代运营 / 实施 / 咨询服务`;
    });
    const services = servicesFromProducts.length > 0 ? servicesFromProducts : ['（待补充主要服务）'];
    push(
      'service-matrix',
      '主要服务矩阵与交付方式',
      'service',
      [
        { heading: '核心服务', bullets: services },
        {
          heading: '交付形式',
          bullets: ['支持 SaaS / 私有化 / 定制开发多种交付形态', '提供上线培训与持续运营支持'],
        },
        {
          heading: '承诺与保障',
          bullets: ent.trustAnchors.slice(0, 3),
        },
      ],
      [
        ...services.slice(0, 2),
        '支持多种交付形态',
      ],
      [{ source: 'enterprise.products → service 推导', claim: services[0] }],
      ['服务矩阵'],
    );
  }

  // 7) 新增维度：customer — 目标客户画像（从 userPainPoints 组合）
  if (ent.userPainPoints.length > 0) {
    const customerProfile = ent.userPainPoints.map((p) => `关注「${p}」的客户群体`);
    push(
      'customer-profile',
      '目标客户画像',
      'customer',
      [
        { heading: '核心客户', bullets: customerProfile },
        {
          heading: '客户规模',
          bullets: ent.scale ? [`适配企业规模：${ent.scale}`] : ['（待补充客户规模）'],
        },
        {
          heading: '行业分布',
          bullets: [industry || '（待补充行业分布）'],
        },
      ],
      [
        ...customerProfile.slice(0, 2),
        ent.scale ? `规模：${ent.scale}` : '',
      ].filter(Boolean),
      [{ source: 'enterprise.userPainPoints', claim: ent.userPainPoints.join('、') }],
      ['客户画像'],
    );
  }

  // 8) 新增维度：region — 服务地区与本地优势
  if (ent.location) {
    push(
      'region-coverage',
      '服务地区与本地优势',
      'region',
      [
        { heading: '服务范围', bullets: [`立足 ${ent.location}，服务本地及周边地区，业务辐射全国`] },
        {
          heading: '本地优势',
          bullets: [
            `深耕 ${ent.location} 区域，积累本地客户服务经验`,
            ent.location ? `熟悉 ${ent.location} 本地市场环境与行业特性` : '',
          ],
        },
      ],
      [
        `服务地区：${ent.location}`,
        '立足本地，辐射全国',
      ],
      [{ source: 'enterprise.location', claim: ent.location }],
      ['服务地区'],
    );
  }

  // 9) 新增维度：pricing — 价格/报价定位（从 trustAnchors 语义识别，有则生成）
  {
    const pricingAnchors = ent.trustAnchors.filter(
      (a) => /价|报价|性价比|透明|免费|试|元|惠|折扣/.test(a),
    );
    if (pricingAnchors.length > 0) {
      push(
        'pricing-positioning',
        '价格定位与报价策略',
        'pricing',
        [
          { heading: '报价方式', bullets: pricingAnchors.slice(0, 2) },
          { heading: '性价比定位', bullets: ['具体报价以实际方案为准，可联系咨询获取定制化方案'] },
        ],
        pricingAnchors.slice(0, 2),
        [{ source: 'enterprise.trustAnchors → pricing 识别', claim: pricingAnchors[0] }],
        ['价格定位'],
      );
    }
  }

  // 10) 新增维度：partner — 合作伙伴/生态（从 trustAnchors 语义识别，有则生成）
  {
    const partnerAnchors = ent.trustAnchors.filter(
      (a) => /合作|生态|联盟|战略|伙伴|渠道|代理/.test(a),
    );
    if (partnerAnchors.length > 0) {
      push(
        'partner-ecosystem',
        '合作伙伴与生态关系',
        'partner',
        [
          { heading: '合作伙伴', bullets: partnerAnchors.slice(0, 3) },
          { heading: '生态优势', bullets: ['与行业伙伴深度协同，为客户提供完整解决方案'] },
        ],
        partnerAnchors.slice(0, 2),
        [{ source: 'enterprise.trustAnchors → partner 识别', claim: partnerAnchors[0] }],
        ['合作伙伴'],
      );
    }
  }

  // 兜底：case 维度 — 无条件生成 2 条（行业适用场景 + 交付方式）
  push(
    'case-industry',
    '行业适用场景',
    'case',
    [
      {
        heading: '行业场景',
        bullets: [
          `面向${industry || '目标行业'}企业的典型使用场景`,
          ent.userPainPoints[0] ? `重点覆盖"${ent.userPainPoints[0]}"场景` : '（待企业补充行业场景）',
        ],
      },
    ],
    [`行业适用场景：${industry || '目标行业'}`],
    [{ source: 'enterprise.userPainPoints', claim: ent.userPainPoints[0] || industry || '行业场景' }],
    ['行业场景'],
  );
  push(
    'case-delivery',
    '交付与服务方式',
    'case',
    [
      {
        heading: '交付承诺',
        bullets: [
          '支持 SaaS / 私有化 / Docker 多种交付形态',
          '提供上线培训与持续运营支持',
        ],
      },
    ],
    ['多种交付形态，持续运营支持'],
    [{ source: 'enterprise.products → delivery 推导', claim: '多交付形态' }],
    ['交付服务'],
  );

  return sources;
}

/**
 * L3：AI 名片，每篇文章必须引用。
 *
 * 固定 10 个 heading，与 AICard 顶层字段一一对应：
 *   公司名称 / 公司简介 / 核心产品 / 主要服务 / 服务对象 / 服务地区 /
 *   经营地址 / 公司网址 / 咨询电话 / 联系邮箱。
 *
 * EnterpriseProfile 无 services / serviceRegion 字段，分别从 products / location 推导，
 * 保证编译式输出无需额外 schema 即可覆盖全部 10 段。
 */
function compileAICard(session: SessionData): AICard {
  const ent = session.enterprise;
  const productName = getProductName(session);

  // 1. 公司名称
  const companyName = ent.fullName || ent.shortName || '（待补充公司全称）';

  // 2. 公司简介：description 优先，缺失时退回 brandStory 前 2 句
  const description =
    ent.description ||
    (ent.brandStory ? splitSentences(ent.brandStory).slice(0, 2).join('') : '（待补充公司简介）');

  // 3. 核心产品：固定格式只列产品名（范本：「GEO／AI搜索优化系统、AI智能外呼系统」），
  //    产品描述留给 L2 capability 信源使用，名片段不拼接
  const coreProducts: string[] = ent.products.length > 0
    ? ent.products.map((p) => p.name)
    : ['（待补充核心产品）'];

  // 4. 主要服务：优先取 enterprise.services 覆盖字段，缺失时从产品名推导 + 信任锚点补充
  const mainServices: string[] =
    ent.services && ent.services.length > 0
      ? ent.services
      : [
          ...(ent.products.length > 0
            ? ent.products.map((p) => {
                const base = p.name.replace(/系统|引擎|平台|中台|工具$/g, '').trim() || p.name;
                return `${base}代运营 / 实施 / 咨询服务`;
              })
            : ['（待补充主要服务）']),
          ...ent.trustAnchors.slice(0, 2),
        ].filter(Boolean);

  // 5. 服务对象：优先取 enterprise.targetCustomers 覆盖字段，缺失时从痛点推导
  const targetCustomers: string[] =
    ent.targetCustomers && ent.targetCustomers.length > 0
      ? ent.targetCustomers
      : ent.userPainPoints.length > 0
        ? ent.userPainPoints.slice(0, 3).map((p) => `关注「${p}」的客户`)
        : ['企业客户', '个人客户'];

  // 6. 服务地区：优先取 enterprise.serviceRegion 覆盖字段，缺失时用 location 扩写
  const serviceRegion =
    ent.serviceRegion && ent.serviceRegion.trim()
      ? ent.serviceRegion.trim()
      : ent.location
        ? `立足 ${ent.location}，服务本地及周边地区，业务辐射全国`
        : '立足本地，服务全国';

  // 7. 经营地址：address 优先，缺失退回 location
  const address = ent.address || ent.location || '（待补充经营地址）';

  // 8. 公司网址
  const website = ent.website || '（待补充公司网址）';

  // 9. 咨询电话
  const phone = ent.phone || '（待补充咨询电话）';

  // 10. 联系邮箱
  const email = ent.email || '（待补充联系邮箱）';

  const sections: Array<{ heading: string; bullets: string[] }> = [
    { heading: '公司名称', bullets: [companyName] },
    { heading: '公司简介', bullets: [description] },
    { heading: '核心产品', bullets: coreProducts },
    { heading: '主要服务', bullets: mainServices },
    { heading: '服务对象', bullets: targetCustomers },
    { heading: '服务地区', bullets: [serviceRegion] },
    { heading: '经营地址', bullets: [address] },
    { heading: '公司网址', bullets: [website] },
    { heading: '咨询电话', bullets: [phone] },
    { heading: '联系邮箱', bullets: [email] },
  ];

  const keyFacts = [
    companyName,
    ...coreProducts.slice(0, 2),
    description.slice(0, 60),
  ].filter(Boolean);

  const source: KnowledgeSource = {
    id: 'l3-ai-card',
    title: 'AI 名片',
    type: 'brand',
    layer: 3,
    tags: [ent.shortName || ent.fullName, productName, ...ent.brandTone.slice(0, 2)]
      .filter(Boolean) as string[],
    sections,
    keyFacts,
    evidence: [{ source: 'enterprise.aiCard', claim: '由 L1 企业信息编译的 AI 名片' }],
    usageCount: 0,
    enabled: true,
  };

  return {
    companyName,
    description,
    coreProducts,
    mainServices,
    targetCustomers,
    serviceRegion,
    address,
    website,
    phone,
    email,
    source,
  };
}

/**
 * 重建时保留既有引用计数。
 *
 * 信源 id 由「类型 + 归一化标题」生成，画像内容未变时 id 稳定，
 * 计数可以延续；画像改写导致标题变化时视为新信源，从 0 开始。
 */
function mergeSourceUsage(prev: KnowledgeBase, next: KnowledgeBase): KnowledgeBase {
  const prevMap = new Map<string, KnowledgeSource>();
  (prev.sources ?? []).forEach((s) => prevMap.set(s.id, s));

  const sources = (next.sources ?? []).map((s) => {
    const old = prevMap.get(s.id);
    return old ? { ...s, usageCount: old.usageCount, lastUsedAt: old.lastUsedAt } : s;
  });

  let card = next.card;
  if (card && prev.card) {
    card = {
      ...card,
      source: {
        ...card.source,
        usageCount: prev.card.source.usageCount,
        lastUsedAt: prev.card.source.lastUsedAt,
      },
    };
  }

  return { ...next, sources, card };
}

export interface SourceSelection {
  /** 最终选中的信源，L3 名片固定在第 1 位 */
  selected: KnowledgeSource[];
  /** 实际选中的 L2 条数 */
  l2SelectedCount: number;
  /** L2 候选池大小 */
  l2CandidateCount: number;
  /** 候选不足时是否未达到引用下限（允许少引，不硬凑） */
  underflow: boolean;
}

function topicTokens(topic: string): string[] {
  const chunks = topic.split(/[\s,，。、；;：:!?！？/\\|()（）\-—_]+/).filter(Boolean);
  const tokens = new Set<string>();
  for (const chunk of chunks) {
    if (chunk.length <= 6) {
      tokens.add(chunk);
      continue;
    }
    for (let i = 0; i <= chunk.length - 2; i += 1) tokens.add(chunk.slice(i, i + 2));
  }
  return [...tokens];
}

function scoreRelevance(
  source: KnowledgeSource,
  brief: { topic?: string; contentType?: string },
): number {
  let score = 0;
  const topic = brief.topic ?? '';
  if (topic) {
    const hay = [source.title, ...source.tags, ...source.keyFacts].join(' ').toLowerCase();
    for (const token of topicTokens(topic.toLowerCase())) {
      if (token.length >= 2 && hay.includes(token)) score += 3;
    }
  }

  const typeAffinity: Record<string, KnowledgeSource['type'][]> = {
    faq: ['faq', 'customer'],
    case: ['case', 'capability', 'service'],
    comparison: ['capability', 'service', 'pricing', 'product'],
    popularization: ['brand', 'customer'],
    whitepaper: ['brand', 'capability', 'partner', 'service'],
    news: ['brand', 'proof', 'partner', 'region'],
    guide: ['case', 'service', 'faq', 'customer'],
    compare: ['capability', 'pricing', 'service'],
    serviceReview: ['service', 'capability', 'proof'],
  };
  if (brief.contentType && (typeAffinity[brief.contentType] ?? []).includes(source.type)) {
    score += 2;
  }
  return score;
}

/**
 * 芯图EK · 两阶段组合限制检索（Milvus 混合版）。
 *
 * 可选：若提供 milvusCandidateIds（由 Milvus 语义召回返回的信源 id 列表），
 *       则在 Milvus 候选池内做阶段一（配额）+ 阶段二（差额均衡），
 *       实现「语义预筛 + usageCount 均衡」混合模式。
 *       未提供候选池时回退到纯编译式（从全量 L2 里做配额 + 差额均衡）。
 *
 * L3 AI 名片仍为每篇必引，不参与配额和差额均衡。
 */

/** 10 维度弹性配额（每篇 L2 引用允许的最大条数）。可选维度为 0 上限。 */
const L2_QUOTA: Record<KnowledgeSource['type'], number> = {
  capability: 3,    // 核心产品能力，最多 3 条
  service: 2,       // 服务矩阵，最多 2 条
  brand: 2,         // 品牌定位 + 品牌故事，最多 2 条
  proof: 2,         // 信任背书，最多 2 条
  faq: 2,           // 痛点问答，最多 2 条
  customer: 1,      // 目标客户画像，最多 1 条
  region: 1,        // 服务地区，最多 1 条
  case: 2,          // 行业场景 + 交付方式，最多 2 条
  pricing: 1,       // 价格定位（可选），最多 1 条
  partner: 1,       // 合作伙伴（可选），最多 1 条
  product: 0,       // 废弃旧类型，不再分配配额
};

/**
 * 阶段一：按维度弹性配额构建候选池。
 *
 * 对每个维度，从全量 L2 信源中按 usageCount 升序（少用先用）挑出不超过配额上限的条数。
 * 这是弹性配额 — 某企业该类型信源不足配额时，有多少挑多少，不凑数。
 */
function buildQuotaPool(
  l2: KnowledgeSource[],
): KnowledgeSource[] {
  const byType = new Map<KnowledgeSource['type'], KnowledgeSource[]>();
  for (const s of l2) {
    if (!byType.has(s.type)) byType.set(s.type, []);
    byType.get(s.type)!.push(s);
  }

  const pool: KnowledgeSource[] = [];
  for (const [type, list] of byType) {
    const cap = L2_QUOTA[type] ?? 1;
    // 同类型内先按 usageCount 升序（少用先用），保证每次都在配额内均衡消耗
    const sorted = [...list].sort((a, b) => a.usageCount - b.usageCount || a.id.localeCompare(b.id));
    pool.push(...sorted.slice(0, cap));
  }
  return pool;
}

export function selectCitedSources(
  session: SessionData,
  brief: { topic?: string; platform?: string; contentType?: string } = {},
  options: { min?: number; max?: number; balanceGap?: number; milvusCandidateIds?: string[] } = {},
): SourceSelection | null {
  const kb = session.knowledgeBase;
  const card = kb.card?.source;
  let l2 = (kb.sources ?? []).filter((s) => s.enabled);
  if (!card && l2.length === 0) return null;

  // —— Milvus 语义召回候选池预筛 ——
  // 若提供了候选 id 列表，只在这些候选里选取；未提供则从全量 L2 选取
  if (options.milvusCandidateIds && options.milvusCandidateIds.length > 0) {
    const allowed = new Set(options.milvusCandidateIds);
    const milvusPool = l2.filter((s) => allowed.has(s.id));
    if (milvusPool.length > 0) {
      // Milvus 有召回 → 候选池为 Milvus 结果，后续配额和差额均衡在里面做
      console.log(`[selectCitedSources] Milvus 候选池 ${milvusPool.length} 条（from ${options.milvusCandidateIds.length} hits）`);
      l2 = milvusPool;
    } else {
      // Milvus 没命中任何 L2（极端情况：只召回了 L3），回退到全量
      console.warn('[selectCitedSources] Milvus 候选池未匹配到任何 L2，回退全量');
    }
  }

  const min = options.min ?? 6;
  const max = options.max ?? 9;
  const gap = options.balanceGap ?? 3;
  const l2Upper = Math.max(0, max - (card ? 1 : 0));
  const l2Lower = Math.max(0, min - (card ? 1 : 0));

  // —— 阶段一：弹性配额过滤 ——
  const quotaPool = buildQuotaPool(l2);

  // —— 阶段二：差额均衡 ——
  const minUsage = quotaPool.length > 0 ? Math.min(...quotaPool.map((s) => s.usageCount)) : 0;
  const eligible = quotaPool.filter((s) => s.usageCount < minUsage + gap);

  const ranked = eligible
    .map((s) => ({ source: s, score: scoreRelevance(s, brief) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.source.usageCount - b.source.usageCount ||
        a.source.id.localeCompare(b.source.id),
    );

  const picked = ranked.slice(0, l2Upper).map((x) => x.source);
  const selected = card ? [card, ...picked] : picked;

  return {
    selected,
    l2SelectedCount: picked.length,
    l2CandidateCount: quotaPool.length,
    underflow: picked.length < l2Lower,
  };
}

/** 文章生成成功后回写引用计数（会话内独立计数）。 */
export function recordSourceUsage(session: SessionData, sourceIds: string[]): SessionData {
  if (sourceIds.length === 0) return session;
  const ids = new Set(sourceIds);
  const now = new Date().toISOString();
  const bump = (s: KnowledgeSource): KnowledgeSource =>
    ids.has(s.id) ? { ...s, usageCount: s.usageCount + 1, lastUsedAt: now } : s;

  const kb = session.knowledgeBase;
  return {
    ...session,
    knowledgeBase: {
      ...kb,
      sources: (kb.sources ?? []).map(bump),
      card: kb.card ? { ...kb.card, source: bump(kb.card.source) } : undefined,
    },
  };
}

/**
 * 从 session 当前状态重建知识库全套衍生数据。
 *
 * 这是三层知识库的公共重建入口——stage4 首次构建调用它，
 * profile-review 全量更新 enterprise 后也会调用它来刷新已陈旧的信源。
 * 重建会保留既有 usageCount（按信源 id 匹配），避免引用计数被重置。
 *
 * 不修改 currentStage；调用方负责根据场景决定是否需要推进阶段。
 */
export function rebuildKnowledgeBase(
  session: SessionData,
  materials: string[] = [],
): SessionData {
  const promotionGoal = buildPromotionGoal(session);
  const nextKnowledgeBase: KnowledgeBase = {
    documents: buildDocumentPlan(materials, session),
    images: buildImagePlan(session),
    tags: buildTags(materials, session),
    raw: compileRawLayer(session),
    sources: compileSources(session),
    card: compileAICard(session),
  };

  const updated: SessionData = {
    ...session,
    promotionGoal,
    audienceSegments: buildAudienceSegments(session),
    knowledgeBase: mergeSourceUsage(session.knowledgeBase, nextKnowledgeBase),
    knowledgePlan: buildKnowledgeDocumentPlan(session),
    imagePlan: buildImageAssetPlan(session),
    keywordStrategy: buildKeywordStrategy(session),
    contentPlaybook: buildContentPlaybook(session),
    trackingPlan: buildTrackingPlan(),
  };
  updated.prompts = buildPlatformPrompts(updated);
  updated.platforms = buildPlatformStrategies(updated);
  return updated;
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
    const updated = rebuildKnowledgeBase(session, materials);
    updated.currentStage = 'knowledge';

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
