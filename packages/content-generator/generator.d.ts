import type { SessionData } from '@zemingengine/shared';
import type { GenerateRequest, GenerateResult } from './types.js';
export declare class ContentGenerator {
    private options;
    constructor(options?: {
        fallbackMode?: boolean;
    });
    generate(request: GenerateRequest, session: SessionData): Promise<GenerateResult>;
    private fallbackGenerate;
    private buildTitle;
    private buildContent;
    private buildFaqContent;
    private buildCaseContent;
    private buildComparisonContent;
    private buildPopularizationContent;
    private buildWhitepaperContent;
    private buildTutorialContent;
    private buildSummary;
}
//# sourceMappingURL=generator.d.ts.map