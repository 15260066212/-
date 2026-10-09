import type { Article, PlatformId, ArticleContentType, ReviewFeedback } from '@zemingengine/shared';

export interface GenerateRequest {
  sessionId: string;
  platform: PlatformId;
  contentType: ArticleContentType;
  keywords?: string[];
  /** Specific topic from optimization plan — when set, generator uses this as the article title/subject */
  topic?: string;
  /** Additional content from user to inject into article */
  contentSupplement?: string;
  /** Real-time user feedback during pipeline run to adjust article quality */
  pipelineFeedback?: string;
  generationRound: number;
  reviewFeedback?: ReviewFeedback;
}

export interface GenerateResult {
  article: Article;
  generationMeta: {
    model: string;
    tokensUsed: number;
    durationMs: number;
    promptVersion: string;
  };
}
