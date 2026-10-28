/**
 * Default constants and configuration values.
 */

import type { Stage } from '../types/session.types.js';

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
