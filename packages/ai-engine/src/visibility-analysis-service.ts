interface Brand {
  name?: string;
  aliases?: string[];
  primary_keywords?: string[];
  website?: string;
}

interface Competitor {
  id?: string | null;
  name?: string;
  aliases?: string[];
  website?: string;
}

interface MentionStats {
  mentions: number;
  first_index: number;
  mentioned: boolean;
}

interface Range {
  start: number;
  end: number;
}

/** Characters to look back before a mention for recommendation context. */
const RECOMMEND_LOOKBACK_CHARS = 18;

/** Characters to look ahead after a mention for recommendation context. */
const RECOMMEND_LOOKAHEAD_CHARS = 36;

/** Shorter lookback for clause-level negative phrase detection. */
const CLAUSE_LOOKBACK_CHARS = 10;

/** Shorter lookahead for immediate post-mention negative phrase detection. */
const SHORT_LOOKAHEAD_CHARS = 18;

/** Max non-punctuation chars allowed between start of window and a negative phrase. */
const NEGATIVE_AFTER_LEEWAY_CHARS = 8;

/** Visibility bonus for rank 1 (first mention position). */
const RANK_BONUS_FIRST = 2;

/** Visibility bonus for rank 2. */
const RANK_BONUS_SECOND = 1;

/** Visibility bonus for rank 3. */
const RANK_BONUS_THIRD = 0.5;

/** Visibility bonus for recommended mentions. */
const RECOMMEND_BONUS = 2;

/** Negative recommendation phrases that cancel a positive signal (before the mention). */
const NEGATIVE_BEFORE_PATTERN = /(不推荐|不建议|不优先|不太推荐|不太建议|并不推荐|不是很推荐|不算推荐|并非首选|不要选|避免选|谨慎选|谨慎选择)$/;

/** Negative recommendation phrases that cancel a positive signal (after the mention). */
const NEGATIVE_AFTER_PATTERN = new RegExp(
  `^(?:[^，。、；;！？!?\\n]{0,${NEGATIVE_AFTER_LEEWAY_CHARS}})(不推荐|不建议|不优先|不太推荐|不太建议|并不推荐|不是很推荐|不算推荐|不值得买|不适合|不是首选|并非首选|避免选择|谨慎选择)`
);

/** All negative phrases to strip before checking for positive signals. */
const NEGATIVE_STRIP_PATTERN = /(不推荐|不建议|不优先|不太推荐|不太建议|并不推荐|不是很推荐|不算推荐|不值得买|不适合|不是首选|并非首选|不要选|避免选|谨慎选|谨慎选择|避免选择)/g;

/** Positive recommendation phrases that indicate endorsement. */
const POSITIVE_PATTERN = /(首选|推荐|优先选|优先选择|优先看|更建议|值得买|最适合|第一选择|优先推荐)/i;

/** Sentence-ending punctuation marks (both Chinese and English). */
const SENTENCE_PUNCTUATION = /[。！？!?；;\n]/;

/** Clause-separating punctuation marks (both Chinese and English). */
const CLAUSE_PUNCTUATION = /[，,；;]/;

export class VisibilityAnalysisService {
  normalizeTerms(name: string | undefined, aliases: string[] | undefined): string[] {
    const seen = new Set<string>();
    const aliasList = Array.isArray(aliases) ? aliases : [];
    return [name, ...aliasList]
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .filter((item) => {
        const key = item.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  termVariants(term: string): string[] {
    const value = String(term || '').trim();
    const compact = this.compactTerm(value);
    if (compact && compact !== value.toLowerCase() && compact.length >= 3) {
      return [value, compact];
    }
    return [value];
  }

  countTerm(text: string, term: string) {
    const matches = this.termMatches(text, term);
    return { count: matches.length, firstIndex: matches.length ? matches[0].start : -1 };
  }

  termMatches(text: string, term: string): Range[] {
    const source = String(text || '');
    const needle = String(term || '').trim();
    if (!source || !needle) return [];
    const isAsciiWord = /^[A-Za-z0-9][A-Za-z0-9\s._-]*$/.test(needle);
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const flags = 'gi';
    const rightBoundary = this.canMatchModelSuffix(needle)
      ? '(?=$|[^A-Za-z0-9]|[A-Za-z]{0,4}\\d)'
      : '(?=$|[^A-Za-z0-9])';
    const pattern = isAsciiWord ? `(^|[^A-Za-z0-9])(${escaped})${rightBoundary}` : escaped;
    const re = new RegExp(pattern, flags);
    const matches: Range[] = [];
    for (const match of source.matchAll(re)) {
      const start = isAsciiWord && match[1] ? (match.index ?? 0) + match[1].length : (match.index ?? 0);
      const matchedText = isAsciiWord ? match[2] : match[0];
      const range: Range = { start, end: start + String(matchedText || '').length };
      if (!this.shouldSkipGenericChineseMatch(source, needle, range)) matches.push(range);
    }
    return matches;
  }

  shouldSkipGenericChineseMatch(text: string, term: string, range: Range): boolean {
    const value = String(term || '').trim();
    const source = String(text || '');
    const before = source.slice(Math.max(0, range.start - 4), range.start);
    const after = source.slice(range.end, Math.min(source.length, range.end + 6));
    const genericRules: Record<string, { before: RegExp; after: RegExp }> = {
      理想: { before: /(比较|较为|很|更|最|不太)$/, after: /^(情况下|状态|条件|情况|方案|目标|预期|效果|结果|选择|生活|工作|环境)/ },
      苹果: { before: /(吃|买|摘|削|洗|种)$/, after: /^(怎么保存|保存|水果|果汁|树|皮|品种|营养|口感|好吃|变色|氧化|香蕉|梨|价格)/ },
      小米: { before: /(吃|买|煮|熬|泡|种)$/, after: /^(粥|米粥|怎么煮|煮|熬|米|杂粮|食材|营养|口感|好吃|南瓜|红枣|价格)/ },
      豆包: { before: /(吃|买|蒸|做|包|热)$/, after: /^(子|怎么做|做法|馅|馅料|面团|发酵|松软|好吃|热量|价格)/ },
      大众: { before: /(适合|面向|普通|一般|主流|满足|符合)$/, after: /^(用户|消费者|人群|市场|审美|口味|需求|点评|接受|认知|选择)/ },
      现代: { before: /(更|很|比较|更加|这种|整体|偏)$/, after: /^(设计|风格|社会|服务|管理|科技|化|农业|工业|生活|审美|建筑|简约|智能化)/ },
    };
    const rule = genericRules[value];
    if (!rule) return false;
    return rule.before.test(before) || rule.after.test(after);
  }

  canMatchModelSuffix(term: string): boolean {
    const compact = String(term || '').replace(/[\s._-]+/g, '');
    if (!/^[A-Za-z0-9]+$/.test(compact) || !/[A-Za-z]/.test(compact)) return false;
    if (compact.length >= 4) return true;
    return /^[A-Z0-9]{3,}$/.test(compact);
  }

  overlaps(a: Range, b: Range): boolean {
    return a.start < b.end && b.start < a.end;
  }

  termRanges(text: string, terms: string[]): Range[] {
    const ranges: Range[] = [];
    for (const term of terms) {
      for (const variant of this.termVariants(term)) {
        ranges.push(...this.termMatches(text, variant));
      }
    }
    const selected: Range[] = [];
    ranges
      .sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start))
      .forEach((range) => {
        if (!selected.some((item) => this.overlaps(item, range))) selected.push(range);
      });
    return selected;
  }

  mentionStats(text: string, terms: string[]): MentionStats {
    const selected = this.termRanges(text, terms);
    const firstIndex = selected.length ? Math.min(...selected.map((item) => item.start)) : -1;
    return { mentions: selected.length, first_index: firstIndex, mentioned: selected.length > 0 };
  }

  buildBrandVisibilityTerms(brand: Brand): string[] {
    const baseTerms = this.normalizeTerms(brand?.name, brand?.aliases);
    const baseLower = baseTerms.map((term) => term.toLowerCase());
    const baseCompact = baseTerms.map((term) => this.compactTerm(term)).filter(Boolean);
    const productTerms = (Array.isArray(brand?.primary_keywords) ? brand.primary_keywords : [])
      .map((term) => String(term || '').trim())
      .filter((term) => {
        const lower = term.toLowerCase();
        const compact = this.compactTerm(term);
        return baseLower.some((base) => lower.includes(base))
          || baseCompact.some((base) => compact.includes(base))
          || this.isModelLikeProductTerm(term);
      });
    return this.normalizeTerms(baseTerms[0], [...baseTerms.slice(1), ...productTerms]);
  }

  compactTerm(term: string): string {
    return String(term || '').toLowerCase().replace(/[\s._-]+/g, '');
  }

  removeOverlappingTerms(terms: string[], blockedTerms: string[]): string[] {
    const blocked = new Set((Array.isArray(blockedTerms) ? blockedTerms : [])
      .flatMap((term) => [String(term || '').trim().toLowerCase(), this.compactTerm(term)])
      .filter(Boolean));
    return (Array.isArray(terms) ? terms : []).filter((term) => {
      const lower = String(term || '').trim().toLowerCase();
      const compact = this.compactTerm(term);
      return !blocked.has(lower) && !blocked.has(compact);
    });
  }

  isModelLikeProductTerm(term: string): boolean {
    const value = String(term || '').trim();
    if (!value) return false;
    return /[A-Za-z]/.test(value) && /\d/.test(value);
  }

  isRecommended(text: string, firstIndex: number): boolean {
    if (firstIndex < 0) return false;
    const source = String(text || '');
    const start = Math.max(0, firstIndex - RECOMMEND_LOOKBACK_CHARS);
    const end = Math.min(source.length, firstIndex + RECOMMEND_LOOKAHEAD_CHARS);
    const previousSentenceBoundary = Math.max(
      source.lastIndexOf('。', firstIndex - 1),
      source.lastIndexOf('！', firstIndex - 1),
      source.lastIndexOf('？', firstIndex - 1),
      source.lastIndexOf('!', firstIndex - 1),
      source.lastIndexOf('?', firstIndex - 1),
      source.lastIndexOf('；', firstIndex - 1),
      source.lastIndexOf(';', firstIndex - 1),
      source.lastIndexOf('\n', firstIndex - 1)
    );
    const sentenceStart = Math.max(start, previousSentenceBoundary + 1);
    const afterWindow = source.slice(firstIndex, end);
    const nextSentenceBoundary = afterWindow.search(SENTENCE_PUNCTUATION);
    const sentenceEnd = nextSentenceBoundary >= 0 ? firstIndex + nextSentenceBoundary : end;
    const previousClauseBoundary = Math.max(
      source.lastIndexOf('，', firstIndex - 1),
      source.lastIndexOf(',', firstIndex - 1),
      source.lastIndexOf('、', firstIndex - 1),
      source.lastIndexOf('；', firstIndex - 1),
      source.lastIndexOf(';', firstIndex - 1)
    );
    const clauseStart = Math.max(sentenceStart, previousClauseBoundary + 1);
    const beforeMention = source.slice(Math.max(clauseStart, firstIndex - CLAUSE_LOOKBACK_CHARS), firstIndex);
    const afterMention = source.slice(firstIndex, Math.min(sentenceEnd, firstIndex + SHORT_LOOKAHEAD_CHARS));
    if (NEGATIVE_BEFORE_PATTERN.test(beforeMention)) return false;
    if (NEGATIVE_AFTER_PATTERN.test(afterMention)) return false;
    const afterClauseWindow = source.slice(firstIndex, sentenceEnd);
    const nextClauseBoundary = afterClauseWindow.search(CLAUSE_PUNCTUATION);
    const clauseEnd = nextClauseBoundary >= 0 ? firstIndex + nextClauseBoundary : sentenceEnd;
    const positiveContext = source.slice(clauseStart, clauseEnd).replace(NEGATIVE_STRIP_PATTERN, '');
    return POSITIVE_PATTERN.test(positiveContext);
  }

  isAnyMentionRecommended(text: string, terms: string[]): boolean {
    return this.termRanges(text, terms).some((range) => this.isRecommended(text, range.start));
  }

  visibilityScore(stats: MentionStats, position: number | null, recommended: boolean): number {
    if (!stats?.mentioned) return 0;
    const pos = position ?? 0;
    const rankBonus = pos === 1 ? RANK_BONUS_FIRST : pos === 2 ? RANK_BONUS_SECOND : pos === 3 ? RANK_BONUS_THIRD : 0;
    const recommendBonus = recommended ? RECOMMEND_BONUS : 0;
    return Number((Number(stats.mentions || 0) + rankBonus + recommendBonus).toFixed(2));
  }

  analyzeResponse({ responseText, brand, competitors }: { responseText: string; brand: Brand; competitors: Competitor[] }) {
    const text = String(responseText || '');
    const brandTerms = this.buildBrandVisibilityTerms(brand);
    const brandStats = this.mentionStats(text, brandTerms);
    const competitorStats = (Array.isArray(competitors) ? competitors : []).map((competitor, index) => {
      const terms = this.removeOverlappingTerms(
        this.normalizeTerms(competitor?.name, competitor?.aliases),
        brandTerms
      );
      return {
        position_key: `competitor-${index}`,
        id: competitor?.id ?? null,
        name: competitor?.name || '',
        ...this.mentionStats(text, terms)
      };
    });

    const positioned = [
      brandStats.mentioned ? { type: 'brand' as const, first_index: brandStats.first_index } : null,
      ...competitorStats
        .filter((item) => item.mentioned)
        .map((item) => ({ type: 'competitor' as const, position_key: item.position_key, first_index: item.first_index }))
    ]
      .filter(Boolean)
      .sort((a, b) => a!.first_index - b!.first_index);

    const brandPositionIndex = positioned.findIndex((item) => item!.type === 'brand');
    const competitorPositions = new Map<string, number>();
    positioned.forEach((item, index) => {
      if (item!.type === 'competitor') competitorPositions.set(item!.position_key, index + 1);
    });

    const brandPosition = brandPositionIndex === -1 ? null : brandPositionIndex + 1;
    const brandRecommended = this.isAnyMentionRecommended(text, brandTerms);
    const brandScore = this.visibilityScore(brandStats, brandPosition, brandRecommended);
    const competitorRows = Array.isArray(competitors) ? competitors : [];
    const competitorsWithScore = competitorStats.map((item, index) => {
      const position = competitorPositions.get(item.position_key) || null;
      const competitor = competitorRows[index];
      const recommended = this.isAnyMentionRecommended(
        text,
        this.removeOverlappingTerms(this.normalizeTerms(competitor?.name, competitor?.aliases), brandTerms)
      );
      return {
        ...item,
        position,
        rank: position,
        recommended,
        visibility_score: this.visibilityScore(item, position, recommended)
      };
    });

    const totalScore = brandScore + competitorsWithScore.reduce((sum, item) => sum + item.visibility_score, 0);
    const shareOfVoice = totalScore > 0
      ? Number(((brandScore / totalScore) * 100).toFixed(2))
      : 0;

    return {
      brand_mentioned: brandStats.mentioned,
      brand_mentions: brandStats.mentions,
      brand_first_index: brandStats.first_index,
      brand_position: brandPosition,
      brand_rank: brandPosition,
      brand_recommended: brandRecommended,
      visibility_score: brandScore,
      competitor_mentions: competitorsWithScore.map((item) => ({
        id: item.id,
        name: item.name,
        mentions: item.mentions,
        mentioned: item.mentioned,
        first_index: item.first_index,
        position: item.position,
        rank: item.rank,
        recommended: item.recommended,
        visibility_score: item.visibility_score
      })),
      share_of_voice: shareOfVoice
    };
  }
}

export const visibilityAnalysisService = new VisibilityAnalysisService();
