/**
 * Pipeline and publish-related type definitions.
 */

import type { PlatformId, ArticleContentType, ArticleStatus } from './platform.types.js';
import type { Article, ReviewResult } from './article.types.js';

// === Publish types ===

export type PublishMethod = 'api' | 'rpa';
export type PublishTaskStatus =
  | 'pending' | 'publishing' | 'published'
  | 'failed' | 'retrying' | 'draft_saved';

export interface PublishTask {
  id: string;
  articleId: string;
  platform: PlatformId;
  /** Account ID to publish with (for multi-account per platform) */
  accountId?: string;
  status: PublishTaskStatus;
  method: PublishMethod;
  userId?: string;
  platformPostId?: string;
  platformPostUrl?: string;
  errorMessage?: string;
  failureType?: string;
  verificationStatus?: 'verified' | 'unverified' | 'failed' | 'api_confirmed' | 'draft_saved';
  verificationMessage?: string;
  retryCount: number;
  maxRetries: number;
  scheduledAt?: string;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
  priority?: number;
  cooldownUntil?: string;
}

export interface PublishLog {
  id: string;
  taskId: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

// === Pipeline types ===

export type PlanDuration = 'year' | 'half-year' | 'quarter';

export interface PlanConfig {
  duration: PlanDuration;
  articlesPerPlatform: number;
  contentTypes: ArticleContentType[];
  platforms: PlatformId[];
  publishingFrequency: string;
  startDate: string;
  endDate: string;
}

export interface PlanArticle {
  platform: string;
  contentType: ArticleContentType;
  topic: string;
  keyword: string;
  week: number;
}

export interface PipelineRequest {
  sessionId: string;
  platforms: PlatformId[];
  contentType: ArticleContentType;
  /** All selected content types for multi-type generation */
  contentTypes?: ArticleContentType[];
  autoPublish: boolean;
  /** Optional ISO timestamp for scheduled publishing (when autoPublish is enabled). */
  scheduledAt?: string;
  /** Optimization plan duration */
  planDuration?: PlanDuration;
  /** Structured plan articles from optimization plan — when present, pipeline executes these exactly */
  planArticles?: PlanArticle[];
  /** Additional content from user to inject into all generated articles */
  contentSupplement?: string;
  /** Hard cap on total articles generated this run (applied after plan/platform expansion) */
  maxArticles?: number;
}

export interface PipelineStatus {
  sessionId: string;
  totalArticles: number;
  draft: number;
  reviewing: number;
  approved: number;
  publishing: number;
  published: number;
  draft_saved: number;
  failed: number;
  articles: ArticleSummary[];
  /** Current pipeline run info (if running or recently completed). */
  run?: PipelineRun;
}

export type PipelineRunStatus = 'running' | 'completed' | 'cancelled' | 'failed';

export interface PipelineRun {
  id: string;
  sessionId: string;
  status: PipelineRunStatus;
  totalArticles: number;
  completedArticles: number;
  currentPlatform?: string;
  currentRound?: number;
  errorMessage?: string;
  startedAt: string;
  completedAt?: string;
}

export interface ArticleSummary {
  id: string;
  platform: PlatformId;
  title: string;
  status: ArticleStatus;
  reviewScore?: number;
  publishUrl?: string;
  createdAt: string;
}

// === Article API types ===

export interface GenerateArticleRequest {
  sessionId: string;
  platform: PlatformId;
  contentType: ArticleContentType;
}

export interface GenerateArticleResponse {
  article: Article;
  review: ReviewResult;
}

export interface PublishArticleRequest {
  articleId: string;
  platforms?: PlatformId[];
  /** Specific account IDs to use (keyed by platform, or single value for all platforms) */
  accountId?: string;
  /** Map of platform to accountId for multi-platform publish with different accounts */
  accountIds?: Partial<Record<PlatformId, string>>;
  /** Brand ID to filter accounts by */
  brandId?: number;
  scheduledAt?: string;
}
