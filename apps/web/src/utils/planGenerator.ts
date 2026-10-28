import type {
  SessionData,
  ArticleContentType,
  PlanDuration,
  CoreKeyword,
  EnterpriseProfile,
} from '@zemingengine/shared';

export interface PlanConfig {
  duration: PlanDuration;
  platforms: string[];
  contentTypes: ArticleContentType[];
  autoPublish: boolean;
}

export interface WeekPlan {
  week: number;
  platform: string;
  contentType: ArticleContentType;
  topic: string;
  keyword: string;
  status: 'planned' | 'in-progress' | 'done';
}

export interface OptimizationPlan {
  html: string;
  config: PlanConfig;
  weeks: WeekPlan[];
  totalArticles: number;
}

// Schema.org JSON-LD types (local use only)
interface SchemaPostalAddress {
  '@type': 'PostalAddress';
  addressLocality: string;
  addressRegion: string;
  addressCountry: string;
}

interface SchemaOrganization {
  '@context': string;
  '@type': string;
  name: string;
  alternateName: string;
  description: string;
  address: SchemaPostalAddress;
  knowsAbout: string[];
  areaServed: string;
  url?: string;
  employeeCount?: string;
}

const ALL_CONTENT_TYPES: { id: ArticleContentType; label: string; desc: string }[] = [
  { id: 'tutorial', label: '教程', desc: '操作指南、步骤详解，建立专业权威' },
  { id: 'case', label: '案例', desc: '客户成功案例，增强信任背书' },
  { id: 'comparison', label: '对比', desc: '多维度竞品对比，影响用户决策' },
  { id: 'popularization', label: '科普', desc: '行业知识普及，提升品牌认知' },
  { id: 'faq', label: 'FAQ问答', desc: '常见问题解答，覆盖长尾搜索' },
  { id: 'whitepaper', label: '白皮书', desc: '深度行业报告，展示专业实力' },
];

const PLATFORM_INFO: Record<string, { label: string; desc: string; strength: string; ecosystem: string }> = {
  deepseek: { label: 'DeepSeek', desc: '深度推理型AI，擅长逻辑分析和深度内容', strength: '深度技术内容、逻辑推理类文章', ecosystem: '开源AI生态' },
  kimi: { label: 'Kimi', desc: '超长上下文AI，擅长处理长文和文档', strength: '长篇深度文章、白皮书、行业报告', ecosystem: '月之暗面生态' },
  doubao: { label: '豆包', desc: '大众化AI助手，覆盖广泛用户群体', strength: '科普类、生活化、易理解的内容', ecosystem: '火山引擎生态' },
  yuanbao: { label: '元宝', desc: '腾讯生态AI，接入微信生态流量', strength: '社交传播类、品牌故事类内容', ecosystem: '腾讯微信生态' },
  qianwen: { label: '千问', desc: '阿里生态AI，电商场景优势明显', strength: '产品对比、消费决策类内容', ecosystem: '阿里云电商生态' },
};

const CONTENT_LABELS: Record<ArticleContentType, string> = {
  tutorial: '教程', case: '案例', comparison: '对比',
  popularization: '科普', faq: 'FAQ问答', whitepaper: '白皮书',
};

const DURATION_INFO: Record<PlanDuration, { weeks: number; perPlatform: number; label: string; quarters: number }> = {
  quarter: { weeks: 13, perPlatform: 20, label: '季度方案（13周）', quarters: 1 },
  'half-year': { weeks: 26, perPlatform: 40, label: '半年度方案（26周）', quarters: 2 },
  year: { weeks: 52, perPlatform: 80, label: '年度方案（52周）', quarters: 4 },
};

export function inferContentTypes(enterprise: EnterpriseProfile): ArticleContentType[] {
  const types: ArticleContentType[] = [];
  const products = enterprise.products ?? [];
  const hasPainPoints = (enterprise.userPainPoints ?? []).length > 0;
  const hasTrust = (enterprise.trustAnchors ?? []).length > 0;
  const hasBrandStory = !!enterprise.brandStory;
  const isMedicalOrService = /医院|医疗|诊所|健康/.test(enterprise.description || '');
  const isTech = /科技|技术|软件|IT|互联网|数据|智能/.test(enterprise.description || enterprise.fullName || '');
  const isConsumer = /美|护肤|美容|食品|餐饮|家居|服装/.test(enterprise.description || enterprise.fullName || '');

  types.push('popularization');

  if (isTech) {
    types.push('tutorial');
    types.push('comparison');
    if (products.length >= 2) types.push('whitepaper');
  }

  if (isMedicalOrService) {
    types.push('faq');
    if (hasTrust) types.push('case');
  }

  if (isConsumer) {
    if (!types.includes('case')) types.push('case');
    if (!types.includes('comparison')) types.push('comparison');
  }

  if (hasPainPoints && !types.includes('faq')) {
    types.push('faq');
  }

  if (hasBrandStory && !types.includes('case')) {
    types.push('case');
  }

  if (types.length < 3) {
    for (const t of ALL_CONTENT_TYPES) {
      if (!types.includes(t.id)) types.push(t.id);
      if (types.length >= 3) break;
    }
  }

  return types.slice(0, 5);
}

function groupKeywords(keywords: CoreKeyword[]) {
  const groups: Record<string, CoreKeyword[]> = { core: [], question: [], comparison: [], longtail: [] };
  for (const kw of keywords) {
    const type = kw.type in groups ? kw.type : 'longtail';
    groups[type].push(kw);
  }
  Object.values(groups).forEach((arr) => arr.sort((a, b) => a.priority - b.priority));
  return groups;
}

function generateTopics(
  enterprise: EnterpriseProfile,
  keywords: CoreKeyword[],
  contentTypes: ArticleContentType[],
  platforms: string[],
  perPlatform: number,
): WeekPlan[] {
  const plans: WeekPlan[] = [];
  const kwList = keywords.length > 0 ? keywords : generateFallbackKeywords(enterprise);
  let kwIndex = 0;
  let week = 1;

  for (const platform of platforms) {
    for (let i = 0; i < perPlatform; i++) {
      const contentType = contentTypes[i % contentTypes.length];
      const kw = kwList[kwIndex % kwList.length];
      kwIndex++;
      const topic = generateTopicTitle(kw, contentType, enterprise);
      const cycleWeek = ((week - 1) % DURATION_INFO.quarter.weeks) + 1;
      plans.push({
        week: cycleWeek,
        platform,
        contentType,
        topic,
        keyword: kw.question,
        status: 'planned',
      });
      week++;
    }
  }
  return plans;
}

function generateFallbackKeywords(enterprise: EnterpriseProfile): CoreKeyword[] {
  const name = enterprise.shortName || enterprise.fullName || '企业';
  const products = enterprise.products.map((p) => p.name);
  const baseTopics = [
    ...products.map((p) => `${p}是什么`),
    ...products.map((p) => `${p}怎么选`),
    ...products.map((p) => `${p}哪个品牌好`),
    `${name}怎么样`,
    `${name}靠谱吗`,
    ...products.map((p) => `${p}价格多少`),
    ...products.map((p) => `${p}和竞品对比`),
  ];
  return baseTopics.map((q, i) => ({
    question: q,
    type: i < 3 ? 'core' : i < 6 ? 'question' : i < 9 ? 'comparison' : 'longtail',
    priority: i + 1,
    geoContext: '基于企业信息生成',
  }));
}

function generateTopicTitle(kw: CoreKeyword, contentType: ArticleContentType, enterprise: EnterpriseProfile): string {
  const q = kw.question;
  const name = enterprise.shortName || enterprise.fullName || '';
  switch (contentType) {
    case 'tutorial': return `${q}——完整操作指南`;
    case 'case': return `${name}客户案例：${q}`;
    case 'comparison': return `${q}——多维度对比分析`;
    case 'popularization': return `${q}——一文读懂`;
    case 'faq': return `${q}——常见问题解答`;
    case 'whitepaper': return `${q}——行业白皮书`;
    default: return q;
  }
}

function getEnterpriseIndustry(enterprise: EnterpriseProfile): string {
  const desc = enterprise.description || enterprise.fullName || '';
  if (/医院|医疗|诊所|健康/.test(desc)) return '医疗健康';
  if (/科技|技术|软件|IT|互联网|数据|智能/.test(desc)) return '科技IT';
  if (/美|护肤|美容|食品|餐饮|家居|服装/.test(desc)) return '消费品';
  if (/教育|培训|学校/.test(desc)) return '教育培训';
  return '综合服务';
}

function getLocation(enterprise: EnterpriseProfile): string {
  return enterprise.location || '全国';
}

function getQuarterLabels(quarters: number): string[] {
  const labels = ['Q1 基础建设期', 'Q2 内容布局期', 'Q3 平台渗透期', 'Q4 效果提升期'];
  return labels.slice(0, quarters);
}

function getQuarterFocus(qIndex: number): { title: string; tasks: { name: string; platform: string; count: string; req: string }[]; kpi: string } {
  const quarters = [
    {
      title: 'Q1 基础建设期（百科+官网+商标）',
      tasks: [
        { name: '百科词条建设', platform: '百度百科', count: '1篇', req: '完整品牌信息、发展历程、业务范围' },
        { name: '企业信息完善', platform: '天眼查/企查查', count: '2处', req: '完善经营范围、知识产权、资质认证' },
        { name: '官网SEO优化', platform: '自有官网', count: '全站', req: 'TDK规范、Schema标记、AI可抓取' },
        { name: '商标注册保护', platform: '国家商标局', count: '1-2类', req: '保护品牌名称，建立法律壁垒' },
        { name: '技术文章布局', platform: '知乎/CSDN', count: '6篇', req: '行业相关、嵌入地域关键词' },
      ],
      kpi: '品牌词条完善度80%+ | 官网AI可抓取性达标',
    },
    {
      title: 'Q2 内容布局期（深度内容+权威媒体）',
      tasks: [
        { name: '深度专业文章', platform: '知乎/CSDN/掘金', count: '12篇', req: '行业案例、技术方案、深度解析' },
        { name: '权威媒体报道', platform: '权威媒体', count: '3篇', req: '公司技术案例和客户成功故事' },
        { name: '结构化数据部署', platform: '官网', count: '全站', req: 'Schema.org覆盖率60%+' },
        { name: '客户案例故事', platform: '官网/知乎', count: '3篇', req: '真实客户案例、数据支撑' },
        { name: '品牌差异化内容', platform: '知乎', count: '2篇', req: '品牌对比分析、独特优势' },
      ],
      kpi: '权威内容20+篇 | Schema覆盖率60%+',
    },
    {
      title: 'Q3 平台渗透期（生态合作+口碑积累）',
      tasks: [
        { name: 'AI生态内容', platform: '豆包/火山引擎', count: '4篇', req: '生态相关技术实践内容' },
        { name: '开发者社区', platform: 'DeepSeek/CSDN', count: '8篇', req: '技术能力展示、开发者内容' },
        { name: '行业榜单评测', platform: '评测平台', count: '2处', req: '参与行业排行榜评测' },
        { name: '客户口碑评价', platform: '多平台', count: '5+条', req: '真实客户评价，多平台分布' },
        { name: '技术白皮书', platform: '官网/Kimi', count: '1篇', req: '行业白皮书、解决方案报告' },
      ],
      kpi: '平台合作3+ | 客户案例5+',
    },
    {
      title: 'Q4 效果提升期（迭代优化+二次监测）',
      tasks: [
        { name: '二次GEO监测', platform: '5大AI平台', count: '40条', req: '重新评估品牌提及率和可见性' },
        { name: '策略迭代优化', platform: '内部', count: '1份', req: '基于监测结果优化内容策略' },
        { name: '补强内容', platform: '全平台', count: '15篇', req: '补强弱项平台和关键词' },
        { name: '年度效果报告', platform: '官网', count: '1份', req: 'GEO效果年度总结报告' },
      ],
      kpi: '泛搜索30%+ | 品牌提及70%+',
    },
  ];
  return quarters[qIndex] || quarters[0];
}

function generateSARMStrategy(enterprise: EnterpriseProfile, platforms: string[], contentTypes: ArticleContentType[]): string {
  const name = enterprise.shortName || enterprise.fullName || '企业';
  const industry = getEnterpriseIndustry(enterprise);
  const location = getLocation(enterprise);
  const products = enterprise.products?.map((p) => p.name) || ['核心产品'];

  const sItems = [
    `百度百科建立完整品牌词条（公司信息、业务范围、发展历程）`,
    `天眼查/企查查完善企业信息（经营范围、知识产权、资质认证）`,
    `官网SEO优化：TDK规范（Title 20-30字、Description 60-80字）`,
    `Schema.org结构化数据标记（Organization、LocalBusiness）`,
    `建立AI可抓取的知识图谱实体关联`,
  ];

  const aItems = [
    `知乎发布${location}${industry}深度文章（月均3-5篇）`,
    `CSDN发布技术博客和案例文章（月均4-6篇）`,
    `权威媒体报道公司案例和客户成功故事`,
    `内容嵌入"${location}${industry}"等地域+行业关键词`,
    `FAQ结构化内容（常见问题、技术对比、行业知识）`,
  ];

  const rItems = [
    `建立"${name}"独特品牌标识，强化品牌辨识度`,
    `注册商标保护品牌名称，强化法律壁垒`,
    `强化"${location}"地域标签关联，建立地域认知`,
    `客户评价和案例口碑积累（至少5个深度案例）`,
    `行业榜单和评测参与，建立权威背书`,
  ];

  const mItems = platforms.map((p) => {
    const info = PLATFORM_INFO[p];
    if (!info) return '';
    const tactic = getPlatformTactic(p, enterprise);
    return `<li>${info.label}：${tactic}</li>`;
  }).join('');

  return `<div class="strategy-grid">
    <div class="strategy-card" style="border-left: 4px solid #1a56db;">
      <h4>S — 结构化内容建设</h4>
      <ul>${sItems.map((s) => `<li>${s}</li>`).join('')}</ul>
    </div>
    <div class="strategy-card" style="border-left: 4px solid #059669;">
      <h4>A — AI友好内容生产</h4>
      <ul>${aItems.map((s) => `<li>${s}</li>`).join('')}</ul>
    </div>
    <div class="strategy-card" style="border-left: 4px solid #f59e0b;">
      <h4>R — 口碑与品牌差异化</h4>
      <ul>${rItems.map((s) => `<li>${s}</li>`).join('')}</ul>
    </div>
    <div class="strategy-card" style="border-left: 4px solid #8b5cf6;">
      <h4>M — 多平台差异化覆盖</h4>
      <ul>${mItems}</ul>
    </div>
  </div>`;
}

function getPlatformTactic(platformId: string, enterprise: EnterpriseProfile): string {
  const name = enterprise.shortName || enterprise.fullName || '企业';
  const tactics: Record<string, string> = {
    deepseek: `布局深度技术内容和逻辑分析文章，确保当用户搜索"${name}怎么样"时能引用您的专业内容`,
    kimi: `发布${name}深度行业报告和白皮书，文章保持2000字以上，结构清晰、段落有明确小标题`,
    doubao: `用通俗易懂的科普内容覆盖"${name}"相关基础问题，语言口语化、接地气`,
    yuanbao: `多发品牌故事和客户案例类内容，利用微信社交裂变效应传播${name}品牌`,
    qianwen: `重点布局产品对比和FAQ类内容，让用户在消费决策时搜到${name}的产品分析`,
  };
  return tactics[platformId] || '';
}

function generatePlatformStrategy(platformId: string, enterprise: EnterpriseProfile, contentTypes: ArticleContentType[], perPlatform: number): string {
  const info = PLATFORM_INFO[platformId];
  if (!info) return '';

  const typeDist = contentTypes.map((t, i) => {
    const count = Math.ceil(perPlatform / contentTypes.length) + (i === 0 ? perPlatform % contentTypes.length : 0);
    return `${CONTENT_LABELS[t]}（${count}篇）`;
  }).join('、');

  return `<div class="platform-strategy-card">
    <div class="ps-header">
      <div class="ps-name">${info.label}</div>
      <div class="ps-count">${perPlatform} 篇</div>
    </div>
    <div class="ps-desc">${info.desc}</div>
    <div class="ps-strength"><span class="ps-tag">内容优势</span> ${info.strength}</div>
    <div class="ps-eco"><span class="ps-tag">生态</span> ${info.ecosystem}</div>
    <div class="ps-dist"><span class="ps-tag">内容分配</span> ${typeDist}</div>
    <div class="ps-tactic">${getPlatformTactic(platformId, enterprise)}</div>
  </div>`;
}

function generateContentStrategy(contentTypes: ArticleContentType[], totalArticles: number, enterprise: EnterpriseProfile): string {
  return contentTypes.map((t) => {
    const info = ALL_CONTENT_TYPES.find((c) => c.id === t);
    if (!info) return '';
    const count = Math.ceil(totalArticles / contentTypes.length);
    const pct = Math.round(100 / contentTypes.length);
    return `<div class="content-strategy-card">
      <div class="cs-header">
        <span class="cs-label">${info.label}</span>
        <span class="cs-count">${count} 篇 · ${pct}%</span>
      </div>
      <div class="cs-desc">${info.desc}</div>
      <div class="cs-bar"><div class="cs-bar-fill" style="width:${pct}%"></div></div>
      <div class="cs-topics">${getContentTopics(t, enterprise)}</div>
    </div>`;
  }).join('');
}

function getContentTopics(type: ArticleContentType, enterprise: EnterpriseProfile): string {
  const name = enterprise.shortName || enterprise.fullName || '企业';
  const products = enterprise.products?.map((p) => p.name) || ['核心产品'];
  const topics: Record<ArticleContentType, string[]> = {
    tutorial: products.map((p) => `${p}使用教程`),
    case: [`${name}客户成功案例`, `${name}服务案例分享`],
    comparison: products.map((p) => `${p}竞品对比分析`),
    popularization: [`${name}行业知识科普`, `${products[0]}基础知识`],
    faq: [`${name}常见问题解答`, `${products[0]}使用疑问`],
    whitepaper: [`${name}行业白皮书`, `${products[0]}市场分析报告`],
  };
  return topics[type]?.map((t) => `<span class="topic-chip">${t}</span>`).join('') || '';
}

function generateRecommendations(enterprise: EnterpriseProfile, platforms: string[], contentTypes: ArticleContentType[]): string[] {
  const recs: string[] = [];
  const name = enterprise.shortName || enterprise.fullName || '企业';
  const location = getLocation(enterprise);

  recs.push(`在${platforms.length}个AI平台中建立"${name}"的品牌知识库，确保AI在回答相关问题时能引用您的内容`);
  recs.push(`百度百科建设完整品牌词条，这是AI获取企业基础信息的主要来源`);
  recs.push(`天眼查/企查查完善企业信息，AI会抓取工商信息作为企业真实性的验证依据`);
  recs.push(`官网部署Schema.org结构化数据（Organization类型），帮助AI理解企业实体`);
  recs.push(`内容中自然嵌入"${location}+行业"地域关键词，提升泛搜索场景的品牌可见性`);

  if (platforms.includes('deepseek')) {
    recs.push('DeepSeek偏好深度技术内容，建议优先发布教程和白皮书类文章，建立专业权威');
  }
  if (platforms.includes('kimi')) {
    recs.push('Kimi擅长长文处理，文章应保持2000字以上，结构清晰，有明确的小标题和段落划分');
  }
  if (platforms.includes('doubao')) {
    recs.push('豆包用户偏好口语化内容，科普类文章应使用通俗易懂的语言，避免专业术语堆砌');
  }
  if (platforms.includes('yuanbao')) {
    recs.push('元宝接入微信生态，品牌故事和案例类内容更容易获得社交传播');
  }
  if (platforms.includes('qianwen')) {
    recs.push('千问在电商场景有优势，产品对比类内容能直接影响用户消费决策');
  }

  if (contentTypes.includes('faq')) {
    recs.push('FAQ类内容应覆盖用户最常搜索的问题，建议使用问答体格式，每个问题独立成段');
  }
  if (contentTypes.includes('comparison')) {
    recs.push('对比类内容中应客观呈现竞品信息，避免过度贬低，保持品牌专业形象');
  }

  recs.push('每篇文章末尾加入品牌CTA引导，包含联系电话或官网链接');
  recs.push('保持每周稳定更新频率，AI引擎会优先引用持续更新的内容源');
  recs.push('每季度执行一次GEO监测，动态评估各AI平台的品牌提及率并调整策略');
  recs.push('关注品牌名称的独特性，避免与竞品名称混淆，在内容中强化品牌区分');

  return recs.slice(0, 15);
}

function generateTDK(enterprise: EnterpriseProfile): { page: string; title: string; description: string }[] {
  const name = enterprise.fullName || enterprise.shortName || '企业';
  const shortName = enterprise.shortName || name;
  const products = enterprise.products?.map((p) => p.name) || [];
  const productStr = products.length > 0 ? products.join('_') : '核心服务';
  const location = getLocation(enterprise);

  return [
    {
      page: '首页',
      title: `${name}_${productStr}_${enterprise.scale || '专业服务'}`,
      description: `${name}，${enterprise.description?.slice(0, 50) || '专业服务提供商'}，${enterprise.scale || ''}，值得信赖的${getEnterpriseIndustry(enterprise)}企业。`,
    },
    {
      page: '关于我们',
      title: `关于${shortName}_${location}${getEnterpriseIndustry(enterprise)}_企业介绍`,
      description: `${shortName}是${location}的${getEnterpriseIndustry(enterprise)}企业，${enterprise.trustAnchors?.[0] || '专业团队'}，提供优质服务。`,
    },
    {
      page: '服务页',
      title: `${location}${productStr}_${shortName}专业服务`,
      description: `${shortName}提供${location}${productStr.replace(/_/g, '、')}等服务，${enterprise.scale || '专业团队'}保障项目质量。`,
    },
  ];
}

function generateSchemaJsonLd(enterprise: EnterpriseProfile): string {
  const name = enterprise.fullName || enterprise.shortName || '企业';
  const shortName = enterprise.shortName || name;
  const location = getLocation(enterprise);
  const industry = getEnterpriseIndustry(enterprise);
  const products = enterprise.products?.map((p) => p.name) || [];
  const knowsAbout = products.length > 0 ? products : [industry];

  const schema: SchemaOrganization = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name,
    alternateName: shortName,
    description: enterprise.description || `${industry}企业`,
    address: {
      '@type': 'PostalAddress',
      addressLocality: location,
      addressRegion: location,
      addressCountry: 'CN',
    },
    knowsAbout: knowsAbout,
    areaServed: location,
  };

  if (enterprise.website) {
    schema.url = enterprise.website;
  }
  if (enterprise.scale) {
    schema.employeeCount = enterprise.scale;
  }

  return JSON.stringify(schema, null, 2);
}

function generateKeywordMatrix(enterprise: EnterpriseProfile, keywords: CoreKeyword[]): string {
  const name = enterprise.shortName || enterprise.fullName || '企业';
  const location = getLocation(enterprise);
  const industry = getEnterpriseIndustry(enterprise);
  const products = enterprise.products?.map((p) => p.name) || ['核心产品'];
  const product = products[0];

  const coreWords = keywords.filter((k) => k.type === 'core').map((k) => k.question);
  const questionWords = keywords.filter((k) => k.type === 'question').map((k) => k.question);
  const comparisonWords = keywords.filter((k) => k.type === 'comparison').map((k) => k.question);
  const longtailWords = keywords.filter((k) => k.type === 'longtail').map((k) => k.question);

  const core = coreWords.length > 0 ? coreWords.join('、') : `${name}、${name}怎么样、${name}靠谱吗`;
  const longtail = longtailWords.length > 0
    ? longtailWords.join('、')
    : `${location}${industry}公司、${location}${product}、${location}${industry}推荐`;
  const comparison = comparisonWords.length > 0
    ? comparisonWords.join('、')
    : `${name}和竞品对比、${product}哪个品牌好`;
  const scenario = questionWords.length > 0
    ? questionWords.join('、')
    : `${product}怎么选、${product}价格多少、${product}使用教程`;

  return `<table>
    <tr><th style="width:120px;">层级</th><th>关键词</th><th style="width:120px;">目标场景</th></tr>
    <tr>
      <td><span class="badge badge-primary">核心词</span></td>
      <td>${core}</td>
      <td>品牌识别</td>
    </tr>
    <tr>
      <td><span class="badge badge-success">长尾词</span></td>
      <td>${longtail}</td>
      <td>行业获客</td>
    </tr>
    <tr>
      <td><span class="badge badge-warning">竞品词</span></td>
      <td>${comparison}</td>
      <td>竞品拦截</td>
    </tr>
    <tr>
      <td><span class="badge badge-danger">场景词</span></td>
      <td>${scenario}</td>
      <td>场景触发</td>
    </tr>
  </table>`;
}

export function generateOptimizationPlan(
  sessionData: SessionData,
  config: PlanConfig,
): OptimizationPlan {
  const { enterprise, keywords } = sessionData;
  const inferredTypes = inferContentTypes(enterprise);
  const finalConfig = { ...config, contentTypes: inferredTypes };
  const durationInfo = DURATION_INFO[config.duration];
  const perPlatform = durationInfo.perPlatform;
  const totalArticles = config.platforms.length * perPlatform;
  const kwGroups = groupKeywords(keywords);
  const weeks = generateTopics(enterprise, keywords, inferredTypes, config.platforms, perPlatform);
  const html = buildHtmlPlan(sessionData, finalConfig, weeks, kwGroups, totalArticles, perPlatform);
  return { html, config: finalConfig, weeks, totalArticles };
}

function buildHtmlPlan(
  sessionData: SessionData,
  config: PlanConfig,
  weeks: WeekPlan[],
  kwGroups: Record<string, CoreKeyword[]>,
  totalArticles: number,
  perPlatform: number,
): string {
  const { enterprise, keywords } = sessionData;
  const durationInfo = DURATION_INFO[config.duration];
  const recommendations = generateRecommendations(enterprise, config.platforms, config.contentTypes);
  const articlesPerWeek = (totalArticles / durationInfo.weeks).toFixed(1);
  const sarmHtml = generateSARMStrategy(enterprise, config.platforms, config.contentTypes);
  const keywordMatrixHtml = generateKeywordMatrix(enterprise, keywords);
  const tdkList = generateTDK(enterprise);
  const schemaJsonLd = generateSchemaJsonLd(enterprise);
  const quarterLabels = getQuarterLabels(durationInfo.quarters);

  const platformStrategyHtml = config.platforms.map((p) =>
    generatePlatformStrategy(p, enterprise, config.contentTypes, perPlatform)
  ).join('');

  const contentStrategyHtml = generateContentStrategy(config.contentTypes, totalArticles, enterprise);

  const platformRows = config.platforms.map((p) => {
    const platformPlan = weeks.filter((w) => w.platform === p);
    const freq = (perPlatform / durationInfo.weeks).toFixed(1);
    return `<tr>
      <td><strong>${PLATFORM_INFO[p]?.label || p}</strong></td>
      <td>${perPlatform} 篇</td>
      <td>${freq} 篇/周</td>
      <td>${platformPlan[0]?.topic || '-'}</td>
      <td>${platformPlan[1]?.topic || '-'}</td>
    </tr>`;
  }).join('\n');

  const typeRows = config.contentTypes.map((t) => {
    const typePlan = weeks.filter((w) => w.contentType === t);
    return `<tr>
      <td><strong>${CONTENT_LABELS[t]}</strong></td>
      <td>${typePlan.length} 篇</td>
      <td>${typePlan.slice(0, 2).map((w) => w.topic).join('；')}</td>
    </tr>`;
  }).join('\n');

  const calendarRows = weeks.slice(0, 30).map((w) => {
    return `<tr>
      <td>第${w.week}周</td>
      <td>${PLATFORM_INFO[w.platform]?.label || w.platform}</td>
      <td>${CONTENT_LABELS[w.contentType]}</td>
      <td>${w.keyword}</td>
      <td>${w.topic}</td>
    </tr>`;
  }).join('\n');

  const keywordRows = Object.entries(kwGroups)
    .filter(([, arr]) => arr.length > 0)
    .map(([type, arr]) => {
      const labels: Record<string, string> = { core: '核心品牌词', question: '信息查询词', comparison: '对比决策词', longtail: '长尾场景词' };
      const items = arr.map((kw) => `<li><span class="kw-q">${kw.question}</span><span class="kw-p">P${kw.priority}</span></li>`).join('');
      return `<div class="kw-group">
        <h4>${labels[type] || type}（${arr.length} 个）</h4>
        <ul class="kw-list">${items}</ul>
      </div>`;
    }).join('\n');

  const products = enterprise.products?.map((p) =>
    `<div class="product-card"><h5>${p.name}</h5><p>${p.description || '暂无描述'}</p>${p.isPrimary ? '<span class="badge-primary">主推</span>' : ''}</div>`
  ).join('') || '<p>暂无产品信息</p>';

  const trustAnchors = enterprise.trustAnchors?.map((t) => `<li>${t}</li>`).join('') || '<li>暂无</li>';
  const brandTone = enterprise.brandTone?.join('、') || '专业、可信赖';
  const painPoints = enterprise.userPainPoints?.map((p) => `<li>${p}</li>`).join('') || '<li>暂无</li>';
  const recList = recommendations.map((r, i) => `<li><span class="rec-num">${i + 1}</span><span class="rec-text">${r}</span></li>`).join('');

  // Quarterly plans
  const quarterSections = quarterLabels.map((_, qIdx) => {
    const q = getQuarterFocus(qIdx);
    const taskRows = q.tasks.map((t, i) => `<tr>
      <td>${i + 1}</td>
      <td>${t.name}</td>
      <td>${t.platform}</td>
      <td>${t.count}</td>
      <td>${t.req}</td>
    </tr>`).join('');
    return `<h3>${q.title}</h3>
    <table>
      <thead><tr><th style="width:40px;">序号</th><th>任务</th><th style="width:120px;">发布平台</th><th style="width:80px;">数量</th><th>关键要求</th></tr></thead>
      <tbody>${taskRows}</tbody>
    </table>
    <p style="margin-top:8px; font-size:12px; color: var(--primary);"><b>KPI:</b> ${q.kpi}</p>`;
  }).join('\n');

  // Roadmap
  const roadmapItems = quarterLabels.map((label, qIdx) => {
    const q = getQuarterFocus(qIdx);
    return `<div class="roadmap-item">
      <h4>${label}</h4>
      <ul>${q.tasks.slice(0, 5).map((t) => `<li>${t.name}</li>`).join('')}</ul>
      <p style="margin-top:8px; font-size:12px; color: var(--primary);"><b>KPI:</b> ${q.kpi}</p>
    </div>`;
  }).join('');

  // TDK table
  const tdkRows = tdkList.map((t) => `<tr>
    <td>${t.page}</td>
    <td>${t.title}</td>
    <td>${t.description}</td>
  </tr>`).join('\n');

  // Platform-specific data for diagnosis
  const name = enterprise.shortName || enterprise.fullName || '企业';
  const industry = getEnterpriseIndustry(enterprise);
  const location = getLocation(enterprise);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${enterprise.fullName || '企业'} GEO优化方案</title>
<style>
  :root {
    --primary: #1a56db;
    --primary-dark: #0d3a9c;
    --accent: #f59e0b;
    --danger: #dc2626;
    --success: #059669;
    --dark: #111827;
    --gray-50: #f9fafb;
    --gray-100: #f3f4f6;
    --gray-200: #e5e7eb;
    --gray-300: #d1d5db;
    --gray-500: #6b7280;
    --gray-700: #374151;
    --gray-800: #1f2937;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: var(--dark); background: var(--gray-100); line-height: 1.7; }
  .container { max-width: 960px; margin: 0 auto; padding: 0; }

  /* 封面 */
  .cover { background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 50%, #3b82f6 100%); color: white; padding: 56px 48px; position: relative; overflow: hidden; }
  .cover::before { content: ''; position: absolute; top: -50%; right: -20%; width: 400px; height: 400px; background: rgba(255,255,255,0.05); border-radius: 50%; }
  .cover::after { content: ''; position: absolute; bottom: -30%; left: -10%; width: 300px; height: 300px; background: rgba(255,255,255,0.03); border-radius: 50%; }
  .cover-tag { display: inline-block; background: rgba(255,255,255,0.15); padding: 4px 14px; border-radius: 20px; font-size: 12px; margin-bottom: 16px; }
  .cover h1 { font-size: 32px; margin-bottom: 8px; position: relative; z-index: 1; }
  .cover .subtitle { font-size: 15px; opacity: 0.85; margin-bottom: 28px; position: relative; z-index: 1; }
  .cover .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; position: relative; z-index: 1; }
  .cover .meta-item { background: rgba(255,255,255,0.1); padding: 14px 16px; border-radius: 10px; }
  .cover .meta-label { font-size: 11px; opacity: 0.7; text-transform: uppercase; letter-spacing: 0.5px; }
  .cover .meta-value { font-weight: 700; font-size: 18px; margin-top: 4px; }

  /* 目录 */
  .toc { background: white; padding: 24px 48px; border-bottom: 1px solid #e2e8f0; }
  .toc h3 { font-size: 14px; color: #64748b; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
  .toc-list { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .toc-item { font-size: 13px; color: #475569; padding: 4px 0; }
  .toc-item span { color: #2563eb; font-weight: 600; margin-right: 6px; }

  /* 章节 */
  section { background: white; padding: 32px 48px; margin-bottom: 16px; }
  section h2 { font-size: 22px; color: #1e3a5f; border-left: 5px solid #2563eb; padding-left: 14px; margin-bottom: 20px; }
  section h3 { font-size: 16px; color: #334155; margin: 24px 0 12px; }
  section h4 { font-size: 14px; color: #475569; margin: 16px 0 8px; }

  /* 统计卡片 */
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
  .stat-card { background: linear-gradient(135deg, #eff6ff, #dbeafe); border: 1px solid #bfdbfe; border-radius: 10px; padding: 18px; text-align: center; }
  .stat-num { font-size: 30px; font-weight: 700; color: #2563eb; }
  .stat-label { font-size: 12px; color: #64748b; margin-top: 4px; }

  /* 信息网格 */
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .info-item { padding: 12px 16px; background: #f8fafc; border-radius: 8px; border-left: 3px solid #e2e8f0; }
  .info-label { font-size: 11px; color: #94a3b8; margin-bottom: 2px; text-transform: uppercase; }
  .info-value { font-size: 14px; font-weight: 500; color: #334155; }

  /* 产品卡片 */
  .product-card { padding: 14px 18px; background: #f8fafc; border-radius: 8px; margin-bottom: 8px; position: relative; border-left: 3px solid #2563eb; }
  .product-card h5 { font-size: 14px; color: #1e40af; margin-bottom: 4px; }
  .product-card p { font-size: 13px; color: #64748b; }
  .badge-primary { position: absolute; top: 14px; right: 18px; background: #2563eb; color: white; font-size: 10px; padding: 2px 8px; border-radius: 10px; }

  /* 平台策略卡片 */
  .platform-strategy-card { padding: 16px 20px; background: linear-gradient(135deg, #f8fafc, #f1f5f9); border-radius: 10px; margin-bottom: 12px; border-left: 4px solid #3b82f6; }
  .ps-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
  .ps-name { font-size: 16px; font-weight: 700; color: #1e40af; }
  .ps-count { font-size: 13px; color: #2563eb; font-weight: 600; background: #dbeafe; padding: 2px 10px; border-radius: 10px; }
  .ps-desc { font-size: 13px; color: #64748b; margin-bottom: 8px; }
  .ps-strength, .ps-dist, .ps-eco { font-size: 12px; color: #475569; margin-bottom: 4px; }
  .ps-tag { display: inline-block; background: #e0e7ff; color: #4338ca; font-size: 11px; padding: 1px 8px; border-radius: 4px; margin-right: 6px; font-weight: 600; }
  .ps-tactic { font-size: 12px; color: #64748b; margin-top: 8px; padding: 8px 12px; background: white; border-radius: 6px; border: 1px solid #e2e8f0; }

  /* 内容策略卡片 */
  .content-strategy-card { padding: 14px 18px; background: #f8fafc; border-radius: 8px; margin-bottom: 10px; }
  .cs-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  .cs-label { font-size: 15px; font-weight: 600; color: #1e40af; }
  .cs-count { font-size: 12px; color: #64748b; }
  .cs-desc { font-size: 12px; color: #64748b; margin-bottom: 6px; }
  .cs-bar { height: 6px; background: #e2e8f0; border-radius: 3px; overflow: hidden; margin-bottom: 8px; }
  .cs-bar-fill { height: 100%; background: linear-gradient(90deg, #3b82f6, #60a5fa); border-radius: 3px; }
  .cs-topics { display: flex; flex-wrap: wrap; gap: 4px; }
  .topic-chip { font-size: 11px; background: #eff6ff; color: #1e40af; padding: 2px 8px; border-radius: 10px; }

  /* SARM策略 */
  .strategy-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin: 20px 0; }
  .strategy-card { padding: 20px; border-radius: 8px; border: 1px solid var(--gray-200); background: var(--gray-50); }
  .strategy-card h4 { font-size: 16px; margin-bottom: 12px; color: var(--gray-800); }
  .strategy-card ul { list-style: none; }
  .strategy-card li { font-size: 13px; color: var(--gray-700); padding: 4px 0; padding-left: 20px; position: relative; }
  .strategy-card li::before { content: "✓"; position: absolute; left: 0; color: var(--success); }

  /* 关键词 */
  .kw-group { margin-bottom: 16px; padding: 12px 16px; background: #f8fafc; border-radius: 8px; }
  .kw-list { list-style: none; }
  .kw-list li { padding: 5px 0; border-bottom: 1px solid #f1f5f9; display: flex; justify-content: space-between; align-items: center; }
  .kw-list li:last-child { border-bottom: none; }
  .kw-q { font-size: 13px; color: #334155; }
  .kw-p { font-size: 11px; color: #94a3b8; background: #f1f5f9; padding: 1px 6px; border-radius: 4px; }

  /* 表格 */
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { background: #f1f5f9; text-align: left; padding: 10px 14px; color: #475569; font-weight: 600; border-bottom: 2px solid #e2e8f0; }
  td { padding: 10px 14px; border-bottom: 1px solid #f1f5f9; color: #334155; }
  tr:hover td { background: #f8fafc; }

  /* 建议列表 */
  .rec-list { list-style: none; }
  .rec-list li { display: flex; align-items: flex-start; gap: 12px; padding: 10px 0; border-bottom: 1px solid #f1f5f9; }
  .rec-num { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; background: #2563eb; color: white; font-size: 12px; font-weight: 700; flex-shrink: 0; }
  .rec-text { font-size: 13px; color: #334155; line-height: 1.6; }

  /* Badge */
  .badge { display: inline-block; padding: 2px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; }
  .badge-danger { background: #fee2e2; color: var(--danger); }
  .badge-warning { background: #fef3c7; color: #92400e; }
  .badge-success { background: #d1fae5; color: var(--success); }
  .badge-primary { background: #dbeafe; color: var(--primary); }
  .badge-ok { background: #d1fae5; color: var(--success); }
  .badge-no { background: #fee2e2; color: var(--danger); }

  /* 路线图 */
  .roadmap { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 20px 0; }
  .roadmap-item { background: var(--gray-50); border-radius: 8px; padding: 20px; border-top: 4px solid var(--primary); }
  .roadmap-item h4 { font-size: 16px; color: var(--primary-dark); margin-bottom: 12px; }
  .roadmap-item ul { list-style: none; }
  .roadmap-item li { font-size: 13px; color: var(--gray-700); padding: 4px 0; padding-left: 16px; position: relative; }
  .roadmap-item li::before { content: "▸"; position: absolute; left: 0; color: var(--primary); }

  /* 其他 */
  ul.bullet { padding-left: 20px; }
  ul.bullet li { margin-bottom: 6px; font-size: 13px; color: #475569; }
  .calendar-note { font-size: 12px; color: #64748b; margin-top: 10px; padding: 8px 12px; background: #fffbeb; border-radius: 6px; border-left: 3px solid #fbbf24; }
  .footer { text-align: center; padding: 32px 48px; color: #94a3b8; font-size: 12px; background: white; }
  .footer-brand { font-weight: 600; color: #64748b; }
  .section-intro { font-size: 13px; color: #64748b; margin-bottom: 16px; padding: 10px 14px; background: #f8fafc; border-radius: 6px; border-left: 3px solid #cbd5e1; }
  .schema-code { background: var(--gray-800); color: #e2e8f0; padding: 16px; border-radius: 8px; font-size: 12px; overflow-x: auto; font-family: monospace; }
  @media print { section { page-break-inside: avoid; } }
  @media (max-width: 768px) {
    .roadmap { grid-template-columns: 1fr; }
    .strategy-grid { grid-template-columns: 1fr; }
    .cover .meta { grid-template-columns: repeat(2, 1fr); }
  }
</style>
</head>
<body>
<div class="container">

  <!-- 封面 -->
  <div class="cover">
    <div class="cover-tag">GEO 优化方案</div>
    <h1>${enterprise.fullName || '企业'} GEO 优化方案</h1>
    <div class="subtitle">${enterprise.description || '基于企业画像生成的AI搜索引擎优化方案'}</div>
    <div class="meta">
      <div class="meta-item"><div class="meta-label">方案周期</div><div class="meta-value">${durationInfo.label}</div></div>
      <div class="meta-item"><div class="meta-label">AI 平台</div><div class="meta-value">${config.platforms.length} 个</div></div>
      <div class="meta-item"><div class="meta-label">内容类型</div><div class="meta-value">${config.contentTypes.length} 种</div></div>
      <div class="meta-item"><div class="meta-label">总文章数</div><div class="meta-value">${totalArticles} 篇</div></div>
    </div>
  </div>

  <!-- 目录 -->
  <div class="toc">
    <h3>方案目录</h3>
    <div class="toc-list">
      <div class="toc-item"><span>01</span>执行摘要</div>
      <div class="toc-item"><span>02</span>企业画像分析</div>
      <div class="toc-item"><span>03</span>SARM优化策略</div>
      <div class="toc-item"><span>04</span>关键词矩阵</div>
      <div class="toc-item"><span>05</span>TDK与结构化数据</div>
      <div class="toc-item"><span>06</span>内容策略</div>
      <div class="toc-item"><span>07</span>AI平台分发策略</div>
      <div class="toc-item"><span>08</span>平台策略详解</div>
      <div class="toc-item"><span>09</span>季度内容规划</div>
      <div class="toc-item"><span>10</span>年度路线图</div>
      <div class="toc-item"><span>11</span>发布日历</div>
      <div class="toc-item"><span>12</span>GEO优化建议</div>
      <div class="toc-item"><span>13</span>执行规范</div>
    </div>
  </div>

  <!-- 01 执行摘要 -->
  <section>
    <h2>01 执行摘要</h2>
    <div class="stats">
      <div class="stat-card"><div class="stat-num">${totalArticles}</div><div class="stat-label">总文章数</div></div>
      <div class="stat-card"><div class="stat-num">${config.platforms.length}</div><div class="stat-label">AI平台数</div></div>
      <div class="stat-card"><div class="stat-num">${durationInfo.weeks}</div><div class="stat-label">执行周数</div></div>
      <div class="stat-card"><div class="stat-num">${articlesPerWeek}</div><div class="stat-label">篇/周</div></div>
    </div>
    <p style="font-size: 14px; color: #334155; line-height: 1.8;">
      本方案为 <strong>${enterprise.fullName || '企业'}</strong> 制定 ${durationInfo.label}的 GEO 优化策略。
      采用 <strong>SARM四维优化模型</strong>（结构化内容建设 / AI友好内容生产 / 口碑与品牌差异化 / 多平台差异化覆盖），
      通过在 ${config.platforms.map(p => PLATFORM_INFO[p]?.label || p).join('、')} 等 ${config.platforms.length} 个 AI 平台持续发布
      ${config.contentTypes.map(t => CONTENT_LABELS[t]).join('、')} 类型内容，覆盖 ${keywords.length || '多组'} 个 GEO 关键词，
      实现 AI 搜索引擎中的品牌曝光和用户触达。
    </p>
    <div style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap;">
      <span class="badge ${config.autoPublish ? 'badge-ok' : 'badge-no'}">${config.autoPublish ? '✓ 自动发布已启用' : '✗ 手动发布模式'}</span>
      <span class="badge badge-ok">审核通过率目标 90%+</span>
      <span class="badge badge-ok">AI 引用率目标 60%+</span>
      <span class="badge badge-success">泛搜索提及率目标 30%+</span>
      <span class="badge badge-primary">品牌辨识度提升</span>
    </div>
  </section>

  <!-- 02 企业画像 -->
  <section>
    <h2>02 企业画像分析</h2>
    <div class="info-grid">
      <div class="info-item"><div class="info-label">企业全称</div><div class="info-value">${enterprise.fullName || '未设置'}</div></div>
      <div class="info-item"><div class="info-label">简称</div><div class="info-value">${enterprise.shortName || '未设置'}</div></div>
      <div class="info-item"><div class="info-label">所在地</div><div class="info-value">${enterprise.location || '未设置'}</div></div>
      <div class="info-item"><div class="info-label">规模</div><div class="info-value">${enterprise.scale || '未设置'}</div></div>
      <div class="info-item"><div class="info-label">所属行业</div><div class="info-value">${industry}</div></div>
      <div class="info-item"><div class="info-label">品牌调性</div><div class="info-value">${brandTone}</div></div>
      <div class="info-item"><div class="info-label">官网</div><div class="info-value">${enterprise.website || '未设置'}</div></div>
      <div class="info-item"><div class="info-label">企业定位</div><div class="info-value">${enterprise.description?.slice(0, 50) || '暂无'}</div></div>
    </div>
    <h3>核心产品/服务</h3>
    ${products}
    <h3>品牌故事</h3>
    <p style="font-size: 13px; color: #475569; line-height: 1.8;">${enterprise.brandStory || '暂无品牌故事'}</p>
    <h3>信任锚点</h3>
    <ul class="bullet">${trustAnchors}</ul>
    <h3>用户痛点</h3>
    <ul class="bullet">${painPoints}</ul>
  </section>

  <!-- 03 SARM优化策略 -->
  <section>
    <h2>03 SARM 优化策略</h2>
    <div class="section-intro">基于企业画像，采用 <strong>SARM四维优化模型</strong>（结构化内容 / AI友好内容 / 口碑管理 / 多平台覆盖）系统性提升AI搜索引擎中的品牌可见性。</div>
    ${sarmHtml}
  </section>

  <!-- 04 关键词矩阵 -->
  <section>
    <h2>04 关键词矩阵</h2>
    <div class="section-intro">基于4层关键词体系，构建覆盖品牌识别→行业认知→购买决策全链路的关键词矩阵。</div>
    ${keywordMatrixHtml}

    ${keywords.length > 0 ? `
    <h3>关键词详情（按优先级排序）</h3>
    ${keywordRows}
    ` : ''}
  </section>

  <!-- 05 TDK与结构化数据 -->
  <section>
    <h2>05 TDK 规范与结构化数据</h2>
    <div class="section-intro">官网TDK规范和Schema.org结构化数据是AI搜索引擎理解企业实体的基础。</div>

    <h3>5.1 TDK 规范</h3>
    <table>
      <thead>
        <tr><th style="width:80px;">页面</th><th>Title（20-30字）</th><th>Description（60-80字）</th></tr>
      </thead>
      <tbody>${tdkRows}</tbody>
    </table>

    <h3>5.2 Schema JSON-LD 结构化数据</h3>
    <pre class="schema-code"><code>${schemaJsonLd}</code></pre>
  </section>

  <!-- 06 内容策略 -->
  <section>
    <h2>06 内容策略</h2>
    <div class="section-intro">根据企业画像自动推断的内容类型分配方案，每种类型有明确的策略定位和示例主题。</div>
    ${contentStrategyHtml}
    <table style="margin-top:16px;">
      <thead>
        <tr><th>内容类型</th><th>分配数量</th><th>示例主题</th></tr>
      </thead>
      <tbody>${typeRows}</tbody>
    </table>
  </section>

  <!-- 07 平台分发策略 -->
  <section>
    <h2>07 AI 平台分发策略</h2>
    <div class="section-intro">文章将在以下 ${config.platforms.length} 个 AI 平台分发，每个平台按不同特性优化内容策略。</div>
    <table>
      <thead>
        <tr><th>AI平台</th><th>文章数</th><th>发布频率</th><th>首发主题</th><th>第二篇主题</th></tr>
      </thead>
      <tbody>${platformRows}</tbody>
    </table>
  </section>

  <!-- 08 平台策略详解 -->
  <section>
    <h2>08 AI 平台策略详解</h2>
    <div class="section-intro">针对每个 AI 平台的用户画像和内容偏好，制定差异化内容策略。</div>
    ${platformStrategyHtml}
  </section>

  <!-- 09 季度内容规划 -->
  <section>
    <h2>09 季度内容规划</h2>
    <div class="section-intro">按季度制定内容发布计划，确保每个季度的内容输出量与KPI目标对齐。</div>
    ${quarterSections}
  </section>

  <!-- 10 年度路线图 -->
  <section>
    <h2>10 ${durationInfo.quarters === 1 ? '季度' : durationInfo.quarters === 2 ? '半年度' : '年度'}路线图</h2>
    <div class="roadmap">${roadmapItems}</div>
  </section>

  <!-- 11 发布日历 -->
  <section>
    <h2>11 发布日历（前 30 篇）</h2>
    <div class="section-intro">流水线启动后将按以下顺序执行文章生成和发布。每篇文章围绕一个 GEO 关键词展开。</div>
    <table>
      <thead>
        <tr><th>周次</th><th>AI平台</th><th>类型</th><th>关键词</th><th>主题</th></tr>
      </thead>
      <tbody>${calendarRows}</tbody>
    </table>
    ${weeks.length > 30 ? `<div class="calendar-note">共 ${weeks.length} 篇文章，此处仅展示前 30 篇。流水线启动后将按此顺序自动执行。</div>` : ''}
  </section>

  <!-- 12 GEO优化建议 -->
  <section>
    <h2>12 GEO 优化建议</h2>
    <div class="section-intro">基于企业画像和 AI 平台特性，以下是 ${recommendations.length} 条针对性优化建议。</div>
    <ul class="rec-list">${recList}</ul>
  </section>

  <!-- 13 执行规范 -->
  <section>
    <h2>13 执行规范</h2>
    <h3>文章生成规范</h3>
    <ul class="bullet">
      <li>每篇文章围绕一个核心 GEO 关键词展开，标题包含关键词</li>
      <li>文章结构：引言（100字）→ 正文（800-1500字）→ 总结（100字）→ CTA引导</li>
      <li>正文中自然融入品牌名称 ${enterprise.shortName || enterprise.fullName || ''}，密度控制在 3-5%</li>
      <li>正文中嵌入 2-3 个长尾关键词变体</li>
      <li>每个段落有小标题，便于 AI 提取和引用</li>
      <li>文章末尾加入品牌CTA：联系电话/官网链接/服务承诺</li>
      <li>文章中嵌入"${location}+${industry}"地域+行业关键词组合</li>
    </ul>
    <h3>审核规范</h3>
    <ul class="bullet">
      <li>8 维度审核：内容合规、GEO规范、品牌一致性、原创性、平台适配、可读性、SEO、质量</li>
      <li>审核未通过自动重新生成（最多 3 轮）</li>
      <li>审核通过后自动发布（如启用自动发布）</li>
      <li>每篇文章审核评分需达到 60 分以上方可发布</li>
    </ul>
    <h3>发布规范</h3>
    <ul class="bullet">
      <li>按平台特性调整标题长度和格式（20-100字符）</li>
      <li>标签数量符合平台限制（5-10个）</li>
      <li>${config.autoPublish ? '<span class="badge badge-ok">✓ 自动发布已启用</span>' : '<span class="badge badge-no">✗ 自动发布未启用</span>'}</li>
      <li>发布失败自动重试（最多 2 次）</li>
      <li>发布日志记录每篇文章的发布状态和错误信息</li>
    </ul>
    <h3>GEO监测规范</h3>
    <ul class="bullet">
      <li>每季度执行一次5大AI平台的GEO监测</li>
      <li>监测维度：品牌提及率、可见性评分、声量占比(SOV)、情绪判定、引用来源</li>
      <li>监测结果作为下季度内容策略调整的依据</li>
      <li>关注品牌名称与竞品的混淆度变化</li>
    </ul>
  </section>

  <!-- 页脚 -->
  <div class="footer">
    <div class="footer-brand">芯图引擎 GEO 运营平台</div>
    <div style="margin-top:4px;">本方案由系统自动生成 | 生成时间：${new Date().toLocaleString('zh-CN')}</div>
  </div>

</div>
</body>
</html>`;
}
