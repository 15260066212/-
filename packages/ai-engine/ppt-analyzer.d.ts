import type { SessionData, EnterpriseProfile, KeywordType } from '@zemingengine/shared';
export declare function analyzePptContent(slideTexts: string[], fileName: string, session: SessionData): Promise<{
    summary: string;
    enterprise: Partial<EnterpriseProfile>;
    keywords: {
        question: string;
        type: KeywordType;
        priority: number;
        geoContext: string;
    }[];
}>;
//# sourceMappingURL=ppt-analyzer.d.ts.map