interface Brand {
    name?: string;
    aliases?: string[];
    primary_keywords?: string[];
}
interface Competitor {
    name?: string;
    aliases?: string[];
}
interface SentimentResult {
    sentiment: 'positive' | 'neutral' | 'negative';
    reason: string;
    risk_terms: string[];
}
export declare class SentimentAnalysisService {
    buildAnalysisQuestion({ responseText, brand, competitors }: {
        responseText: string;
        brand: Brand;
        competitors: Competitor[];
    }): string;
    parseAnalysis(text: string): SentimentResult;
    normalizeSentiment(value: any): 'positive' | 'neutral' | 'negative';
    normalizeRiskTerms(value: any): string[];
    extractJsonObject(text: string): string;
    neutral(reason: string): SentimentResult;
    sanitizeReason(value: any): string;
    sanitizeRiskTerm(value: any): string;
    analyzeWithDeepSeek({ responseText, brand, competitors }: {
        responseText: string;
        brand: Brand;
        competitors: Competitor[];
    }): Promise<SentimentResult>;
}
export declare const sentimentAnalysisService: SentimentAnalysisService;
export {};
//# sourceMappingURL=sentiment-analysis-service.d.ts.map