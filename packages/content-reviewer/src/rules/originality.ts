import type { Article, ReviewIssue } from '@zemingengine/shared';

/**
 * 文内重复度检查（曾用名「原创度/originality」）。
 *
 * 注意：本检查只做文内启发式统计——重复句、句/段 bigram Jaccard、
 * 模板套话正则、句长变异等。不接入外部语料库或向量比对，
 * 无法检测与全网/历史文章的抄袭重复。UI 层应显示为「文内重复度」。
 */
function buildBigrams(text: string): Set<string> {
  const chars = text.replace(/\s+/g, '');
  const bigrams = new Set<string>();
  for (let i = 0; i < chars.length - 1; i++) {
    bigrams.add(chars.slice(i, i + 2));
  }
  return bigrams;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return intersection / union;
}

export function checkOriginality(article: Article): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const text = article.contentPlain ?? article.contentMarkdown;

  const sentences = text
    .split(/[。！？\n.!?]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);

  // 1. Exact duplicate detection
  const seenSentences = new Set<string>();
  let exactDuplicateCount = 0;
  for (const sentence of sentences) {
    if (seenSentences.has(sentence)) {
      exactDuplicateCount++;
    }
    seenSentences.add(sentence);
  }

  if (exactDuplicateCount > 0) {
    issues.push({
      dimension: 'originality',
      severity: exactDuplicateCount > 2 ? 'high' : 'medium',
      description: `检测到 ${exactDuplicateCount} 个完全重复句子`,
      suggestion: '改写重复内容，确保文章原创性',
    });
  }

  // 2. N-gram (bigram) based near-duplicate detection
  const sentenceBigrams = sentences.map((s) => ({ text: s, bigrams: buildBigrams(s) }));
  let nearDuplicateCount = 0;
  for (let i = 0; i < sentenceBigrams.length; i++) {
    for (let j = i + 1; j < sentenceBigrams.length; j++) {
      const sim = jaccardSimilarity(sentenceBigrams[i].bigrams, sentenceBigrams[j].bigrams);
      if (sim > 0.6 && sentenceBigrams[i].text !== sentenceBigrams[j].text) {
        nearDuplicateCount++;
      }
    }
  }

  if (nearDuplicateCount > 0) {
    issues.push({
      dimension: 'originality',
      severity: nearDuplicateCount > 3 ? 'high' : 'medium',
      description: `检测到 ${nearDuplicateCount} 组高度相似句子（bigram Jaccard > 0.6）`,
      suggestion: '用不同表述方式改写相似句子，降低内容重复度',
    });
  }

  // 3. Expanded template/AI-generated content patterns
  const templatePatterns = [
    /作为.{0,10}的专业团队/,
    /我们致力于/,
    /在本篇文章中.{0,5}我们将/,
    /总结[：:]\s*$/,
    /以上就是.{0,10}的全部内容/,
    /作为.{0,10}的领先/,
    /拥有.{0,10}年.{0,5}经验/,
    /秉承.{0,8}理念/,
    /为客户提供.{0,10}服务/,
    /致力于为.{0,10}提供/,
    /凭借.{0,10}的优势/,
    /凭借.{0,10}的技术/,
    /经过.{0,8}的发展/,
    /是一家.{0,15}的企业/,
    /总部位于.{0,10}的/,
    /业务涵盖.{0,15}等领域/,
    /已成为.{0,10}的标杆/,
    /荣获.{0,10}称号/,
    /通过了.{0,10}认证/,
    /在当今.{0,5}的时代/,
    /随着.{0,10}的不断发展/,
    /众所周知/,
    /毋庸置疑/,
    /不可否认/,
  ];

  let templateMatchCount = 0;
  for (const pattern of templatePatterns) {
    if (pattern.test(text)) {
      templateMatchCount++;
    }
  }

  if (templateMatchCount >= 3) {
    issues.push({
      dimension: 'originality',
      severity: 'high',
      description: `文章存在 ${templateMatchCount} 处模板化表达，AI生成痕迹明显`,
      suggestion: '大幅改写套话式表述，增加独特观点、实际案例或数据支撑',
    });
  } else if (templateMatchCount >= 2) {
    issues.push({
      dimension: 'originality',
      severity: 'medium',
      description: `文章存在 ${templateMatchCount} 处模板化表达`,
      suggestion: '减少套话式表达，增加独特观点或案例',
    });
  }

  // 4. Sentence length uniformity detection (AI tends to produce uniform-length sentences)
  if (sentences.length >= 5) {
    const lengths = sentences.map((s) => s.length);
    const avgLen = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const variance = lengths.reduce((sum, len) => sum + (len - avgLen) ** 2, 0) / lengths.length;
    const stdDev = Math.sqrt(variance);
    const cv = avgLen > 0 ? stdDev / avgLen : 0;

    if (cv < 0.15 && avgLen > 15) {
      issues.push({
        dimension: 'originality',
        severity: 'medium',
        description: `句子长度高度均匀（变异系数 ${cv.toFixed(2)}），疑似AI生成`,
        suggestion: '增加长短句交错，模拟自然写作节奏，降低AI生成特征',
      });
    }
  }

  // 5. Content uniqueness ratio
  if (sentences.length > 0) {
    const uniqueRatio = (sentences.length - exactDuplicateCount) / sentences.length;
    if (uniqueRatio < 0.8) {
      issues.push({
        dimension: 'originality',
        severity: 'high',
        description: `内容重复率较高（${Math.round((1 - uniqueRatio) * 100)}%）`,
        suggestion: '大幅改写重复段落，确保内容具有足够的原创性',
      });
    }
  }

  // 6. Paragraph-level near-duplicate detection (bigram based)
  const paragraphs = text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 30);

  if (paragraphs.length >= 3) {
    const paraBigrams = paragraphs.map((p) => ({ text: p, bigrams: buildBigrams(p) }));
    let paraDupCount = 0;
    for (let i = 0; i < paraBigrams.length; i++) {
      for (let j = i + 1; j < paraBigrams.length; j++) {
        const sim = jaccardSimilarity(paraBigrams[i].bigrams, paraBigrams[j].bigrams);
        if (sim > 0.5) {
          paraDupCount++;
        }
      }
    }

    if (paraDupCount > 0) {
      issues.push({
        dimension: 'originality',
        severity: paraDupCount > 1 ? 'high' : 'medium',
        description: `检测到 ${paraDupCount} 组高度相似段落（bigram相似度 > 0.5）`,
        suggestion: '合并或大幅改写相似段落，确保每段传达不同信息',
      });
    }
  }

  // 7. Transition phrase density (AI overuses transitional phrases)
  const transitionPhrases = [
    '首先', '其次', '此外', '另外', '然而', '因此', '所以',
    '总之', '综上', '最后', '值得注意的是', '需要指出的是',
    '与此同时', '不仅如此', '更重要的是',
  ];
  let transitionCount = 0;
  for (const phrase of transitionPhrases) {
    const matches = text.match(new RegExp(phrase, 'g'));
    if (matches) transitionCount += matches.length;
  }
  const transitionDensity = sentences.length > 0 ? transitionCount / sentences.length : 0;
  if (transitionDensity > 0.35 && sentences.length > 8) {
    issues.push({
      dimension: 'originality',
      severity: 'low',
      description: `过渡连接词密度过高（${(transitionDensity * 100).toFixed(0)}%），行文模式化`,
      suggestion: '减少机械式过渡词使用，用语义自然衔接替代',
    });
  }

  return issues;
}
