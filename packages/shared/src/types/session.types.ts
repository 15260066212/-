/**
 * Session-related type definitions and stage constants.
 */

// === Stage definitions ===
export const STAGES = [
  'intro',
  'profile',
  'keywords',
  'knowledge',
] as const;

/** @deprecated Use STAGES instead. Retained for backward compatibility only. */
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

/** 产品详细解读（对应新客户录入表「六、其他板块 > 产品详细解读」） */
export interface ProductDetail {
  /** 产品名称 */
  name: string;
  /** 别称或下属小分类产品 */
  alias?: string;
  /** 规格 */
  spec?: string;
  /** 价格 */
  price?: string;
  /** 性能优势特点 */
  advantages?: string;
  /** 应用场景或详细内容 */
  scenarios?: string;
}

export interface EnterpriseProfile {
  fullName: string;
  shortName: string;
  description: string;
  scale: string;
  location: string;
  foundedYear: string;
  website: string;
  phone?: string;
  email?: string;
  address?: string;
  products: Product[];
  brandStory: string;
  trustAnchors: string[];
  brandTone: string[];
  userPainPoints: string[];
  // === 新客户录入表扩展字段（均为选填） ===
  /** 企业介绍 */
  enterpriseIntro?: string;
  /** 团队实力 */
  teamStrength?: string;
  /** 服务优势 */
  serviceAdvantages?: string;
  /** 经营理念 */
  businessPhilosophy?: string;
  /** 实际案例（合作案例板块，越多越好） */
  caseStudies?: string[];
  /** 案例录入标准 */
  caseEntryStandard?: string;
  /** 案例行业分类 */
  caseIndustries?: string[];
  /** 产品详细解读 */
  productDetails?: ProductDetail[];
  /** 规避清单：需要规避的行业敏感词语 */
  avoidKeywords?: string[];
  // === AI 名片精确覆盖字段（选填，优先于编译器推导） ===
  /** 主要服务（AI 名片固定格式第 4 段，填写后不再从 products 推导） */
  services?: string[];
  /** 服务对象（AI 名片固定格式第 5 段，填写后不再从 userPainPoints 推导） */
  targetCustomers?: string[];
  /** 服务地区话术（AI 名片固定格式第 6 段，如「立足漳州，服务福建，业务辐射全国」） */
  serviceRegion?: string;
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
/**
 * DocumentItem — 编译式企业知识条目
 *
 * 字段演进说明（向后兼容）：
 * - content   : 原始模板字符串，老 session 为空壳（如 "XX企业知识库资料：产品手册"）
 * - sections  : 编译式知识分节，由 stage4-knowledge 从 enterprise 真实数据生成
 * - keyFacts  : 可被 LLM 直接引用的关键事实（数字、效果、对比），用于减少幻觉
 * - evidence  : 证据锚点来源（客户案例、产品文档、品牌故事等），用于事实溯源
 *
 * sections 优先消费，content 作为降级 preview（prompt-builder 已有此逻辑）。
 */
export interface DocumentItem {
  title: string;
  content: string;
  type: 'product' | 'brand' | 'faq' | 'case';
  tags?: string[];
  /** 编译式知识分节 — 每节一个 heading + bullets，LLM 直接消费 */
  sections?: Array<{ heading: string; bullets: string[] }>;
  /** 可直接引用的关键事实（数字、效果数据、对比数据） */
  keyFacts?: string[];
  /** 证据锚点来源，标注哪些条目来自哪个企业原始字段 */
  evidence?: Array<{ source: string; claim: string }>;
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

/**
 * L1 原料层 — 企业原始信息快照。
 *
 * 只做原料，不作为引用对象。L2 信源与 L3 AI 名片均由它编译而来。
 */
export interface EnterpriseRawLayer {
  fullName: string;
  shortName?: string;
  description: string;
  scale?: string;
  location?: string;
  website?: string;
  foundedYear?: string;
  products: Array<{ name: string; description?: string; category?: string }>;
  brandStory?: string;
  trustAnchors: string[];
  brandTone: string[];
  userPainPoints: string[];
}

/**
 * L2 / L3 可引用信源 — 原子知识点。
 *
 * 每条信源是一个可被文章独立引用的最小事实单元：
 * - L2：由 L1 企业信息编译改造而来（产品能力、信任背书、痛点问答等）
 * - L3：AI 名片，每篇文章必须引用
 *
 * usageCount 用于引用次数均衡，会话独立计数。
 */
export interface KnowledgeSource {
  id: string;
  title: string;
  /**
   * 10 维度信源分类（芯图EK · 方案 C 扩展）
   *
   * 覆盖完整营销漏斗：产品 → 服务 → 客户 → 品牌 → 信任 → 地区 → 案例 → 问答 → 定价 → 生态
   * 旧值 'product' / 'case' 保留用于向后兼容旧 DB 数据。
   */
  type:
    | 'capability'   // 产品/服务核心能力
    | 'service'      // 服务矩阵与交付方式
    | 'customer'     // 目标客户画像
    | 'brand'        // 品牌定位与故事
    | 'proof'        // 信任背书/资质
    | 'region'       // 服务地区与本地优势
    | 'case'         // 行业适用场景/客户案例
    | 'faq'          // 痛点问答
    | 'pricing'      // 价格/报价定位（可选）
    | 'partner'      // 合作伙伴/生态（可选）
    | 'product';     // 废弃（同 capability），保留兼容
  /** 2 = L2 企业信源层；3 = L3 AI 名片层（必引） */
  layer: 2 | 3;
  tags: string[];
  sections: Array<{ heading: string; bullets: string[] }>;
  keyFacts: string[];
  evidence: Array<{ source: string; claim: string }>;
  /** 该信源被文章引用的次数（会话独立） */
  usageCount: number;
  lastUsedAt?: string;
  enabled: boolean;
}

/**
 * L3 AI 名片 — 企业对外自我介绍的结构化版本，每篇文章必须引用。
 *
 * 固定 10 个字段，对应企业工商/运营对外口径：
 * 公司名称 / 公司简介 / 核心产品 / 主要服务 / 服务对象 / 服务地区 /
 * 经营地址 / 公司网址 / 咨询电话 / 联系邮箱。
 */
export interface AICard {
  companyName: string;
  description: string;
  coreProducts: string[];
  mainServices: string[];
  targetCustomers: string[];
  serviceRegion: string;
  address: string;
  website: string;
  phone: string;
  email: string;
  /** 名片作为统一信源参与注入，保证 L3 必引语义一致 */
  source: KnowledgeSource;
}

export interface KnowledgeBase {
  documents: DocumentItem[];
  images: ImageItem[];
  tags: TagItem[];
  /** L1 原料层快照 */
  raw?: EnterpriseRawLayer;
  /** L2 可引用信源池 */
  sources?: KnowledgeSource[];
  /** L3 AI 名片（必引） */
  card?: AICard;
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

// === Pending update type ===
export interface PendingUpdate {
  questionId: string;
  newValue: string;
}

// === Session data ===
import type { PlatformStrategy } from './platform.types.js';

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
      enterpriseIntro: '',
      teamStrength: '',
      serviceAdvantages: '',
      businessPhilosophy: '',
      caseStudies: [],
      caseEntryStandard: '',
      caseIndustries: [],
      productDetails: [],
      avoidKeywords: [],
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
