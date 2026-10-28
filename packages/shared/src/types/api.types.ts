/**
 * API request/response type definitions.
 */

import type { SessionData, DialogueMessage, DialogueResponse, ScrapeResult, ProductDetail } from './session.types.js';
import type { Article, ReviewResult } from './article.types.js';
import type { PipelineStatus } from './pipeline.types.js';

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
  foundedYear?: string;
  phone?: string;
  email?: string;
  address?: string;
  productsText: string;
  brandStory: string;
  trustAnchorsText: string;
  brandToneText?: string;
  userPainPointsText?: string;
  // === 新客户录入表扩展字段（均为选填） ===
  enterpriseIntro?: string;
  teamStrength?: string;
  serviceAdvantages?: string;
  businessPhilosophy?: string;
  caseStudiesText?: string;
  caseEntryStandard?: string;
  caseIndustriesText?: string;
  productDetails?: ProductDetail[];
  avoidKeywordsText?: string;
  // === AI 名片精确覆盖字段（选填） ===
  /** 主要服务（顿号/逗号分隔），AI 名片第 4 段 */
  servicesText?: string;
  /** 服务对象（顿号/逗号分隔），AI 名片第 5 段 */
  targetCustomersText?: string;
  /** 服务地区话术，AI 名片第 6 段 */
  serviceRegion?: string;
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
