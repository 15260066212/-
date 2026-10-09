import type { Article, ReviewIssue } from '@zemingengine/shared';

function splitSentences(text: string): string[] {
  return text
    .split(/[。！？\n.!?；;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function countSyllables(word: string): number {
  const lower = word.toLowerCase();
  if (lower.length <= 3) return 1;
  const trimmed = lower.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const matches = trimmed.match(/[aeyiouy]+/g);
  return matches ? matches.length : 1;
}

export function checkReadability(article: Article): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const plainText = article.contentPlain ?? article.contentMarkdown;
  const sentences = splitSentences(plainText);

  if (sentences.length === 0) return issues;

  // 1. 平均句长评估
  const sentenceLengths = sentences.map((s) => s.length);
  const avgSentenceLength = sentenceLengths.reduce((a, b) => a + b, 0) / sentences.length;

  if (avgSentenceLength > 80) {
    issues.push({
      dimension: 'readability',
      severity: 'high',
      description: `平均句长过长（${Math.round(avgSentenceLength)} 字/句），阅读困难`,
      suggestion: '将长句拆分为短句，目标平均句长 30-50 字',
    });
  } else if (avgSentenceLength > 60) {
    issues.push({
      dimension: 'readability',
      severity: 'medium',
      description: `平均句长偏长（${Math.round(avgSentenceLength)} 字/句）`,
      suggestion: '适当拆分长句，提升阅读流畅度',
    });
  }

  // 2. 句长多样性（标准差/变异系数）
  if (sentences.length >= 4) {
    const variance = sentenceLengths.reduce(
      (sum, len) => sum + (len - avgSentenceLength) ** 2,
      0,
    ) / sentences.length;
    const stdDev = Math.sqrt(variance);
    const cv = avgSentenceLength > 0 ? stdDev / avgSentenceLength : 0;

    if (cv < 0.2 && avgSentenceLength > 25) {
      issues.push({
        dimension: 'readability',
        severity: 'low',
        description: `句长缺乏变化（变异系数 ${cv.toFixed(2)}），阅读节奏单调`,
        suggestion: '交替使用长短句，创造更自然的阅读节奏',
      });
    }
  }

  // 3. 超长句子检测
  const longSentences = sentences.filter((s) => s.length > 100);
  if (longSentences.length > 0) {
    issues.push({
      dimension: 'readability',
      severity: longSentences.length > 3 ? 'medium' : 'low',
      description: `检测到 ${longSentences.length} 个超长句子（>100字），最长达 ${Math.max(...longSentences.map(s => s.length))} 字`,
      suggestion: '拆分超长句为多个短句，降低读者认知负担',
    });
  }

  // 4. 段落长度评估
  const paragraphs = plainText
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const longParagraphs = paragraphs.filter((p) => p.length > 200);
  if (longParagraphs.length > 0) {
    issues.push({
      dimension: 'readability',
      severity: longParagraphs.length > 2 ? 'medium' : 'low',
      description: `检测到 ${longParagraphs.length} 个过长段落（>200字）`,
      suggestion: '将长段落拆分为多个短段落，每段聚焦一个要点',
    });
  }

  // 5. 图文比例检查
  const imageCount = (plainText.match(/!\[([^\]]*)\]\([^)]+\)/g) ?? []).length;
  if (article.wordCount > 500 && imageCount === 0) {
    issues.push({
      dimension: 'readability',
      severity: 'low',
      description: '长文章缺少配图，纯文字可能降低阅读体验',
      suggestion: '在关键内容处添加配图，图文并茂提升阅读体验',
    });
  }

  // 6. 修饰词密度（形容词/副词近似检测）
  const modifierPatterns = [
    '非常', '十分', '极为', '格外', '尤其', '特别', '极其',
    '完全', '充分', '彻底', '高度', '深度', '全面',
    '巨大', '优秀', '卓越', '完美', '极致',
  ];
  let modifierCount = 0;
  for (const pattern of modifierPatterns) {
    const matches = plainText.match(new RegExp(pattern, 'g'));
    if (matches) modifierCount += matches.length;
  }

  const modifierDensity = sentences.length > 0 ? modifierCount / sentences.length : 0;
  if (modifierDensity > 0.5 && sentences.length > 5) {
    issues.push({
      dimension: 'readability',
      severity: 'low',
      description: `修饰词密度过高（${modifierDensity.toFixed(2)}/句），内容空泛`,
      suggestion: '减少空洞修饰词，用具体数据和案例替代',
    });
  }

  // 7. 逻辑连接词检查（评估内容连贯性）
  const logicalConnectives = [
    '因为', '由于', '所以', '因此', '于是',
    '虽然', '尽管', '但是', '然而', '不过',
    '如果', '假如', '只要', '只有', '除非',
    '首先', '其次', '然后', '接着', '最后',
    '比如', '例如', '以', '来说',
  ];
  let connectiveCount = 0;
  for (const conn of logicalConnectives) {
    const matches = plainText.match(new RegExp(conn, 'g'));
    if (matches) connectiveCount += matches.length;
  }

  if (sentences.length > 6 && connectiveCount === 0) {
    issues.push({
      dimension: 'readability',
      severity: 'low',
      description: '缺少逻辑连接词，句子间衔接不自然',
      suggestion: '添加逻辑连接词（如"因此""然而""首先"等），提升行文连贯性',
    });
  }

  // 8. 英文阅读难度估算（Flesch-Kincaid 简化版）
  if (/^[a-zA-Z\s]/.test(plainText) && sentences.length > 0) {
    const words = plainText.split(/\s+/).filter((w) => w.length > 0);
    if (words.length > 10) {
      const totalSyllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
      const fkGrade = 0.39 * (words.length / sentences.length) + 11.8 * (totalSyllables / words.length) - 15.59;

      if (fkGrade > 12) {
        issues.push({
          dimension: 'readability',
          severity: 'low',
          description: `英文阅读难度偏高（Flesch-Kincaid Grade ${fkGrade.toFixed(1)}），目标受众需大学以上水平`,
          suggestion: '简化句式和词汇，降低阅读门槛',
        });
      }
    }
  }

  return issues;
}
