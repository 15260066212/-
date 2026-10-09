import type { ScrapeResult, SessionData, EnterpriseProfile, KeywordType } from '@zemingengine/shared';
interface AnalysisKeyword {
    question: string;
    type: KeywordType;
    priority: number;
}
interface AnalysisResult {
    fullName: string;
    shortName: string;
    description: string;
    scale: string;
    location: string;
    products: string[];
    brandStory: string;
    trustAnchors: string[];
    brandTone: string[];
    keywords: (string | AnalysisKeyword)[];
}
export declare function analyzeWebsite(scrapeResult: ScrapeResult, session: SessionData): Promise<{
    analysis: AnalysisResult;
    summary: string;
    enterprise: Partial<EnterpriseProfile>;
    keywords: {
        question: string;
        type: KeywordType;
        priority: number;
        geoContext: string;
    }[];
}>;
export {};
//# sourceMappingURL=analyzer.d.ts.map