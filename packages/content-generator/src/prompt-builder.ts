import type { SessionData, PlatformId, ArticleContentType, ReviewFeedback, KnowledgeSource } from '@zemingengine/shared';
import { buildProtocolLines } from './writing-protocol.js';

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

// 键类型放宽为 string：zhidao（百度知道）、baijia（百家号）等平台标识
// 暂未纳入 PlatformId 联合类型，但线上会话确实会产出这些平台的稿件。
const PLATFORM_CONSTRAINTS: Record<string, PlatformConstraint> = {
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
  baijia: {
    tone: '通俗、信息密集、有观点',
    format: '百家号图文格式',
    lengthRange: '1000-3000字',
    specialRules: [
      '标题直给信息点，避免过度悬念',
      '开头两段内交代核心结论',
      '段落短、信息密度高，适合手机阅读',
      '避免硬广和绝对化表述',
    ],
  },
  zhidao: {
    tone: '口语化、直接、务实',
    format: '百度知道问答格式，一问一答',
    lengthRange: '600-1500字',
    specialRules: [
      '开头用 1-2 句直接回答（BLUF 原则）',
      '分点说明原因、步骤或注意事项',
      '语言口语化，避免长句和术语堆砌',
      '不出现联系方式、二维码等导流信息',
    ],
  },
  baike: {
    tone: '客观、中立、百科式',
    format: '百度百科词条格式',
    lengthRange: '1000-5000字',
    specialRules: [
      '内容客观中立，避免主观评价',
      '结构清晰，按词条分类组织',
      '引用可靠来源支撑事实陈述',
      '避免广告和营销性质的内容',
    ],
  },
};

/**
 * GEO 白帽写作原则（全局最高优先级，在所有内容类型中均生效）：
 * 1. 信息增量优先：每段都必须提供读者之前不知道的新信息（行业知识、方法论、数据）
 * 2. 品牌自然提及：品牌名仅在直接相关时出现，密度 ≤ 每 300 字 1 次，全文品牌占比 ≤ 15%
 * 3. 数据必有来源：任何数字（百分比、金额、数量）必须标注来源或说明口径
 * 4. 禁止硬广 CTA：不得出现「联系我们」「扫码咨询」「立即购买」等推销用语
 * 5. 品牌非唯一解法：行业问题存在多种解法，品牌仅是其中之一
 * 6. 客观中立视角：以第三方行业观察者身份写作，而非品牌发言人
 * 7. 可引用可验证：核心论点必须有可被搜索引擎独立验证的依据
 */
const GEO_WHITE_HAT_RULES = [
  '信息增量优先：每段必须提供读者之前不知道的新信息（行业知识、方法论、数据）',
  '品牌自然提及：品牌名仅在直接相关时出现，密度 ≤ 每 300 字 1 次，全文品牌占比 ≤ 15%',
  '数据必有来源：任何数字（百分比、金额、数量）必须标注来源或说明口径；无法标注则使用定性表述',
  '禁止硬广 CTA：不得出现「联系我们」「扫码咨询」「立即购买」「免费试用」等推销用语',
  '品牌非唯一解法：行业问题存在多种解法，品牌仅是其中之一，需客观介绍其他可选方案',
  '客观中立视角：以第三方行业观察者身份写作，而非品牌发言人',
  '可引用可验证：核心论点必须有可被搜索引擎独立验证的依据',
];

const CONTENT_TYPE_GUIDE: Record<ArticleContentType, ContentTypeGuide> = {
  tutorial: {
    description: '教程类内容，以独立第三方视角教会读者完成某项任务。品牌案例仅作为示例之一，不能作为整篇教程的唯一主角',
    structure: [
      '明确学习目标与适用场景',
      '前置条件与准备工作',
      '核心步骤详解（通用方法，品牌案例仅作为其中一个示例）',
      '常见误区与避坑指南',
      '总结关键要点（3-5 条）',
    ],
    tips: [
      '步骤必须可复现，避免空泛描述',
      '品牌名仅出现在「实战示例」段落的 1-2 处，全文不超过 3 次',
      '优先写行业通用方法，再附带品牌实践作为参考',
      '读者跟着教程走应能独立完成，不依赖品牌产品',
    ],
  },
  case: {
    description: '案例类内容，以第三方分析师视角复盘一个行业实践。重点在问题-解法-可借鉴经验，品牌案例仅作为研究对象之一',
    structure: [
      '案例背景与行业痛点（客观描述，非品牌宣传）',
      '问题诊断与根因分析',
      '解决方案对比（至少 2-3 种可选方案，品牌方案是其中之一）',
      '实施过程与关键决策',
      '效果验证（数据必须有来源或标注方法）',
      '可迁移的经验总结',
    ],
    tips: [
      '如果用了品牌作为案例，必须客观指出其局限性和适用边界',
      '数据必须标注来源（如「据 XX 公开财报」「XX 第三方报告」）或说明是企业内部数据',
      '至少提及一个其他品牌/方案作为参照对比',
      '案例写作目标是提供行业洞察，不是展示自家产品',
    ],
  },
  comparison: {
    description: '对比类内容，以独立评测者视角对比多种解法。结论必须基于可验证的客观维度，不能隐含品牌推荐',
    structure: [
      '对比背景：为什么读者需要了解这个问题',
      '对比维度定义（价格、品质、服务、口碑等）',
      '各选项逐一拆解（品牌 A / B / C，一视同仁）',
      '分维度评分与说明（客观数据支撑）',
      '不同场景的推荐（A 适合 XX，B 适合 XX）',
    ],
    tips: [
      '对比必须公平，不能故意贬低竞品或夸大自家优势',
      '评分标准必须事先公布，不能为了结论调整标准',
      '如果品牌在某维度劣势，直接指出，读者会因为你的诚实而信任',
      '至少对比 3 个以上选项，避免只写自家 vs 一个竞品',
    ],
  },
  popularization: {
    description: '科普类内容，以行业观察者视角将专业知识通俗化。品牌名只在「产业动态」部分作为企业案例自然出现',
    structure: [
      '引入话题：这个概念为什么重要（行业趋势切入）',
      '基础概念解析（深入浅出，无品牌）',
      '核心原理/方法论拆解（通用知识，无品牌）',
      '实际应用场景与案例（多家企业实践，品牌是其中之一）',
      '行业现状与趋势展望',
      '读者可以做什么（行动建议，非推销）',
    ],
    tips: [
      '品牌名不应该出现在「概念解析」和「原理拆解」部分',
      '全文可以完全不出现品牌——如果科普的是行业通用知识',
      '如果出现品牌，在「应用案例」部分一带而过，不超过 2 次',
      '类比和比喻要帮助理解概念，不是暗喻品牌优势',
    ],
  },
  faq: {
    description: 'FAQ问答类内容，以第三方知识平台视角回答用户搜索意图。适合 AI 搜索引擎抓取引用，但禁止用 FAQ 做品牌硬广占位',
    structure: [
      'Q1-Q3：行业通用高频问题（与品牌无关）',
      'Q4-Q5：行业方案对比问题（品牌是选项之一）',
      'Q6（可选）：关于该品牌的客观事实问答（仅限中立事实）',
    ],
    tips: [
      '前 3 个问题必须是品牌完全无关的行业通用问题，不能 Q1 就问「XX 品牌怎么样」',
      '答案开头 1-2 句直接回答（BLUF 原则），让 AI 搜索能直接抓取引用',
      '关于品牌的问答仅限可验证的客观事实（成立时间、产品类型、资质等），禁止主观评价',
      '品牌名在答案中出现密度 ≤ 每 400 字 1 次',
      '如果答案引用数据，必须标注来源',
    ],
  },
  whitepaper: {
    description: '白皮书/深度报告类内容，以行业研究机构或第三方分析师身份发布。必须有方法论和数据来源，品牌仅在「企业案例」章节出现',
    structure: [
      '执行摘要（3-5 条核心发现，无品牌）',
      '研究背景与方法论（数据来源、调研范围、分析框架）',
      '行业现状与核心数据（必须标注数据来源）',
      '关键趋势与洞察',
      '企业实践案例（2-3 家不同企业，品牌是其中之一）',
      '行动建议（针对行业读者，非品牌推销）',
      '附录：数据来源说明、术语表、参考资料',
    ],
    tips: [
      '执行摘要、方法论、现状分析、趋势预测章节：完全不出现品牌名',
      '品牌仅在「企业实践案例」章节出现，与其他企业并列',
      '所有数据必须标注来源（机构报告、公开披露、调研自述等）',
      '白皮书语气是研究机构的中立报告，不是品牌宣传册',
      '字数建议 3000-6000 字，分章节带编号，便于 AI 抓取结构化片段',
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
  /** 本篇三层检索选中的信源；有值时只注入这些信源，不再全量注入知识库 */
  citedSources?: KnowledgeSource[];
}): { system: string; user: string } {
  const { session, platform, contentType, generationRound, reviewFeedback, topic, contentSupplement, pipelineFeedback, citedSources } = params;
  // 未知平台（历史会话可能写入非 PlatformId 的平台标识）不应让 buildPrompt 抛错，
  // 否则会被静默降级为模板。兜底使用通用图文约束。
  const platformConstraint = PLATFORM_CONSTRAINTS[platform] ?? PLATFORM_CONSTRAINTS.weixin;
  // 非法 contentType（如调用方传 'guide'）不应让 buildPrompt 抛错并静默降级为模板，
  // 这里兜底为科普类，保证提示词结构完整。
  const contentGuide = CONTENT_TYPE_GUIDE[contentType] ?? CONTENT_TYPE_GUIDE.popularization;

  const systemLines: string[] = [];

  // GEO 白帽原则（最高优先级，LLM 必须在所有写作决策中优先遵守）
  systemLines.push('【最高优先级 · GEO 白帽写作原则 —— 必须在所有写作决策中优先遵守】');
  GEO_WHITE_HAT_RULES.forEach((rule, i) => systemLines.push(`${i + 1}. ${rule}`));
  systemLines.push('');
  systemLines.push('违反以上原则会导致文章被 AI 搜索引擎降权或不引用。品牌宣传是次要目标，提供对读者有价值的客观内容才是首要目标。');
  systemLines.push('');

  // GEO 文章写作协议（v2.1，强制约束：EK 引用、红线、字数、输出格式）
  systemLines.push(...buildProtocolLines());

  // Task description
  systemLines.push('你是一位专业的内容创作助手。你的写作视角是行业观察者和独立分析师，而非品牌的发言人。');
  systemLines.push('');

  // Enterprise info — 客观事实素材，不是宣传素材
  systemLines.push('=== 企业客观事实素材（仅可作为写作背景参考，不得直接当作宣传语） ===');
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

  // Promotion goal — 品牌上下文，仅当与主题直接相关时可自然提及，不得作为文章主旨
  systemLines.push('=== 品牌上下文（仅当与文章主题直接相关时可自然提及，不得作为文章主旨） ===');
  systemLines.push(`产品名称: ${session.promotionGoal.productName}（仅在讨论该类产品时可提及，不得强行植入）`);
  systemLines.push(`定位: ${session.promotionGoal.positioning}`);
  systemLines.push(`核心价值: ${session.promotionGoal.coreValue}（可用于行业解决方案对比的一个选项）`);
  systemLines.push(`目标用户: ${session.promotionGoal.targetUsers}`);
  systemLines.push(`核心卖点: ${session.promotionGoal.coreSellingPoint}（仅供事实参考，不得用"最""唯一"等绝对化表述）`);
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

  // Knowledge base references — 编译式 Wiki 消费
  // 优先读取结构化 sections（新 session 从 enterprise 真实字段编译），
  // 没有 sections 时降级到 content preview（老 session 兼容）。
  // 三层检索结果优先：只注入本篇选中的 6-9 条信源（L3 名片必引）
  if (citedSources && citedSources.length > 0) {
    systemLines.push('=== 本篇引用信源（L3 AI 名片必引 + L2 企业信源）===');
    systemLines.push(
      `本篇共引用 ${citedSources.length} 条信源。正文只能使用下列信源中的事实，不得编造企业未提供的功能、数字或案例。`,
    );

    citedSources.forEach((src, idx) => {
      const layerLabel = src.layer === 3 ? 'L3 AI名片 · 必引' : 'L2 企业信源';
      systemLines.push('');
      systemLines.push(`【S${idx + 1}｜${layerLabel}｜${src.type}】${src.title}`);
      src.sections.forEach((section) => {
        if (section.bullets.length === 0) return;
        systemLines.push(`  <${section.heading}>`);
        section.bullets.forEach((bullet) => systemLines.push(`    - ${bullet}`));
      });
      if (src.keyFacts.length > 0) {
        systemLines.push('  关键事实：');
        src.keyFacts.slice(0, 6).forEach((fact) => systemLines.push(`    · ${fact}`));
      }
      if (src.tags.length > 0) {
        systemLines.push(`  标签：${src.tags.join('、')}`);
      }
    });

    systemLines.push('');
    systemLines.push(
      '引用要求：S1（AI 名片）必须引用，用于开篇定位或结尾品牌总结；其余信源按主题相关性自然嵌入，避免堆砌和重复表述。',
    );
    systemLines.push('');
  } else if (session.knowledgeBase.documents.length > 0) {
    const hasStructured = session.knowledgeBase.documents.some((d) => (d.sections?.length ?? 0) > 0);

    systemLines.push('=== 企业知识库（LLMWiki 编译式条目）===');

    if (hasStructured) {
      // 编译式路径：输出 sections / keyFacts / evidence，让 LLM 直接消费真实企业事实
      const docs = session.knowledgeBase.documents.slice(0, 6);
      const allKeyFacts: string[] = [];

      docs.forEach((doc, idx) => {
        systemLines.push(`--- 条目 ${idx + 1}: [${doc.type}] ${doc.title} ---`);

        if (doc.sections && doc.sections.length > 0) {
          doc.sections.forEach((section) => {
            if (section.bullets.length === 0) return;
            systemLines.push(`【${section.heading}】`);
            section.bullets.forEach((bullet) => systemLines.push(`  - ${bullet}`));
          });
        } else if (doc.content) {
          // 无 sections 的降级：content preview
          systemLines.push(doc.content.slice(0, 120));
        }

        if (doc.tags && doc.tags.length > 0) {
          systemLines.push(`标签: ${doc.tags.join('、')}`);
        }

        // 收集关键事实（跨条目汇总）
        if (doc.keyFacts && doc.keyFacts.length > 0) {
          allKeyFacts.push(...doc.keyFacts);
        }
      });

      if (allKeyFacts.length > 0) {
        systemLines.push('');
        systemLines.push('【可直接引用的关键事实】');
        allKeyFacts.slice(0, 10).forEach((f) => systemLines.push(`  • ${f}`));
      }

      // evidence 溯源提示（不逐条输出，只告知这些条目来自企业真实字段编译）
      const hasEvidence = session.knowledgeBase.documents.some((d) => (d.evidence?.length ?? 0) > 0);
      if (hasEvidence) {
        systemLines.push('');
        systemLines.push('注意：以上 sections 来自企业画像真实字段（产品描述、用户痛点、品牌故事、信任锚点等），写作时请优先引用这些事实，不要编造企业不存在的功能、数字或案例。');
      }
    } else {
      // 老 session 降级路径（仅 content preview）
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
      systemLines.push('（此为基础规划清单，企业真实资料请待上传后自动编译）');
    }

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

  // 反营销硬性护栏（违反任何一条即视为不合格输出）
  systemLines.push('=== 反营销硬性护栏（违反任何一条即视为不合格输出） ===');
  systemLines.push('1. 禁止编造任何无来源的数据、百分比、用户数、市场份额等数字；如果不确定准确值，使用定性描述（如「显著提升」「行业常见水平」）');
  systemLines.push('2. 品牌名在正文中的出现密度不得超过每 300 字 1 次；全文品牌名占比（含标题）不得超过 15%');
  systemLines.push('3. 禁止出现「联系我们」「扫码咨询」「立即试用」「免费获取」「点击了解更多」等硬广 CTA 用语');
  systemLines.push('4. 禁止将品牌描述为行业问题的「唯一解法」「最佳选择」，必须客观提及其他可选方案');
  systemLines.push('5. 禁止通篇文章以品牌为唯一主角；至少 60% 的内容应聚焦于行业知识、方法论、通用最佳实践');
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
