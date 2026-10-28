import type { Article, PlatformId, ArticleContentType, ReviewFeedback, KnowledgeSource } from '@zemingengine/shared';

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
  /** 本篇三层检索选中的信源，按 [S1]..[Sn] 编号注入 prompt */
  citedSources?: KnowledgeSource[];
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
