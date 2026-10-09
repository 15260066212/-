import type { Article, ReviewIssue } from '@zemingengine/shared';

const STOP_WORDS = new Set([
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一',
  '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有',
  '看', '好', '自己', '这', '那', '与', '或', '但', '而', '以', '对', '为',
  '被', '让', '从', '把', '它', '他', '她', '们', '那', '这个', '那个',
  '可以', '这样', '那种', '由于', '因为', '所以', '但是', '然而',
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or', 'but', 'if',
  'this', 'that', 'it', 'they', 'we', 'you', 'he', 'she',
]);

function tokenize(text: string): string[] {
  return text
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t.toLowerCase()));
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[b.length][a.length];
}

function similarity(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0;
  const maxLen = Math.max(a.length, b.length);
  return 1 - levenshtein(a, b) / maxLen;
}

export function checkQuality(article: Article): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const plainText = article.contentPlain ?? article.contentMarkdown;

  // 1. 字数检查
  if (article.wordCount < 300) {
    issues.push({
      dimension: 'quality',
      severity: 'high',
      description: `文章字数过少（${article.wordCount} 字），建议至少 300 字`,
      suggestion: '扩充内容深度，增加细节描述或案例分析',
    });
  } else if (article.wordCount < 800) {
    issues.push({
      dimension: 'quality',
      severity: 'medium',
      description: `文章字数偏少（${article.wordCount} 字），建议达到 800 字以上`,
      suggestion: '适当增加内容篇幅，提升信息密度',
    });
  }

  // 2. 段落数量检查
  const paragraphs = plainText
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length < 3) {
    issues.push({
      dimension: 'quality',
      severity: 'medium',
      description: `段落数量过少（${paragraphs.length} 段），建议至少 3 段`,
      suggestion: '合理划分段落，提升文章可读性',
    });
  }

  // 3. 精确重复段落检测
  const seen = new Set<string>();
  for (const para of paragraphs) {
    if (seen.has(para)) {
      issues.push({
        dimension: 'quality',
        severity: 'medium',
        description: '检测到重复段落内容',
        suggestion: '删除或改写重复段落，避免内容冗余',
      });
      break;
    }
    seen.add(para);
  }

  // 4. 近似重复段落检测（Levenshtein 相似度）
  if (paragraphs.length >= 3) {
    const meaningfulParas = paragraphs.filter((p) => p.length > 20);
    let nearDupCount = 0;
    for (let i = 0; i < meaningfulParas.length; i++) {
      for (let j = i + 1; j < meaningfulParas.length; j++) {
        if (similarity(meaningfulParas[i], meaningfulParas[j]) > 0.7) {
          nearDupCount++;
        }
      }
    }
    if (nearDupCount > 0) {
      issues.push({
        dimension: 'quality',
        severity: nearDupCount > 2 ? 'high' : 'medium',
        description: `检测到 ${nearDupCount} 组高度相似段落（相似度 > 70%）`,
        suggestion: '合并或改写相似段落，确保每段传达不同信息',
      });
    }
  }

  // 5. 信息密度评估（unique meaningful words / total words）
  const tokens = tokenize(plainText);
  if (tokens.length > 0) {
    const uniqueTokens = new Set(tokens.map((t) => t.toLowerCase()));
    const density = uniqueTokens.size / tokens.length;

    if (density < 0.3 && tokens.length > 50) {
      issues.push({
        dimension: 'quality',
        severity: 'medium',
        description: `信息密度偏低（词汇丰富度 ${(density * 100).toFixed(1)}%），内容可能过于空泛`,
        suggestion: '增加具体数据、案例或专业术语，提升信息量',
      });
    } else if (density > 0.85 && tokens.length > 50) {
      issues.push({
        dimension: 'quality',
        severity: 'low',
        description: `词汇过度多样（丰富度 ${(density * 100).toFixed(1)}%），可能缺乏聚焦`,
        suggestion: '围绕核心主题展开，适当重复关键词以强化主题',
      });
    }
  }

  // 6. 内容结构完整性检查（引言→正文→结论）
  if (paragraphs.length >= 4 && article.wordCount > 500) {
    const firstPara = paragraphs[0];
    const lastPara = paragraphs[paragraphs.length - 1];

    const introSignals = ['介绍', '今天', '本文', '我们', '为您', '探讨', '分享', '了解', '首先'];
    const conclusionSignals = ['总结', '综上', '以上就是', '希望', '通过以上', '总而言之', '最终', ' 综上所述'];

    const hasIntro = introSignals.some((s) => firstPara.includes(s));
    const hasConclusion = conclusionSignals.some((s) => lastPara.includes(s));

    if (!hasIntro && !hasConclusion) {
      issues.push({
        dimension: 'quality',
        severity: 'low',
        description: '文章缺少清晰的引言和结论结构',
        suggestion: '在开头简要引入主题，结尾总结要点，提升内容完整性',
      });
    } else if (hasIntro && !hasConclusion) {
      issues.push({
        dimension: 'quality',
        severity: 'low',
        description: '文章缺少结论段落',
        suggestion: '在文末添加总结段落，强化核心观点',
      });
    }
  }

  // 7. 空内容段落检测
  const thinParagraphs = paragraphs.filter((p) => p.length < 10 && p.length > 0);
  if (thinParagraphs.length > 2) {
    issues.push({
      dimension: 'quality',
      severity: 'low',
      description: `检测到 ${thinParagraphs.length} 个过短段落（<10字）`,
      suggestion: '丰富短段落内容或合并到相邻段落',
    });
  }

  return issues;
}
