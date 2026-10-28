/**
 * Article and review-related type definitions.
 */

import type { PlatformId, ArticleContentType, ArticleStatus } from './platform.types.js';

export interface Article {
  id: string;
  sessionId: string;
  platform: PlatformId;
  contentType: ArticleContentType;
  title: string;
  contentMarkdown: string;
  contentHtml?: string;
  contentPlain?: string;
  tags: string[];
  summary?: string;
  coverImageDesc?: string;
  wordCount: number;
  status: ArticleStatus;
  generationRound: number;
  reviewRound: number;
  publishUrl?: string;
  /**
   * 芯图EK · 该文章实际引用的信源 id 集合（L3 名片在前）。
   * 生成时写入，审核通过才计入 usageCount；用于信源组合引用统计。
   */
  citedSourceIds?: string[];
  generationMeta?: {
    model: string;
    tokensUsed: number;
    durationMs: number;
    promptVersion: string;
  };
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// === Review types ===

export type ReviewDimension =
 | 'compliance' | 'quality' | 'seo' | 'brand'
 | 'originality' | 'platform_adaptation' | 'readability' | 'safety'
 | 'truthfulness';
export type IssueSeverity = 'high' | 'medium' | 'low';

export interface ReviewIssue {
  dimension: ReviewDimension;
  severity: IssueSeverity;
  description: string;
  location?: string;
  suggestion?: string;
}

export interface DimensionResult {
  score: number;
  issues: ReviewIssue[];
}

/** Weight configuration for each review dimension (must sum to 1.0). */
export interface ReviewWeights {
 compliance: number;
 quality: number;
 seo: number;
 brand: number;
 originality: number;
 platform_adaptation: number;
 readability: number;
 safety: number;
 truthfulness: number;
}

export const DEFAULT_REVIEW_WEIGHTS: ReviewWeights = {
 compliance: 0.20,
 quality: 0.10,
 seo: 0.15,
 brand: 0.10,
 originality: 0.10,
 platform_adaptation: 0.10,
 readability: 0.05,
 safety: 0.10,
 truthfulness: 0.10,
};

export interface ReviewResult {
 articleId: string;
 round: number;
 passed: boolean;
 overallScore: number;
 dimensions: {
 compliance: DimensionResult;
 quality: DimensionResult;
 seo: DimensionResult;
 brand: DimensionResult;
 originality: DimensionResult;
 platform_adaptation: DimensionResult;
 readability: DimensionResult;
 safety: DimensionResult;
 truthfulness: DimensionResult;
 };
 issues: ReviewIssue[];
 suggestions: string[];
 reviewedAt: string;
 contentHash?: string;
}

export interface ReviewFeedback {
  issues: ReviewIssue[];
  suggestions: string[];
  overallScore: number;
}
