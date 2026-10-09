// === Stage definitions ===
export const STAGES = [
  'intro',
  'profile',
  'keywords',
  'knowledge',
] as const;

export const LEGACY_STAGES = [
  'wordbank',
  'prompts',
  'platforms',
] as const;

export type Stage = (typeof STAGES)[number] | (typeof LEGACY_STAGES)[number];

// === Enterprise types ===
export interface Product {
  name: string;
  description: string;
  category: string;
  isPrimary: boolean;
}

export interface EnterpriseProfile {
  fullName: string;
  shortName: string;
  description: string;
  scale: string;
  location: string;
  foundedYear: string;
  website: string;
  products: Product[];
  brandStory: string;
  trustAnchors: string[];
  brandTone: string[];
  userPainPoints: string[];
}

// === Keyword types ===
export type KeywordType = 'core' | 'longtail' | 'question' | 'comparison';

export interface CoreKeyword {
  question: string;
  type: KeywordType;
  priority: number;
  geoContext: string;
}

// === WordBank types ===
export interface WordBank {
  brandTerms: string[];
  productTerms: string[];
  industryTerms: string[];
  prefixes: string[];
  suffixes: string[];
}

// === KnowledgeBase types ===
export interface DocumentItem {
  title: string;
  content: string;
  type: 'product' | 'brand' | 'faq' | 'case';
  tags?: string[];
}

export interface ImageItem {
  url: string;
  alt: string;
  category: string;
  tags?: string[];
}

export interface TagItem {
  name: string;
  count: number;
}

export interface KnowledgeBase {
  documents: DocumentItem[];
  images: ImageItem[];
  tags: TagItem[];
}

// === Promotion manual types ===
export interface PromotionGoal {
  productName: string;
  positioning: string;
  coreValue: string;
  targetUsers: string;
  coreSellingPoint: string;
}

export interface AudienceSegment {
  level: string;
  audience: string;
  painPoint: string;
  platforms: string[];
}

export interface KeywordCategory {
  category: string;
  examples: string[];
  generationMethod: string;
}

export interface KeywordDistillationConfig {
  seedKeyword: string;
  quantity: number;
  mode: string;
  questionTypes: string[];
}

export interface KeywordCombinationConfig {
  name: string;
  prefixes: string[];
  mainKeywords: string[];
  suffixes: string[];
}

export interface KeywordQuestionMapping {
  keyword: string;
  question: string;
}

export interface KeywordStrategy {
  categories: KeywordCategory[];
  distillation: KeywordDistillationConfig;
  combinations: KeywordCombinationConfig[];
  questionMappings: KeywordQuestionMapping[];
}

export interface KnowledgeDocumentPlan {
  priority: string;
  documentType: string;
  filename: string;
  purpose: string;
  tags: string[];
  contentPoints?: string[];
}

export interface ImageAssetPlan {
  imageType: string;
  filename: string;
  size: string;
  purpose: string;
  tags: string[];
  notes?: string[];
}

export interface ContentGenerationConfig {
  contentType: string;
  suitableKeywords: string[];
  articleType: string;
  articleLength: string;
  style: string;
  titleExamples: string[];
}

export interface TrackingMetric {
  metricType: string;
  metric: string;
  target: string;
}

export interface TrackingPlan {
  metrics: TrackingMetric[];
  weeklyReview: string[];
  contentOptimization: string[];
  keywordOptimization: string[];
  platformOptimization: string[];
  publishChecklist: string[];
  weeklyChecklist: string[];
}

// === Prompt types ===
export interface PromptConfig {
  platform: string;
  prompt: string;
  scenario: string;
}

// === Platform types ===
export interface PlatformStrategy {
  platform: string;
  focus: string;
  adaptations: string[];
  order?: number;
  tone?: string;
  publishTime?: string;
  frequency?: string;
  audience?: string;
}

// === Pending update type ===
export interface PendingUpdate {
  questionId: string;
  newValue: string;
}

// === Session types ===
export interface SessionData {
  id: string;
  currentStage: Stage;
  enterprise: EnterpriseProfile;
  confirmedProfileFields: string[];
  keywords: CoreKeyword[];
  wordBank: WordBank;
  knowledgeBase: KnowledgeBase;
  promotionGoal: PromotionGoal;
  audienceSegments: AudienceSegment[];
  keywordStrategy: KeywordStrategy;
  knowledgePlan: KnowledgeDocumentPlan[];
  imagePlan: ImageAssetPlan[];
  contentPlaybook: ContentGenerationConfig[];
  trackingPlan: TrackingPlan;
  prompts: PromptConfig[];
  platforms: PlatformStrategy[];
  pendingUpdate?: PendingUpdate;
}

export function createEmptySession(id: string): SessionData {
  return {
    id,
    currentStage: 'intro',
    enterprise: {
      fullName: '',
      shortName: '',
      description: '',
      scale: '',
      location: '',
      foundedYear: '',
      website: '',
      products: [],
      brandStory: '',
      trustAnchors: [],
      brandTone: [],
      userPainPoints: [],
    },
    confirmedProfileFields: [],
    keywords: [],
    wordBank: { brandTerms: [], productTerms: [], industryTerms: [], prefixes: [], suffixes: [] },
    knowledgeBase: { documents: [], images: [], tags: [] },
    promotionGoal: {
      productName: '',
      positioning: '',
      coreValue: '',
      targetUsers: '',
      coreSellingPoint: '',
    },
    audienceSegments: [],
    keywordStrategy: {
      categories: [],
      distillation: {
        seedKeyword: '',
        quantity: 30,
        mode: '精准模式',
        questionTypes: [],
      },
      combinations: [],
      questionMappings: [],
    },
    knowledgePlan: [],
    imagePlan: [],
    contentPlaybook: [],
    trackingPlan: {
      metrics: [],
      weeklyReview: [],
      contentOptimization: [],
      keywordOptimization: [],
      platformOptimization: [],
      publishChecklist: [],
      weeklyChecklist: [],
    },
    prompts: [],
    platforms: [],
  };
}

// === Scrape result types ===
export interface ScrapeResult {
  url: string;
  title: string;
  description: string;
  headings: string[];
  links: { text: string; href: string }[];
  textContent: string;
  scrapedAt: string;
  method: 'cheerio' | 'puppeteer';
  // Enhanced fields
  keywords: string[];
  products: { name: string; description: string }[];
  aboutUs: string;
  contactInfo: {
    phone: string;
    email: string;
    address: string;
  };
}

// === Dialogue types ===
export interface DialogueMessage {
  id: string;
  role: 'system' | 'user';
  content: string;
  stage: Stage;
  timestamp: string;
}

export interface DialogueResponse {
  message: DialogueMessage;
  sessionData: SessionData;
  isComplete: boolean;
}

// === API types ===
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface ProgressInfo {
  current: number;
  total: number;
}

export interface CreateSessionResponse {
  sessionId: string;
  sessionData: SessionData;
  introMessage: DialogueMessage;
}

export interface SendMessageRequest {
  text: string;
}

export interface SendMessageResponse {
  messages: DialogueMessage[];
  sessionData: SessionData;
  isComplete: boolean;
  progress: ProgressInfo;
}

export interface GetSessionResponse {
  sessionData: SessionData;
  progress: ProgressInfo;
}

export interface ScrapeSessionResponse {
  scrapeResult: ScrapeResult;
  analysisMessage: DialogueMessage;
  sessionData: SessionData;
}

export interface ImportPptResponse {
  analysisMessage: DialogueMessage;
  sessionData: SessionData;
}

export interface ProfileReviewRequest {
  fullName: string;
  shortName: string;
  description: string;
  scale: string;
  location: string;
  website: string;
  productsText: string;
  brandStory: string;
  trustAnchorsText: string;
}

export interface ProfileReviewResponse {
  messages: DialogueMessage[];
  sessionData: SessionData;
  isComplete: boolean;
  progress: ProgressInfo;
}

export interface BackResponse {
  message: DialogueMessage;
  sessionData: SessionData;
}

export interface ManualResponse {
  markdown: string;
  filename: string;
}

// === Constants ===
export const API_BASE_URL = '/api';
export const SESSION_STORAGE_KEY = 'zemingengine_session';
export const STAGE_DISPLAY_NAMES: Record<Stage, string> = {
  intro: '简介',
  profile: '品牌画像',
  keywords: '关键词',
  wordbank: '词库',
  knowledge: '知识库',
  prompts: '提示词',
  platforms: '平台策略',
};

export const STAGE_DESCRIPTIONS: Record<Stage, string> = {
  intro: '了解 GEO 并开始配置',
  profile: '完善企业基本信息和品牌画像',
  keywords: '确定核心关键词和问题形式',
  wordbank: '自动生成品牌词、产品词、行业词、前缀和后缀',
  knowledge: '规划知识库、图片素材和归类标签',
  prompts: '基于企业画像和知识库自动生成多平台提示词',
  platforms: '基于行业、调性和人群画像自动制定发布策略',
};

// === Platform constants ===

import { listAllPlatforms } from './platform-registry.js';

/** Publishing platform IDs (actual content distribution platforms). */
export type PlatformId =
  | 'weixin' | 'zhihu' | 'baijia' | 'toutiao'
  | 'csdn' | 'juejin' | 'bilibili'
  | 'sohu' | 'netease' | 'zhidao';

/**
 * Chinese display names for publishing platforms.
 * Derived from the unified platform registry for single-source-of-truth.
 */
export const PLATFORM_NAMES: Record<string, string> = /*@__PURE__*/ (() => {
  const result: Record<string, string> = {};
  for (const p of listAllPlatforms()) {
    result[p.id] = p.label;
  }
  return result;
})();

/** Chinese display labels for all platforms (publishing + AI monitoring). */
export const PLATFORM_LABELS: Record<string, string> = {
  ...PLATFORM_NAMES,
  deepseek: 'DeepSeek',
  kimi: 'Kimi',
  doubao: '豆包',
  yuanbao: '元宝',
  qianwen: '千问',
};

/**
 * Editor/publish page URLs for each RPA-supported platform.
 * Derived from the unified platform registry for single-source-of-truth.
 * Both rpa-handlers and session-health selector-registry reference this map.
 */
export const PLATFORM_URLS: Partial<Record<PlatformId, string>> = /*@__PURE__*/ (() => {
  const result: Partial<Record<PlatformId, string>> = {};
  for (const p of listAllPlatforms()) {
    const url = p.editorUrl ?? p.url;
    if (url) {
      result[p.id] = url;
    }
  }
  return result;
})();

export type ArticleContentType =
  | 'tutorial' | 'case' | 'comparison' | 'popularization'
  | 'faq' | 'whitepaper';

export type ArticleStatus =
  | 'draft' | 'reviewing' | 'approved'
  | 'publishing' | 'published' | 'failed'
  | 'manual_edit';

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
 | 'originality' | 'platform_adaptation' | 'readability' | 'safety';
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
}

export const DEFAULT_REVIEW_WEIGHTS: ReviewWeights = {
 compliance: 0.20,
 quality: 0.15,
 seo: 0.15,
 brand: 0.15,
 originality: 0.10,
 platform_adaptation: 0.10,
 readability: 0.05,
 safety: 0.10,
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

// === Publish types ===

export type PublishMethod = 'api' | 'rpa';
export type PublishTaskStatus =
  | 'pending' | 'publishing' | 'published'
  | 'failed' | 'retrying';

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
  verificationStatus?: 'verified' | 'unverified' | 'failed' | 'api_confirmed';
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

export interface PlatformCredentials {
  platform: PlatformId;
  /** Unique account identifier within a platform (e.g., "xintu", "gangchang", "moyijie") */
  accountId: string;
  /** Brand ID for grouping accounts (1=新途科技, 2=肛肠医院, 3=膜一姐, etc.) */
  brandId?: number;
  /** Human-readable account display name */
  accountName?: string;
  type: 'api_key' | 'cookie' | 'token';
  /**
   * Credential data — key-value pairs stored for authentication.
   *
   * Common keys:
   * - `cookie` / `cookies`: Cookie string for cookie-based auth
   * - `storageState`: Full Playwright storageState JSON (cookies + localStorage)
   * - `fingerprintData`: Browser fingerprint JSON (from fingerprint-suite)
   *   for consistent browser identity across sessions
   * - `apiKey`: API key for API-based platforms
   * - `token`: Access token for token-based platforms
   */
  data: Record<string, string>;
  status: 'active' | 'expired' | 'invalid';
  lastValidatedAt?: string;
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
}

export interface PipelineStatus {
  sessionId: string;
  totalArticles: number;
  draft: number;
  reviewing: number;
  approved: number;
  publishing: number;
  published: number;
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

// === Monitor types ===

export interface MonitorArticleStats {
  total: number;
  draft: number;
  reviewing: number;
  approved: number;
  publishing: number;
  published: number;
  failed: number;
}

export interface MonitorPublishTaskStats {
  total: number;
  pending: number;
  publishing: number;
  published: number;
  failed: number;
  retrying: number;
}

export interface MonitorSessionStats {
  total: number;
}

export interface MonitorPipelineRunStats {
  total: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
}

export interface MonitorCredentialStats {
  total: number;
  active: number;
  expired: number;
  invalid: number;
}

export interface MonitorCredentialHealth {
  total: number;
  valid: number;
  checking: number;
  expired: number;
  invalid: number;
  lastCheckedAt?: string;
  byPlatform: Array<{ platform: string; total: number; valid: number; expired: number; healthRate: number }>;
}

export interface MonitorOverview {
  articles: MonitorArticleStats;
  publishTasks: MonitorPublishTaskStats;
  sessions: MonitorSessionStats;
  pipelineRuns: MonitorPipelineRunStats;
  credentials: MonitorCredentialStats;
  credentialHealth?: MonitorCredentialHealth;
  recentLogs: PublishLog[];
}

export interface ArticleTimelinePoint {
  date: string;
  count: number;
}

export interface PlatformCount {
  platform: string;
  count: number;
}

export interface StatusCount {
  status: string;
  count: number;
}

export interface ArticleChartdata {
  timeline: ArticleTimelinePoint[];
  byPlatform: PlatformCount[];
  byStatus: StatusCount[];
}

export interface PublishTimelinePoint {
  date: string;
  published: number;
  failed: number;
}

export interface PublishPlatformStat {
  platform: string;
  total: number;
  published: number;
  failed: number;
}

export interface PublishChartdata {
  timeline: PublishTimelinePoint[];
  successRate: number;
  byPlatform: PublishPlatformStat[];
}

export interface FailureTypeStat {
  type: string;
  category: string;
  count: number;
  percentage: number;
}

export interface SuccessRateTrendPoint {
  date: string;
  total: number;
  published: number;
  failed: number;
  successRate: number;
}

export interface PublishFailureAnalysis {
  byFailureType: FailureTypeStat[];
  byPlatform: PublishPlatformStat[];
  successRateTrend: SuccessRateTrendPoint[];
  overallSuccessRate: number;
  totalFailures: number;
  topErrors: { error: string; count: number; type: string }[];
}

export interface ScoreDistributionItem {
  range: string;
  count: number;
}

export interface ReviewChartdata {
  averageScore: number;
  passRate: number;
  scoreDistribution: ScoreDistributionItem[];
}

// === Platform Registry (unified single source of truth) ===

export {
  PLATFORM_REGISTRY,
  getPlatformInfo,
  getHarvesterPlatformName,
  getSessionPlatformName,
  getPlatformLabel,
  getPlatformEditorUrl,
  getPlatformLLMWikiName,
  getPlatformDomains,
  getPlatformCapabilities,
  isApiPlatform,
  isRpaPlatform,
  listAllPlatforms,
  listApiPlatforms,
  listRpaPlatforms,
} from './platform-registry.js';

export type { PlatformInfo, PlatformCapabilities } from './platform-registry.js';

// === Shared DB schema ===
export { initSessionTables } from './db-schema.js';
export type { SchemaDatabase } from './db-schema.js';

// === StorageState utilities (full browser state persistence) ===
export {
  cookieStringToStorageState,
  storageStateToCookieString,
  resolveStorageState,
  mergeRefreshedCookies,
  hasFullStorageState,
} from './storage-state.js';
export type { StorageState } from './storage-state.js';
