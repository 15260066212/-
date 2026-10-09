import type { Article, ReviewIssue } from '@zemingengine/shared';

/**
 * Safety & Trust dimension — checks for misleading claims, required
 * disclaimers, sensitive topics, and source attribution.
 *
 * This is the 8th review dimension, adding trust/safety verification
 * on top of the existing 7 dimensions (compliance, quality, seo, brand,
 * originality, platform_adaptation, readability).
 */

/** Phrases that indicate potentially misleading absolute claims. */
const MISLEADING_PATTERNS: { pattern: RegExp; suggestion: string }[] = [
  { pattern: /(100%\s*(有效|治愈|成功|保证))/gi, suggestion: '避免使用"100%有效/治愈"等绝对化表述，改为"临床研究表明"等有据可查的表述' },
  { pattern: /(完全(根治|治愈|消除))/gi, suggestion: '"完全根治/治愈"可能违反广告法，建议使用"有效改善"等限定性表述' },
  { pattern: /(绝对安全|零风险|无任何副作用)/gi, suggestion: '"绝对安全/零风险"表述不当，任何医疗行为都存在风险，需如实告知' },
  { pattern: /(包治百病|万能)/gi, suggestion: '"包治百病/万能"属于虚假宣传，请删除或替换为具体适应症' },
  { pattern: /(最(好|佳|权威|先进|领先))/gi, suggestion: '"最X"类极限用语可能违反广告法，建议使用"优质""专业"等非极限表述' },
  { pattern: /(第一品牌|行业唯一)/gi, suggestion: '"第一品牌/行业唯一"需有权威机构认证支撑，否则属于虚假宣传' },
];

/** Topics that require disclaimers. */
const SENSITIVE_TOPICS: { pattern: RegExp; disclaimer: string; severity: 'high' | 'medium' | 'low' }[] = [
  { pattern: /(手术|开刀|外科)/g, disclaimer: '医疗类内容需添加"具体治疗方案请咨询专业医师"免责声明', severity: 'medium' },
  { pattern: /(药物|用药|处方|剂量)/g, disclaimer: '药物相关内容需添加"请遵医嘱，勿自行用药"免责声明', severity: 'high' },
  { pattern: /(投资|理财|收益|回报率)/g, disclaimer: '金融类内容需添加"投资有风险，入市需谨慎"免责声明', severity: 'medium' },
  { pattern: /(疗效|治愈率|有效率)/g, disclaimer: '疗效数据需注明来源和适用条件，添加"个体差异，效果因人而异"声明', severity: 'high' },
  { pattern: /(价格|费用|收费)/g, disclaimer: '价格信息需注明"价格仅供参考，以实际就诊为准"', severity: 'low' },
];

/** Patterns indicating unverified factual claims that need source attribution. */
const CLAIM_PATTERNS: RegExp[] = [
  /据(统计|调查|研究)[，,]?(\d+|[一二三四五六七八九十百千万]+)%/g,
  /(超过|多达|高达)\s*\d+\s*(人|例|名)/g,
  /(成功率|治愈率|有效率)\s*(为|达|超)\s*\d+%/g,
  /(\d+)\s*年\s*(临床|行业|从业)\s*(经验|数据)/g,
];

/** Required disclaimer phrases. */
const DISCLAIMER_PATTERNS: RegExp[] = [
  /(个体差异|效果因人而异)/,
  /(咨询(专业)?(医师|医生|专家))/,
  /(投资有风险)/,
  /(以实际.*为准)/,
  /(仅供参考)/,
];

/**
 * Check article content for safety and trust issues.
 */
export function checkSafety(article: Article): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const content = article.contentPlain || article.contentMarkdown || '';
  const title = article.title || '';

  // 1. Check for misleading absolute claims
  for (const { pattern, suggestion } of MISLEADING_PATTERNS) {
    const textToCheck = `${title} ${content}`;
    pattern.lastIndex = 0;
    const matches = textToCheck.match(pattern);
    if (matches) {
      issues.push({
        dimension: 'safety',
        severity: 'high',
        description: `误导性声明: 检测到"${matches[0]}"等绝对化/误导性表述`,
        suggestion,
      });
    }
  }

  // 2. Check for sensitive topics requiring disclaimers
  const fullText = `${title} ${content}`;
  const foundTopics: Set<string> = new Set();

  // Check if content already has disclaimer phrases — if present, skip per-topic flags
  const hasAnyDisclaimer = DISCLAIMER_PATTERNS.some((p) => p.test(fullText));

  for (const { pattern, disclaimer, severity } of SENSITIVE_TOPICS) {
    // Reset regex lastIndex to avoid /g flag state issues
    pattern.lastIndex = 0;
    if (pattern.test(fullText)) {
      foundTopics.add(disclaimer);
      // Only flag if no disclaimer is present in the content
      if (!hasAnyDisclaimer) {
        issues.push({
          dimension: 'safety',
          severity,
          description: `敏感话题缺少免责声明: ${disclaimer}`,
          suggestion: `请在文末添加免责声明: "${disclaimer}"`,
        });
      }
    }
  }

  // 3. Check for unverified factual claims without source attribution
  for (const claimPattern of CLAIM_PATTERNS) {
    const matches = fullText.match(claimPattern);
    if (matches) {
      // Check if there's a source nearby (look for 来源/据/参考 patterns)
      const hasSource = /(来源[:：]|据.*报道|参考.*文献|数据来源)/i.test(fullText);
      if (!hasSource) {
        issues.push({
          dimension: 'safety',
          severity: 'medium',
          description: `数据声明缺少来源标注: 检测到"${matches[0]}"，但未找到数据来源标注`,
          suggestion: '为所有统计数据和疗效声明添加来源标注（如"来源：XXX研究报告"）',
        });
      }
    }
  }

  // 4. Check if content has appropriate disclaimers when needed
  const hasMedicalContent = /(医院|诊所|治疗|手术|药物|医师|病情)/i.test(fullText);
  const hasFinancialContent = /(投资|理财|收益|基金|股票)/i.test(fullText);

  if (hasMedicalContent || hasFinancialContent) {
    const hasDisclaimer = DISCLAIMER_PATTERNS.some((p) => p.test(fullText));
    if (!hasDisclaimer) {
      issues.push({
        dimension: 'safety',
        severity: 'high',
        description: '涉及医疗/金融内容但缺少必要的免责声明',
        suggestion: hasMedicalContent
          ? '请添加"以上内容仅供参考，具体治疗方案请咨询专业医师"等免责声明'
          : '请添加"投资有风险，入市需谨慎"等免责声明',
      });
    }
  }

  // 5. Check for false authority (fake certifications/awards)
  const fakeAuthorityPattern = /(ISO\s*\d+|AAA级|国家认证|权威认证|官方指定)/gi;
  if (fakeAuthorityPattern.test(fullText)) {
    issues.push({
      dimension: 'safety',
      severity: 'medium',
      description: '检测到权威认证声明，请确保有对应的认证编号和发证机构',
      suggestion: '如有认证资质，请标注认证编号和发证机构；如无，请删除相关表述',
    });
  }

  return issues;
}
