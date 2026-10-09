export declare const STAGES: readonly ["intro", "profile", "keywords", "knowledge"];
export declare const LEGACY_STAGES: readonly ["wordbank", "prompts", "platforms"];
export type Stage = (typeof STAGES)[number] | (typeof LEGACY_STAGES)[number];
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
export type KeywordType = 'core' | 'longtail' | 'question' | 'comparison';
export interface CoreKeyword {
    question: string;
    type: KeywordType;
    priority: number;
    geoContext: string;
}
export interface WordBank {
    brandTerms: string[];
    productTerms: string[];
    industryTerms: string[];
    prefixes: string[];
    suffixes: string[];
}
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
export interface PromptConfig {
    platform: string;
    prompt: string;
    scenario: string;
}
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
export interface PendingUpdate {
    questionId: string;
    newValue: string;
}
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
export declare function createEmptySession(id: string): SessionData;
export interface ScrapeResult {
    url: string;
    title: string;
    description: string;
    headings: string[];
    links: {
        text: string;
        href: string;
    }[];
    textContent: string;
    scrapedAt: string;
    method: 'cheerio' | 'puppeteer';
    keywords: string[];
    products: {
        name: string;
        description: string;
    }[];
    aboutUs: string;
    contactInfo: {
        phone: string;
        email: string;
        address: string;
    };
}
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
export declare const API_BASE_URL = "/api";
export declare const SESSION_STORAGE_KEY = "zemingengine_session";
export declare const STAGE_DISPLAY_NAMES: Record<Stage, string>;
export declare const STAGE_DESCRIPTIONS: Record<Stage, string>;
//# sourceMappingURL=index.d.ts.map