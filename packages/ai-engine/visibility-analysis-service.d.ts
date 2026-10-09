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
export declare class VisibilityAnalysisService {
    normalizeTerms(name: string | undefined, aliases: string[] | undefined): string[];
    termVariants(term: string): string[];
    countTerm(text: string, term: string): {
        count: number;
        firstIndex: number;
    };
    termMatches(text: string, term: string): Range[];
    shouldSkipGenericChineseMatch(text: string, term: string, range: Range): boolean;
    canMatchModelSuffix(term: string): boolean;
    overlaps(a: Range, b: Range): boolean;
    termRanges(text: string, terms: string[]): Range[];
    mentionStats(text: string, terms: string[]): MentionStats;
    buildBrandVisibilityTerms(brand: Brand): string[];
    compactTerm(term: string): string;
    removeOverlappingTerms(terms: string[], blockedTerms: string[]): string[];
    isModelLikeProductTerm(term: string): boolean;
    isRecommended(text: string, firstIndex: number): boolean;
    isAnyMentionRecommended(text: string, terms: string[]): boolean;
    visibilityScore(stats: MentionStats, position: number | null, recommended: boolean): number;
    analyzeResponse({ responseText, brand, competitors }: {
        responseText: string;
        brand: Brand;
        competitors: Competitor[];
    }): {
        brand_mentioned: boolean;
        brand_mentions: number;
        brand_first_index: number;
        brand_position: number;
        brand_rank: number;
        brand_recommended: boolean;
        visibility_score: number;
        competitor_mentions: {
            id: string;
            name: string;
            mentions: number;
            mentioned: boolean;
            first_index: number;
            position: number;
            rank: number;
            recommended: boolean;
            visibility_score: number;
        }[];
        share_of_voice: number;
    };
}
export declare const visibilityAnalysisService: VisibilityAnalysisService;
export {};
//# sourceMappingURL=visibility-analysis-service.d.ts.map