/**
 * Shared type definitions — organized by domain.
 *
 * Sub-path import: `import { PlatformId, Article } from '@zemingengine/shared/types'`
 */

// Platform types
export type { PlatformId, PlatformStrategy, ArticleContentType, ArticleStatus } from './platform.types.js';

// Session types (includes STAGES, LEGACY_STAGES, createEmptySession)
export {
  STAGES,
  LEGACY_STAGES,
  createEmptySession,
} from './session.types.js';
export type {
  Stage,
  Product,
  ProductDetail,
  EnterpriseProfile,
  KeywordType,
  CoreKeyword,
  WordBank,
  DocumentItem,
  ImageItem,
  TagItem,
  KnowledgeBase,
  EnterpriseRawLayer,
  KnowledgeSource,
  AICard,
  PromotionGoal,
  AudienceSegment,
  KeywordCategory,
  KeywordDistillationConfig,
  KeywordCombinationConfig,
  KeywordQuestionMapping,
  KeywordStrategy,
  KnowledgeDocumentPlan,
  ImageAssetPlan,
  ContentGenerationConfig,
  TrackingMetric,
  TrackingPlan,
  PromptConfig,
  PendingUpdate,
  SessionData,
  ScrapeResult,
  DialogueMessage,
  DialogueResponse,
} from './session.types.js';

// Article & review types
export { DEFAULT_REVIEW_WEIGHTS } from './article.types.js';
export type {
  Article,
  ReviewDimension,
  IssueSeverity,
  ReviewIssue,
  DimensionResult,
  ReviewWeights,
  ReviewResult,
  ReviewFeedback,
} from './article.types.js';

// Credential types
export type { PlatformCredentials } from './credential.types.js';

// Pipeline & publish types
export type {
  PublishMethod,
  PublishTaskStatus,
  PublishTask,
  PublishLog,
  PlanDuration,
  PlanConfig,
  PlanArticle,
  PipelineRequest,
  PipelineStatus,
  PipelineRunStatus,
  PipelineRun,
  ArticleSummary,
  GenerateArticleRequest,
  GenerateArticleResponse,
  PublishArticleRequest,
} from './pipeline.types.js';

// API types
export type {
  ApiResponse,
  ProgressInfo,
  CreateSessionResponse,
  SendMessageRequest,
  SendMessageResponse,
  GetSessionResponse,
  ScrapeSessionResponse,
  ImportPptResponse,
  ProfileReviewRequest,
  ProfileReviewResponse,
  BackResponse,
  ManualResponse,
} from './api.types.js';

// Monitor types
export type {
  MonitorArticleStats,
  MonitorPublishTaskStats,
  MonitorSessionStats,
  MonitorPipelineRunStats,
  MonitorCredentialStats,
  MonitorCredentialHealth,
  MonitorOverview,
  ArticleTimelinePoint,
  PlatformCount,
  StatusCount,
  ArticleChartdata,
  PublishTimelinePoint,
  PublishPlatformStat,
  PublishChartdata,
  FailureTypeStat,
  SuccessRateTrendPoint,
  PublishFailureAnalysis,
  ScoreDistributionItem,
  ReviewChartdata,
} from './monitor.types.js';
