/**
 * @zemingengine/shared — 共享类型、常量、工具函数和数据库 schema。
 *
 * 此文件为向后兼容的总入口，所有导出名称保持不变。
 * 推荐使用子路径导入以获得更好的 tree-shaking：
 *   import { PlatformId } from '@zemingengine/shared/types'
 *   import { API_BASE_URL } from '@zemingengine/shared/constants'
 *   import { resolveStorageState } from '@zemingengine/shared/utils'
 *   import { initSessionTables } from '@zemingengine/shared/db'
 */

// === Types (按领域组织) ===
export {
  STAGES,
  LEGACY_STAGES,
  createEmptySession,
  DEFAULT_REVIEW_WEIGHTS,
} from './types/index.js';

export type {
  // Platform types
  PlatformId,
  PlatformStrategy,
  ArticleContentType,
  ArticleStatus,
  // Session types
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
  // Article & review types
  Article,
  ReviewDimension,
  IssueSeverity,
  ReviewIssue,
  DimensionResult,
  ReviewWeights,
  ReviewResult,
  ReviewFeedback,
  // Credential types
  PlatformCredentials,
  // Pipeline & publish types
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
  // API types
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
  // Monitor types
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
} from './types/index.js';

// === Constants ===
export {
  API_BASE_URL,
  SESSION_STORAGE_KEY,
  STAGE_DISPLAY_NAMES,
  STAGE_DESCRIPTIONS,
  PLATFORM_NAMES,
  PLATFORM_LABELS,
  PLATFORM_URLS,
  // Platform registry
  PLATFORM_REGISTRY,
  getPlatformInfo,
  getPlatformInfoBySessionName,
  getPlatformInfoByHarvesterName,
  getHarvesterPlatformName,
  getCanonicalPlatformId,
  getSessionPlatformName,
  getPlatformLabel,
  getPlatformEditorUrl,
  getPlatformLLMWikiName,
  getPlatformDomains,
  getPlatformAuthCookieNames,
  getPlatformCapabilities,
  isApiPlatform,
  isRpaPlatform,
  listAllPlatforms,
  listApiPlatforms,
  listRpaPlatforms,
} from './constants/index.js';

export type {
  PlatformInfo,
  PlatformCapabilities,
  PlatformLoginConfig,
} from './constants/index.js';

// === Utils ===
export {
  cookieStringToStorageState,
  storageStateToCookieString,
  resolveStorageState,
  mergeRefreshedCookies,
  hasFullStorageState,
  filterCookiesByDomain,
  isLoginRedirectUrl,
} from './utils/index.js';

export type { StorageState } from './utils/index.js';

// === DB ===
export { initSessionTables } from './db/index.js';
export type { SchemaDatabase } from './db/index.js';
