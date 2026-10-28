import type { Article, ReviewIssue, SessionData, KnowledgeSource, DocumentItem, AICard } from '@zemingengine/shared';

/**
 * 文章真实性审核（Truthfulness）。
 *
 * 目标：校验 LLM 自由生成的内容是否有企业知识库依据，拦截以下几类幻觉：
 *   1. 无来源数据声明（百分比/金额/倍数/用户数等）且知识库中不存在该数据；
 *   2. 虚构的企业产品/能力名称（知识库 products 中没有）；
 *   3. 虚构的信任背书/资质/奖项（trustAnchors 中没有）；
 *   4. 针对企业的绝对化声明（最/第一/唯一/领先）；
 *   5. 与企业画像矛盾的基础事实（成立年份、所在地等）。
 *
 * 判定原则：
 *   - 只有"与企业相关"的声明才需要知识库落地；通用行业观察、方法论、趋势展望
 *     不属于企业事实，不强制要求知识库支撑（GEO 白帽要求 ≥60% 行业内容）。
 *   - 数字声明若文中自带来源标注（据/来源/公开披露等）则放过，由人工/外部核验。
 *   - 高严重度问题触发 reviewer veto（文章不得通过）。
 */

/** 附近（同句）出现这些词视为"已标注来源"，放过数字声明。 */
const SOURCE_INDICATORS = [
  '根据', '据', '来源', '数据来自', '公开披露',
  '第三方报告', '调研报告', '行业报告', '财报',
  '机构数据', '统计', '抽样', '调查',
  '内部数据', '企业内部', '公开数据', '官方数据',
];

/** 性能/效果类动词，数字 + 这类动词 + 企业相关词 = 高风险数据声明。 */
const PERFORMANCE_VERBS = [
  '提升', '提高', '增长', '增加', '降低', '下降', '减少',
  '达到', '高达', '超过', '突破', '实现', '完成',
  '覆盖', '服务', '赋能', '助力', '帮助',
];

/** 数字声明模式：百分比 / 倍数 / 金额 / 数量。 */
const NUMBER_PATTERNS: RegExp[] = [
  /\d+(?:\.\d+)?%/,
  /\d+(?:\.\d+)?\s*倍/,
  /\d+\s*(?:万|千|亿)?\s*(?:元|块|金额|费用|预算|营收)/,
  /\d+\s*(?:万|千|亿)?\s*(?:家|个|名|人|例|户|企业|客户|用户)/,
  /(?:提升|增长|降低|下降|增加|减少)\s*\d+(?:\.\d+)?%?/,
];

/** 绝对化极限用语（广告法高危）。 */
const ABSOLUTE_TERMS = [
  '最好', '最佳', '最优', '最强', '最大', '最小', '最快', '最专业', '最权威', '最先进',
  '第一', '唯一', '独家', '首创', '首家', '顶级', '顶尖', '极品', '完美', '100%',
];

/** 资质/认证/奖项类模式（用于虚构信任背书检测）。 */
const CERTIFICATION_PATTERNS: RegExp[] = [
  /ISO\s*\d+/i,
  /(?:CMMI|CMM|ISO|OHSAS|HSE|HIPAA|SOC\s*2?|等保|ICP|EDI|ISP)\s*\d*(?:级|认证)?/i,
  /(?:国家|省级|市级|行业)\s*(?:认证|资质|证书|奖项|荣誉|专利|高新|示范)/,
  /(?:AAA|AA|A)\s*级/,
  /(?:专利|软著|著作权)\s*\d*/,
];

/** 产品/能力名称后缀模式。 */
const PRODUCT_SUFFIX = /(系统|平台|引擎|工具|中台|软件|方案|服务|助手|管家|中心)$/;

/** 把知识库全部可引用文本摊平为一个字符串，用于"是否在知识库中出现"的落地校验。 */
function buildGroundedCorpus(session: SessionData): string {
  const kb = session.knowledgeBase;
  const parts: string[] = [];

  const pushSource = (s: KnowledgeSource | undefined) => {
    if (!s) return;
    parts.push(s.title);
    parts.push(s.tags.join(' '));
    for (const sec of s.sections ?? []) {
      parts.push(sec.heading, ...sec.bullets);
    }
    parts.push(...(s.keyFacts ?? []));
  };

  const pushDoc = (d: DocumentItem) => {
    parts.push(d.title, d.content ?? '');
    parts.push(...(d.tags ?? []));
    for (const sec of d.sections ?? []) {
      parts.push(sec.heading, ...sec.bullets);
    }
    parts.push(...(d.keyFacts ?? []));
  };

  for (const s of kb.sources ?? []) pushSource(s);
  pushSource(kb.card?.source);
  for (const d of kb.documents ?? []) pushDoc(d);

  // 企业原始字段也作为落地依据（L1 原料）
  const ent = session.enterprise;
  parts.push(ent.fullName, ent.shortName ?? '', ent.description ?? '', ent.brandStory ?? '');
  parts.push(...(ent.trustAnchors ?? []));
  parts.push(...(ent.brandTone ?? []));
  for (const p of ent.products ?? []) {
    parts.push(p.name, p.description ?? '', p.category ?? '');
  }
  parts.push(ent.location ?? '', ent.scale ?? '', ent.foundedYear ?? '', ent.website ?? '');
  parts.push(ent.address ?? '', ent.phone ?? '', ent.email ?? '');

  return parts.filter(Boolean).join('\n');
}

/** 提取企业品牌名 + 产品名，用于判断一句话是否在谈论该企业。 */
function buildEnterpriseTokens(session: SessionData): { brands: string[]; products: string[]; trustAnchors: string[] } {
  const ent = session.enterprise;
  const brands = [ent.fullName, ent.shortName].filter((s): s is string => !!s && s.trim().length > 0);
  const products = (ent.products ?? []).map((p) => p.name).filter((n) => n.trim().length > 0);
  const trustAnchors = (ent.trustAnchors ?? []).filter((s) => s.trim().length > 0);
  return { brands, products, trustAnchors };
}

/** 句子切分：按中文句号/问号/感叹号/换行拆分，过滤过短片段。 */
function splitSentences(text: string): string[] {
  return text
    .split(/[。！？!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 6);
}

/** 判断句子是否在谈论该企业（出现品牌名或产品名）。 */
function isAboutEnterprise(sentence: string, brands: string[], products: string[]): boolean {
  return brands.some((b) => sentence.includes(b)) || products.some((p) => sentence.includes(p));
}

/** 句子中是否已标注来源。 */
function hasSourceAttribution(sentence: string): boolean {
  return SOURCE_INDICATORS.some((s) => sentence.includes(s));
}

/** 抽取句子中的数字 token 字符串（用于在知识库语料中查找）。 */
function extractNumbers(sentence: string): string[] {
  const nums = new Set<string>();
  for (const pattern of NUMBER_PATTERNS) {
    const matches = sentence.match(new RegExp(pattern.source, 'g'));
    if (matches) matches.forEach((m) => nums.add(m));
  }
  return [...nums];
}

/**
 * 检测虚构产品名：仅当句子在谈论该企业，且出现"品牌名 + 产品后缀"形式的
 * 产品名（说明是在宣称这是该企业的产品），但该产品不在 enterprise.products 中。
 * 为避免误伤"强大的智能引擎产品"这类带修饰语的已知产品，凡是候选中包含
 * 已知产品名的一律放过。
 */
function findFabricatedProducts(sentence: string, brands: string[], products: string[]): string[] {
  if (!isAboutEnterprise(sentence, brands, products)) return [];
  const knownLower = products.map((p) => p.toLowerCase());
  const brandShort = (brands[1] || brands[0] || '').toLowerCase();

  // 匹配"品牌名(可选)+ 2-10字产品名 + 产品后缀"，限定候选必须包含品牌名才判定为企业产品
  const productRegex = new RegExp(
    `(?:${brands.map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})?[\\u4e00-\\u9fa5A-Za-z0-9]{2,10}(?:系统|平台|引擎|工具|中台|软件|方案|服务|助手|管家|中心)`,
    'g',
  );
  const candidates = sentence.match(productRegex) ?? [];

  return candidates
    .filter((c) => c.length <= 16)
    .filter((c) => {
      const lower = c.toLowerCase();
      // 候选必须包含品牌名（明确归属于该企业），否则视为行业通用名，不判定为虚构
      if (brandShort && !lower.includes(brandShort)) return false;
      // 候选中包含任一已知产品名 → 是已知产品的修饰形式，放过
      if (knownLower.some((p) => p && lower.includes(p))) return false;
      // 候选本身就是已知产品
      if (knownLower.includes(lower)) return false;
      // 候选等于品牌名本身
      if (brands.some((b) => b.toLowerCase() === lower)) return false;
      return true;
    });
}

/** 检测虚构信任背书：句子出现认证/资质模式，但该表述不在 trustAnchors 中。 */
function findFabricatedTrust(sentence: string, trustAnchors: string[]): string[] {
  const hits: string[] = [];
  for (const pattern of CERTIFICATION_PATTERNS) {
    const m = sentence.match(pattern);
    if (m) {
      const hit = m[0];
      const known = trustAnchors.some((t) => t.includes(hit) || hit.includes(t));
      if (!known) hits.push(hit);
    }
  }
  return hits;
}

/** 检测针对企业的绝对化声明。 */
function findAbsoluteEnterpriseClaims(sentence: string, brands: string[], products: string[]): string[] {
  if (!isAboutEnterprise(sentence, brands, products)) return [];
  return ABSOLUTE_TERMS.filter((t) => sentence.includes(t));
}

/** 检测与企业画像矛盾的基础事实（成立年份、所在地）。 */
function findContradictoryFacts(sentence: string, session: SessionData): string[] {
  const issues: string[] = [];
  const ent = session.enterprise;

  // 成立年份矛盾
  const yearMatch = sentence.match(/成立于\s*(\d{4})\s*年/);
  if (yearMatch && ent.foundedYear) {
    if (yearMatch[1] !== String(ent.foundedYear)) {
      issues.push(`"成立于${yearMatch[1]}年"与企业画像"${ent.foundedYear}"不符`);
    }
  }

  // 所在地矛盾
  if (ent.location) {
    const locMatch = sentence.match(/(?:总部位于|坐落于|位于|地处)\s*([\u4e00-\u9fa5]{2,8})/);
    if (locMatch && !ent.location.includes(locMatch[1]) && !locMatch[1].includes(ent.location.slice(0, 2))) {
      issues.push(`"位于${locMatch[1]}"与企业画像"${ent.location}"不符`);
    }
  }

  return issues;
}

export function checkTruthfulness(article: Article, session: SessionData): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const text = `${article.title}\n${article.contentPlain ?? article.contentMarkdown ?? ''}`;
  const sentences = splitSentences(text);
  const { brands, products, trustAnchors } = buildEnterpriseTokens(session);
  const grounded = buildGroundedCorpus(session);

  // 1. 无来源企业数据声明
  let unverifiedNumberCount = 0;
  const unverifiedNumberSamples: string[] = [];
  for (const sentence of sentences) {
    if (!isAboutEnterprise(sentence, brands, products)) continue;
    if (hasSourceAttribution(sentence)) continue;
    const hasPerformanceVerb = PERFORMANCE_VERBS.some((v) => sentence.includes(v));
    if (!hasPerformanceVerb && !/\d/.test(sentence)) continue;

    const numbers = extractNumbers(sentence);
    if (numbers.length === 0) continue;

    // 数字是否在知识库语料中出现（落地校验）
    const ungrounded = numbers.filter((n) => !grounded.includes(n));
    if (ungrounded.length > 0) {
      unverifiedNumberCount += ungrounded.length;
      if (unverifiedNumberSamples.length < 3) {
        unverifiedNumberSamples.push(`${sentence.slice(0, 40)}（${ungrounded.join('、')}）`);
      }
    }
  }
  if (unverifiedNumberCount >= 3) {
    issues.push({
      dimension: 'truthfulness',
      severity: 'high',
      description: `发现 ${unverifiedNumberCount} 处企业相关数据声明无知识库依据且未标注来源（如：${unverifiedNumberSamples.join('；')}），存在数据幻觉风险`,
      suggestion: '所有企业数据必须来自知识库已收录的事实，或在文中明确标注来源（如"据 XX 报告"）；无法核验的数字请改为定性描述',
    });
  } else if (unverifiedNumberCount >= 1) {
    issues.push({
      dimension: 'truthfulness',
      severity: 'medium',
      description: `发现 ${unverifiedNumberCount} 处企业相关数据声明无知识库依据且未标注来源`,
      suggestion: '补充数据来源或改为定性描述（如"显著提升"）',
    });
  }

  // 2. 虚构产品/能力名称
  const fabricatedProducts = new Set<string>();
  for (const sentence of sentences) {
    for (const p of findFabricatedProducts(sentence, brands, products)) {
      fabricatedProducts.add(p);
    }
  }
  if (fabricatedProducts.size > 0) {
    issues.push({
      dimension: 'truthfulness',
      severity: 'high',
      description: `检测到知识库中不存在的产品/能力名称：${[...fabricatedProducts].slice(0, 5).join('、')}，可能为虚构`,
      suggestion: '仅使用企业已配置的产品名称；如确需新增产品，请先在企业画像中补充',
    });
  }

  // 3. 虚构信任背书/资质
  const fabricatedTrust = new Set<string>();
  for (const sentence of sentences) {
    for (const t of findFabricatedTrust(sentence, trustAnchors)) {
      fabricatedTrust.add(t);
    }
  }
  if (fabricatedTrust.size > 0) {
    issues.push({
      dimension: 'truthfulness',
      severity: 'medium',
      description: `检测到企业信任锚点中未收录的资质/认证声明：${[...fabricatedTrust].slice(0, 5).join('、')}`,
      suggestion: '仅使用 trustAnchors 中已配置的信任背书；如确有该资质，请先补充到企业画像',
    });
  }

  // 4. 针对企业的绝对化声明
  const absoluteClaims = new Set<string>();
  for (const sentence of sentences) {
    for (const t of findAbsoluteEnterpriseClaims(sentence, brands, products)) {
      absoluteClaims.add(t);
    }
  }
  if (absoluteClaims.size > 0) {
    issues.push({
      dimension: 'truthfulness',
      severity: 'high',
      description: `检测到针对企业的绝对化/极限用语：${[...absoluteClaims].slice(0, 5).join('、')}，既违反广告法也无法被知识库支撑`,
      suggestion: '删除极限用语，改为客观描述（如"领先"→"处于行业前列"），或补充权威来源',
    });
  }

  // 5. 与企业画像矛盾的基础事实
  const contradictions: string[] = [];
  for (const sentence of sentences) {
    contradictions.push(...findContradictoryFacts(sentence, session));
  }
  if (contradictions.length > 0) {
    issues.push({
      dimension: 'truthfulness',
      severity: 'high',
      description: `检测到与企业画像矛盾的事实声明：${contradictions.slice(0, 3).join('；')}`,
      suggestion: '以企业画像为准修正文章中的基础事实',
    });
  }

  return issues;
}
