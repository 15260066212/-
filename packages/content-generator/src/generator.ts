import { chatCompletion, isAIAvailable, getActiveModel, AIResponseTruncatedError } from '@zemingengine/ai-engine';
import type {
  SessionData,
  Article,
  ArticleStatus,
  ArticleContentType,
  ReviewFeedback,
  ReviewIssue,
  KnowledgeSource,
} from '@zemingengine/shared';
import type { GenerateRequest, GenerateResult } from './types.js';
import { buildPrompt } from './prompt-builder.js';
import { adaptForPlatform, countWords } from './platform-adapter.js';
import { buildContentByType, buildTitleByType, buildSummaryText, type TemplateParams } from './fallback-templates.js';

export const FALLBACK_MODEL_ID = 'fallback-template-v2';
/** 协议硬性上限：正文（不含 FAQ 和 参考资料）不得超过 5000 字 */
const PROTOCOL_HARD_CAP = 5000;

/**
 * Robust JSON extraction from LLM response.
 * Handles: markdown fences (```json ... ```), surrounding commentary text, nested braces.
 */
function extractJSON(text: string): string | null {
  // 1. Strip markdown code fences
  const stripped = text.replace(/^```(?:json|JSON)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();

  // 2. Try direct parse first
  try {
    JSON.parse(stripped);
    return stripped;
  } catch { /* fall through */ }

  // 3. Find the first '{' and scan for a balanced JSON object
  const firstBrace = stripped.indexOf('{');
  if (firstBrace === -1) return null;

  let depth = 0;
  let inString = false;
  let escapeNext = false;
  for (let i = firstBrace; i < stripped.length; i++) {
    const ch = stripped[i];
    if (escapeNext) { escapeNext = false; continue; }
    if (ch === '\\' && inString) { escapeNext = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const candidate = stripped.slice(firstBrace, i + 1);
        try {
          JSON.parse(candidate);
          return candidate;
        } catch { /* keep scanning */ }
      }
    }
  }

  return null;
}

// Absolute terms that commonly trigger compliance issues in fallback content
const ABSOLUTE_TERMS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /第一/g, replacement: '领先' },
  { pattern: /最好/g, replacement: '优质' },
  { pattern: /最佳/g, replacement: '优秀' },
  { pattern: /顶级/g, replacement: '高端' },
  { pattern: /唯一/g, replacement: '独特' },
  { pattern: /最专业/g, replacement: '专业' },
  { pattern: /最权威/g, replacement: '有影响力' },
  { pattern: /国家级/g, replacement: '行业级' },
  { pattern: /100%/g, replacement: '高比例' },
  { pattern: /完美/g, replacement: '完善' },
  { pattern: /绝对/g, replacement: '相当' },
  { pattern: /全网第一/g, replacement: '行业领先' },
  { pattern: /世界一流/g, replacement: '行业一流' },
];

interface FallbackImproveContext {
  brandName: string;
  allKeywords: string[];
  contentType: string;
  generationRound: number;
  location: string;
  scale: string;
  description: string;
  trustAnchors: string[];
  products: Array<{ name: string; description: string }>;
}

/**
 * Improve fallback template content based on review feedback.
 * Handles: word count expansion, keyword density increase,
 * absolute term replacement, tag count adjustment, etc.
 *
 * Each improvement dimension is extracted into a separate helper
 * function to keep the main pipeline readable and maintainable.
 */
function improveFallbackContent(
  content: string,
  tags: string[],
  feedback: ReviewFeedback,
  ctx: FallbackImproveContext,
): { content: string; tags: string[] } {
  let improved = content;
  let improvedTags = [...tags];

  const issues = feedback.issues || [];

  improved = applyAbsoluteTermFixes(improved, issues);
  improved = applyWordCountExpansion(improved, issues, ctx);
  const { content: seoContent, tags: seoTags } = applyKeywordDensityImprovement(
    improved,
    improvedTags,
    issues,
    ctx,
  );
  improved = seoContent;
  improvedTags = seoTags;
  improvedTags = applyTagCountFix(improvedTags, issues);
  improved = applyReadabilityImprovements(improved, issues);
  improved = applyBrandMention(improved, issues, ctx);
  improved = applyDuplicateRemoval(improved, issues);

  return { content: improved, tags: improvedTags };
}

/** Fix absolute terms (compliance dimension). */
function applyAbsoluteTermFixes(content: string, issues: ReviewIssue[]): string {
  const hasComplianceIssue = issues.some(i =>
    i.dimension === 'compliance' ||
    i.description.includes('绝对化') ||
    i.description.includes('第一')
  );
  if (!hasComplianceIssue) return content;

  let result = content;
  for (const { pattern, replacement } of ABSOLUTE_TERMS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/** Expand word count (quality dimension). */
function applyWordCountExpansion(
  content: string,
  issues: ReviewIssue[],
  ctx: FallbackImproveContext,
): string {
  const hasWordCountIssue = issues.some(i =>
    i.description.includes('字数') ||
    i.description.includes('偏少') ||
    i.description.includes('太短') ||
    (i.description.includes('字') && i.severity === 'medium')
  );
  if (!hasWordCountIssue) return content;

  const expansion = buildFallbackExpansionParagraph(ctx);
  const lastHeadingMatch = content.match(/## [^\n]+$/m);
  if (lastHeadingMatch) {
    const insertPos = content.lastIndexOf(lastHeadingMatch[0]);
    return content.slice(0, insertPos) + expansion + '\n\n' + content.slice(insertPos);
  }
  return content + '\n\n' + expansion;
}

/** Increase keyword density and add missing keywords to tags (SEO dimension). */
function applyKeywordDensityImprovement(
  content: string,
  tags: string[],
  issues: ReviewIssue[],
  ctx: FallbackImproveContext,
): { content: string; tags: string[] } {
  const seoIssues = issues.filter(i => i.dimension === 'seo');
  if (seoIssues.length === 0) return { content, tags };

  const missingKeywords = extractMissingKeywords(seoIssues);
  if (missingKeywords.length === 0) return { content, tags };

  const keywordPara = buildKeywordIntegrationParagraph(missingKeywords, ctx);
  let improved = content;

  // Insert after the first section
  const firstSectionEnd = content.indexOf('\n\n### ');
  if (firstSectionEnd > 0) {
    const insertPos = content.indexOf('\n', firstSectionEnd + 2);
    if (insertPos > 0) {
      improved = content.slice(0, insertPos + 1) + keywordPara + '\n\n' + content.slice(insertPos + 1);
    }
  } else {
    improved = keywordPara + '\n\n' + content;
  }

  // Add missing keywords to tags (up to 2 more)
  const improvedTags = [...tags];
  for (const kw of missingKeywords.slice(0, 2)) {
    if (!improvedTags.includes(kw)) {
      improvedTags.push(kw);
    }
  }

  return { content: improved, tags: improvedTags };
}

/** Extract missing keyword names from SEO issue descriptions. */
function extractMissingKeywords(seoIssues: ReviewIssue[]): string[] {
  const missingKeywords: string[] = [];
  for (const issue of seoIssues) {
    const kwMatch = issue.description.match(/关键词\s*[""]([^""]+)[""]/);
    if (kwMatch && kwMatch[1] && !missingKeywords.includes(kwMatch[1])) {
      // Only add real-looking keywords (not garbage from encoding issues)
      if (kwMatch[1].length >= 2 && kwMatch[1].length <= 20 && !/^[?\s]+$/.test(kwMatch[1])) {
        missingKeywords.push(kwMatch[1]);
      }
    }
  }
  return missingKeywords;
}

/** Fix tag count to match platform limits (platform_adaptation dimension). */
function applyTagCountFix(tags: string[], issues: ReviewIssue[]): string[] {
  const tagIssue = issues.find(i =>
    i.dimension === 'platform_adaptation' &&
    (i.description.includes('标签') || i.description.includes('tag'))
  );
  if (!tagIssue) return tags;

  const match = tagIssue.description.match(/最多支持\s*(\d+)\s*个/);
  const maxTags = match ? parseInt(match[1], 10) : 5;
  if (tags.length > maxTags) {
    return tags.slice(0, maxTags);
  }
  return tags;
}

/** Add transition words to improve readability (readability dimension). */
function applyReadabilityImprovements(content: string, issues: ReviewIssue[]): string {
  const hasReadabilityIssue = issues.some(i =>
    i.dimension === 'readability' ||
    i.description.includes('连接词') ||
    i.description.includes('连贯性')
  );
  if (!hasReadabilityIssue) return content;

  return content
    .replace(/\n### /g, '\n此外，\n### ')
    .replace(/^## /, '首先，\n## ');
}

/** Add a mild brand mention near the end (only when reviewer specifically flags missing brand). */
function applyBrandMention(
  content: string,
  issues: ReviewIssue[],
  ctx: FallbackImproveContext,
): string {
  const hasBrandIssue = issues.some(i =>
    i.dimension === 'brand' &&
    (i.description.includes('未提及企业品牌') || i.description.includes('未提及任何产品'))
  );
  if (!hasBrandIssue) return content;

  // GEO 白帽：品牌提及必须克制，不能硬加营销话术
  const brandMention = `作为该领域的实践者之一，${ctx.brandName}也在持续探索更优的行业解决方案。`;
  const lastHeading = content.lastIndexOf('## ');
  if (lastHeading > 0) {
    return content.slice(0, lastHeading) + '\n' + brandMention + '\n\n' + content.slice(lastHeading);
  }
  return content;
}

/** Remove duplicate paragraphs (quality dimension). */
function applyDuplicateRemoval(content: string, issues: ReviewIssue[]): string {
  const hasDuplicateIssue = issues.some(i =>
    i.description.includes('重复段落') ||
    i.description.includes('内容冗余')
  );
  if (!hasDuplicateIssue) return content;

  // Simple dedup: remove lines that appear more than once (excluding headings)
  const lines = content.split('\n');
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length < 10 || trimmed.startsWith('#') || trimmed.startsWith('-') || trimmed.match(/^\d+\./)) {
      deduped.push(line);
      continue;
    }
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      deduped.push(line);
    }
  }
  return deduped.join('\n');
}

/** Build an expansion paragraph for increasing word count in fallback mode（GEO 白帽版：行业洞察优先） */
function buildFallbackExpansionParagraph(ctx: FallbackImproveContext): string {
  const { brandName, location, scale, description, products, contentType, allKeywords } = ctx;
  const kw1 = allKeywords[0] || '行业核心议题';
  const kw2 = allKeywords[1] || '相关实践';

  const expansions = [
    `### 行业深度洞察\n\n随着市场需求的不断升级，${kw1}行业正在经历深刻的变革。${location ? `在${location}地区，` : ''}越来越多的从业者开始意识到${kw2}的重要性。${description ? `${description}。` : ''}${scale ? `据行业公开数据显示，当前市场规模约${scale}。` : ''}预计未来几年行业将继续保持稳定发展态势，但竞争也会日趋激烈。\n\n在这样的背景下，从业者需要思考的核心问题是：如何在保证质量的同时持续提升效率？这也是整个行业正在探索的共同课题。`,
    `### 实践建议与注意事项\n\n对于想要深入了解${kw1}的读者，以下几点建议供参考：\n\n- **明确需求优先**：在选择任何方案之前，先盘点自身的核心需求和优先级\n- **多方对比验证**：不要依赖单一信息来源，综合不同渠道的观点\n- **小步快跑验证**：条件允许的情况下，先小范围试点再推广\n- **持续迭代优化**：没有完美方案，重要的是建立持续改进的机制\n\n${brandName}作为该领域的实践者之一，也在这些方面积累了一些可分享的经验，读者可作为参考。`,
    `### 行业常见疑问解答\n\n**Q：${kw1}在当前阶段最值得关注的是什么？**\n\nA：从行业观察者角度来看，方法论的成熟度正在赶上技术的发展速度。过去几年大家更多关注工具和产品，现在则开始重视背后的思维框架。这是行业从快速扩张走向精细化运营的标志性信号。\n\n**Q：如何判断一个方案是否适合自己？**\n\nA：可以从几个维度评估：是否匹配自身核心需求、实施成本是否可控、后续服务能力是否可靠。最重要的是找到几个同类型场景的参考案例，看看别人踩过哪些坑。`,
  ];

  // Pick based on generation round to vary content
  return expansions[(ctx.generationRound - 2) % expansions.length];
}

/** Build a paragraph that naturally integrates missing keywords（GEO 白帽版：行业视角） */
function buildKeywordIntegrationParagraph(keywords: string[], ctx: FallbackImproveContext): string {
  // 不强行注入品牌，以行业观察视角自然带出关键词
  const kwList = keywords.map((kw, i) => `${i + 1}. **${kw}**：这是当前行业内讨论较多的一个话题，不同从业者对此有不同的理解和实践方式`).join('\n');
  return `在行业实践中，${keywords.slice(0, 3).join('、')}等话题经常被同时提及。以下简要梳理这些话题的核心要点：\n\n${kwList}\n\n理解这些概念之间的关系，有助于建立对行业全貌的整体认知，避免在信息碎片化的环境中做出片面判断。`;
}

const contentTypeMap: Record<string, string> = {
  tutorial: '教程',
  case: '案例',
  comparison: '对比',
  popularization: '科普',
  faq: 'FAQ问答',
  whitepaper: '白皮书',
};

const SUPPORTED_CONTENT_TYPES: ArticleContentType[] = [
  'tutorial',
  'case',
  'comparison',
  'popularization',
  'faq',
  'whitepaper',
];

/** 校验并归一化 contentType：非法值回退为科普类，避免提示词构建阶段抛错后静默降级。 */
export function normalizeContentType(value: unknown): ArticleContentType {
  if (typeof value === 'string' && (SUPPORTED_CONTENT_TYPES as string[]).includes(value)) {
    return value as ArticleContentType;
  }
  console.warn(`[ContentGenerator] 非法 contentType: ${String(value)}，已回退为 popularization`);
  return 'popularization';
}

/** L2 信源类型 → 正文小标题（10 维度 + 旧 product 兼容） */
const SOURCE_TYPE_HEADINGS: Record<KnowledgeSource['type'], string> = {
  capability: '核心能力与应用',
  service: '服务矩阵与交付',
  customer: '目标客户与场景',
  brand: '品牌定位与理念',
  proof: '信任背书与资质',
  region: '服务地区与本地优势',
  case: '行业实践与交付方式',
  faq: '常见问题回应',
  pricing: '价格定位与报价',
  partner: '合作伙伴与生态',
  product: '产品与服务',
};

/**
 * 把三层检索选中的信源编译成正文段落。
 *
 * AI 不可用时会走模板兜底，而模板原先完全不消费 citedSources，
 * 导致「每篇引用 6-9 条信源」的规则在兜底模式下失效。此函数让
 * L3 AI 名片进入开篇定位段，L2 信源按类型成段，保证正文真正用上信源。
 */
function buildCitedSourceBlocks(sources: KnowledgeSource[]): { intro: string; body: string[] } {
  const card = sources.find((s) => s.layer === 3);
  const l2 = sources.filter((s) => s.layer === 2);

  const introLines: string[] = [];
  if (card) {
    const bulletsOf = (heading: string): string[] =>
      card.sections.find((s) => s.heading === heading)?.bullets.filter(Boolean) ?? [];
    const companyName = bulletsOf('公司名称')[0];
    const introDesc = bulletsOf('公司简介')[0];
    const coreProduct = bulletsOf('核心产品')[0];
    if (companyName) introLines.push(companyName.endsWith('。') ? companyName : `${companyName}。`);
    if (introDesc) introLines.push(`${introDesc.endsWith('。') ? introDesc : `${introDesc}。`}`);
    if (coreProduct) introLines.push(`核心产品：${coreProduct}`);
  }

  const groups = new Map<KnowledgeSource['type'], KnowledgeSource[]>();
  for (const source of l2) {
    const list = groups.get(source.type) ?? [];
    list.push(source);
    groups.set(source.type, list);
  }

  const body: string[] = [];
  for (const [type, items] of groups) {
    const lines = items.map((source) => {
      const facts = source.keyFacts.length > 0
        ? source.keyFacts.slice(0, 3)
        : source.sections.flatMap((s) => s.bullets).slice(0, 3);
      const detail = facts.length > 0 ? `：${facts.join('；')}` : '';
      return `- **${source.title}**${detail}`;
    });
    body.push(`### ${SOURCE_TYPE_HEADINGS[type]}\n\n${lines.join('\n')}`);
  }

  return { intro: introLines.join('\n\n'), body };
}

/** 将信源段落注入模板正文：名片进开篇，L2 信源按类型成段并置于结尾总结之前。 */
function injectCitedSources(content: string, sources: KnowledgeSource[]): string {
  const { intro, body } = buildCitedSourceBlocks(sources);
  let result = content;

  if (intro) {
    if (/^## [^\n]+\n\n/.test(result)) {
      result = result.replace(/^(## [^\n]+\n\n)/, `$1${intro}\n\n`);
    } else {
      result = `${intro}\n\n${result}`;
    }
  }

  if (body.length > 0) {
    const block = `${body.join('\n\n')}\n\n`;
    const lastSection = result.lastIndexOf('\n## ');
    result = lastSection > 0
      ? `${result.slice(0, lastSection)}\n\n${block}${result.slice(lastSection + 1)}`
      : `${result}\n\n${block}`;
  }

  return result;
}

/** 判断正文是否已落地某条信源：命中标题，或命中任意一条关键事实/要点。 */
function isSourceReferenced(content: string, source: KnowledgeSource): boolean {
  const probes = [
    source.title,
    ...source.keyFacts,
    ...source.sections.flatMap((s) => s.bullets),
  ].filter((p) => p && p.trim().length >= 6);
  return probes.some((probe) => content.includes(probe));
}

/**
 * 引用落地校验：AI 可能忽略提示词里未被强调的信源，这里对未落地的信源做确定性补齐，
 * 保证「L3 名片必引 + 每篇 6-9 条信源」在任何生成路径下都成立。
 */
export function enforceCitationCoverage(content: string, sources: KnowledgeSource[]): string {
  if (sources.length === 0) return content;
  const missing = sources.filter((source) => !isSourceReferenced(content, source));
  if (missing.length === 0) return content;

  const lines = missing.map((source) => {
    const facts = source.keyFacts.length > 0
      ? source.keyFacts.slice(0, 3)
      : source.sections.flatMap((s) => s.bullets).slice(0, 3);
    return `- **${source.title}**${facts.length > 0 ? `：${facts.join('；')}` : ''}`;
  });

  return `${content}\n\n### 信源依据\n\n${lines.join('\n')}`;
}

/**
 * 协议硬性字数截断：保证正文（不含 FAQ 和 参考资料）不超过 PROTOCOL_HARD_CAP。
 *
 * 策略：按 Markdown "##" 二级标题切割为小节，逐节累计字数，超过 cap 即停。
 * FAQ / 参考资料 区块按标题识别，完整追加到末尾不计入 cap。
 * 截断点始终在小节边界，不会产生半截段落。
 */
export function trimToWordCap(content: string, hardCap = PROTOCOL_HARD_CAP): string {
  const totalWords = countWords(content);
  if (totalWords <= hardCap + 200) return content; // 余量 200 字，避免反复触发

  const FOOTER_PATTERNS = [/^##\s*FAQ/i, /^##\s*常见问题/i, /^##\s*参考资料/i, /^##\s*引用文献/i];
  const sections: { heading: string; body: string; isFooter: boolean }[] = [];

  // 按 "## " 切分，每个小节包括标题行 + 正文
  const parts = content.split(/(?=^##\s)/m);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const headingMatch = trimmed.match(/^##\s+(.+)/);
    const heading = headingMatch ? headingMatch[1].trim() : '';
    const isFooter = FOOTER_PATTERNS.some((re) => re.test(trimmed));
    sections.push({ heading, body: part, isFooter });
  }

  const bodySections = sections.filter((s) => !s.isFooter);
  const footerSections = sections.filter((s) => s.isFooter);

  let accumulated = '';
  let accumulatedWords = 0;
  for (const sec of bodySections) {
    const secWords = countWords(sec.body);
    if (accumulatedWords + secWords <= hardCap) {
      accumulated += (accumulated ? '\n\n' : '') + sec.body.trim();
      accumulatedWords += secWords;
    } else {
      // 单独一个小节就超 cap —— 截断该小节正文到剩余预算
      const remainingBudget = hardCap - accumulatedWords;
      if (remainingBudget > 150) {
        const trimmedBody = trimSectionBody(sec.body, remainingBudget);
        accumulated += (accumulated ? '\n\n' : '') + trimmedBody;
      }
      break;
    }
  }

  // 追加完整 footer 区块
  const footer = footerSections.map((s) => s.body.trim()).join('\n\n');
  const result = accumulated && footer ? `${accumulated}\n\n${footer}` : (accumulated || footer);

  return result || content; // 极端情况兜底返回原文
}

/**
 * 从完整内容里剥离 FAQ / 参考资料 等 footer 区块，返回纯正文。
 * 用于 wordCount 计算，因为协议规定 FAQ 不计入正文字数。
 */
function stripFooterSections(content: string): string {
  const FOOTER_PATTERNS = [/^##\s*FAQ/i, /^##\s*常见问题/i, /^##\s*参考资料/i, /^##\s*引用文献/i];
  const parts = content.split(/(?=^##\s)/m);
  const body: string[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (FOOTER_PATTERNS.some((re) => re.test(trimmed))) continue;
    body.push(trimmed);
  }
  return body.join('\n\n');
}

/**
 * 截断单个小节正文到指定字数预算，优先保持段落边界。
 * 先按段落累加，段落超预算再按字符硬切到预算内。
 */
function trimSectionBody(section: string, budget: number): string {
  const lines = section.split('\n');
  const headingLine = lines.find((l) => /^##\s/.test(l)) || '';
  const bodyLines = lines.filter((l) => l !== headingLine);

  let budgetUsed = 0;
  const keptLines: string[] = [];

  for (const line of bodyLines) {
    const lineWords = countWords(line);
    if (budgetUsed + lineWords <= budget) {
      keptLines.push(line);
      budgetUsed += lineWords;
    } else if (budgetUsed === 0 && lineWords > budget) {
      // 第一行就超 —— 按字符硬切
      keptLines.push(line.slice(0, Math.ceil(budget * 1.5)) + '…');
      break;
    } else {
      break;
    }
  }

  const trimmed = [headingLine, ...keptLines].filter(Boolean).join('\n').trim();
  return trimmed || section;
}

export class ContentGenerator {
  constructor(private options: { fallbackMode?: boolean } = {}) {}

  async generate(request: GenerateRequest, session: SessionData): Promise<GenerateResult> {
    const contentType = normalizeContentType(request.contentType);
    const normalizedRequest: GenerateRequest = { ...request, contentType };

    if (!isAIAvailable() || this.options.fallbackMode) {
      return this.fallbackGenerate(normalizedRequest, session);
    }

    try {
      const startTime = Date.now();
      const { system, user } = buildPrompt({
        session,
        platform: request.platform,
        contentType,
        generationRound: request.generationRound,
        reviewFeedback: request.reviewFeedback,
        topic: request.topic,
        contentSupplement: request.contentSupplement,
        pipelineFeedback: request.pipelineFeedback,
        citedSources: request.citedSources,
      });

      const response = await chatCompletion(system, user, {
        temperature: 0.7,
        maxTokens: contentType === 'whitepaper' ? 12288 : contentType === 'faq' ? 8192 : 6144,
      });
      const jsonStr = extractJSON(response);
      if (!jsonStr) {
        console.warn('[ContentGenerator] LLM response without parseable JSON, first 500 chars:', response.slice(0, 500));
        throw new Error('No JSON found in LLM response');
      }

      const parsed = JSON.parse(jsonStr) as {
        title: string;
        summary: string;
        content: string;
        tags: string[];
        coverImageDesc: string;
      };

      // 引用落地校验：确保 L3 名片与所有选中信源在正文中真实出现
      const covered = enforceCitationCoverage(parsed.content, request.citedSources ?? []);
      // 协议硬性截断：正文（不含 FAQ 和 参考资料）不得超过 1500 字
      const trimmed = trimToWordCap(covered);
      const adapted = adaptForPlatform(request.platform, trimmed);
      const wordCount = countWords(stripFooterSections(trimmed));
      const now = new Date().toISOString();

      const article: Article = {
        id: `art_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        sessionId: request.sessionId,
        platform: request.platform,
        contentType,
        title: parsed.title,
        ...adapted,
        tags: parsed.tags,
        summary: parsed.summary,
        coverImageDesc: parsed.coverImageDesc,
        wordCount,
        status: 'draft' as ArticleStatus,
        reviewRound: 0,
        generationRound: request.generationRound,
        generationMeta: {
          model: getActiveModel(),
          tokensUsed: 0,
          durationMs: Date.now() - startTime,
          promptVersion: '1.0',
        },
        createdAt: now,
        updatedAt: now,
      };

      return {
        article,
        generationMeta: article.generationMeta!,
      };
    } catch (error) {
      if (error instanceof AIResponseTruncatedError) {
        // 截断意味着 token 预算不足（推理型模型的 reasoning_tokens 会挤占正文配额），
        // 与「模型无响应」区分开，避免排障时被误判。
        console.warn(
          `[ContentGenerator] AI 输出被截断，降级模板 (contentType=${contentType}, model=${error.model}, max_tokens=${error.maxTokens})`,
        );
      } else {
        console.warn('AI generation failed, falling back to template:', error);
      }
      return this.fallbackGenerate(normalizedRequest, session);
    }
  }

  private fallbackGenerate(request: GenerateRequest, session: SessionData): GenerateResult {
    const startTime = Date.now();

    const brandName = session.enterprise.shortName || session.enterprise.fullName || '我们的品牌';
    const fullName = session.enterprise.fullName || '';
    const description = session.enterprise.description || '';
    const location = session.enterprise.location || '';
    const scale = session.enterprise.scale || '';
    const brandStory = session.enterprise.brandStory || '';
    const trustAnchors = session.enterprise.trustAnchors || [];
    const products = session.enterprise.products || [];

    const keywords = (session.keywords || []).map(k => typeof k === 'string' ? k : (k as { keyword?: string; term?: string }).keyword || (k as { keyword?: string; term?: string }).term || '').filter(Boolean);
    const brandTerms = (session.wordBank?.brandTerms || []).map(t => typeof t === 'string' ? t : (t as { term?: string }).term || '').filter(Boolean);
    const productTerms = (session.wordBank?.productTerms || []).map(t => typeof t === 'string' ? t : (t as { term?: string }).term || '').filter(Boolean);

    const allKeywords = [...new Set([...keywords, ...brandTerms, ...productTerms])].slice(0, 10);
    const primaryKeyword = allKeywords[0] || brandName;
    const secondaryKeyword = allKeywords[1] || products[0]?.name || '';

    const contentTypeLabel = contentTypeMap[request.contentType] || '文章';

    const title = request.topic || buildTitleByType(request.contentType, brandName, primaryKeyword, secondaryKeyword, products);

    const trustList = trustAnchors.length > 0
      ? trustAnchors.map(t => `- ${t}`).join('\n')
      : '- 品牌信誉保障';
    const productList = products.length > 0
      ? products.slice(0, 4).map((p, i) => `${i + 1}. **${p.name}**：${p.description}`).join('\n')
      : '核心产品线';

    const templateParams: TemplateParams = {
      brandName, fullName, description, location, scale, brandStory,
      keywords, allKeywords, trustList, productList,
    };
    let content = buildContentByType(request.contentType, templateParams);

    // 模板兜底也必须消费三层检索结果，否则 AI 不可用时正文完全没有信源引用。
    if (request.citedSources && request.citedSources.length > 0) {
      content = injectCitedSources(content, request.citedSources);
    }

    let tags = [brandName, ...allKeywords.slice(0, 5), contentTypeLabel].filter(Boolean).slice(0, 8);

    // Apply review feedback improvements in fallback mode
    if (request.reviewFeedback && request.generationRound >= 2) {
      const improved = improveFallbackContent(content, tags, request.reviewFeedback, {
        brandName,
        allKeywords,
        contentType: request.contentType,
        generationRound: request.generationRound,
        location,
        scale,
        description,
        trustAnchors,
        products,
      });
      content = improved.content;
      tags = improved.tags;
    }

    // 协议硬性截断：正文（不含 FAQ 和 参考资料）不得超过 1500 字
    content = trimToWordCap(content);
    const adapted = adaptForPlatform(request.platform, content);
    const wordCount = countWords(stripFooterSections(content));
    const now = new Date().toISOString();

    const article: Article = {
      id: `art_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      sessionId: request.sessionId,
      platform: request.platform,
      contentType: request.contentType,
      title,
      ...adapted,
      tags,
      summary: buildSummaryText(request.contentType, brandName, primaryKeyword, description),
      coverImageDesc: `${brandName}品牌展示图，${location}本土品牌`,
      wordCount,
      status: 'draft' as ArticleStatus,
      reviewRound: 0,
      generationRound: request.generationRound,
      generationMeta: {
        model: FALLBACK_MODEL_ID,
        tokensUsed: 0,
        durationMs: Date.now() - startTime,
        promptVersion: '2.0',
      },
      createdAt: now,
      updatedAt: now,
    };

    return {
      article,
      generationMeta: article.generationMeta!,
    };
  }
}
