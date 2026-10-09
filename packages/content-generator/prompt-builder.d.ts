import type { SessionData, PlatformId, ArticleContentType, ReviewFeedback } from '@zemingengine/shared';
export declare function buildPrompt(params: {
    session: SessionData;
    platform: PlatformId;
    contentType: ArticleContentType;
    generationRound: number;
    reviewFeedback?: ReviewFeedback;
    topic?: string;
    contentSupplement?: string;
}): {
    system: string;
    user: string;
};
//# sourceMappingURL=prompt-builder.d.ts.map