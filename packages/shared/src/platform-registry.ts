/**
 * Unified platform registry — single source of truth for all platform metadata.
 *
 * Previously, platform name mappings were scattered across multiple files:
 * - PLATFORM_HARVESTER_MAP in cookie-warmer.ts
 * - PLATFORM_ID_TO_SESSION_NAME in rpa-engine.ts
 * - PLATFORM_NAMES / PLATFORM_URLS in shared
 * - PLATFORM_TO_LLMWIKI in remote-publisher.ts and llmwiki-handler.ts
 *
 * This module consolidates all platform metadata into one place so that
 * adding a new platform only requires updating this file.
 */

import type { PlatformId } from './index.js';

/**
 * Platform capability flags — describes what each publishing platform supports.
 */
export interface PlatformCapabilities {
  /** Whether the platform supports tags/labels */
  hasTags: boolean;
  /** Maximum number of tags allowed (if hasTags) */
  maxTags?: number;
  /** Whether the platform supports categories/channels */
  hasCategory: boolean;
  /** Content format expected by the editor */
  contentFormat: 'markdown' | 'html' | 'plaintext';
  /** Whether this platform is published via API (vs RPA) */
  isApiPlatform: boolean;
}

export interface PlatformInfo {
  /** Canonical platform ID (used throughout the system) */
  id: PlatformId;
  /** Chinese display label for UI */
  label: string;
  /** Platform name used by the session pool / browser automation */
  sessionName: string;
  /** Platform name used by the harvester (cookie harvesting service) */
  harvesterName: string;
  /**
   * Editor / publish page URL (for RPA handlers and health checks).
   * @deprecated Use `editorUrl` instead — this field is kept for backward compatibility.
   */
  url?: string;
  /** Homepage URL of the platform */
  homepage?: string;
  /** Editor / publish page URL */
  editorUrl?: string;
  /** LLMWiki platform name (for LLMWiki fallback and remote publish) */
  llmwikiName?: string;
  /** Primary domain(s) for cookie filtering */
  domains?: string[];
  /** Login redirect URL patterns (indicates session expired) */
  loginRedirectPatterns?: string[];
  /** Platform capabilities */
  capabilities: PlatformCapabilities;
}

const REGISTRY: Record<PlatformId, PlatformInfo> = {
  weixin: {
    id: 'weixin',
    label: '微信公众号',
    sessionName: 'weixin',
    harvesterName: 'wechat',
    homepage: 'https://mp.weixin.qq.com',
    llmwikiName: 'wechat',
    domains: ['weixin.qq.com', 'qq.com'],
    loginRedirectPatterns: ['login', 'token'],
    capabilities: {
      hasTags: false,
      hasCategory: false,
      contentFormat: 'html',
      isApiPlatform: true,
    },
  },
  zhihu: {
    id: 'zhihu',
    label: '知乎',
    sessionName: 'zhihu',
    harvesterName: 'zhihu',
    url: 'https://zhuanlan.zhihu.com/write',
    homepage: 'https://www.zhihu.com',
    editorUrl: 'https://zhuanlan.zhihu.com/write',
    llmwikiName: 'zhihu',
    domains: ['zhihu.com'],
    loginRedirectPatterns: ['signin', 'login'],
    capabilities: {
      hasTags: true,
      maxTags: 5,
      hasCategory: false,
      contentFormat: 'markdown',
      isApiPlatform: false,
    },
  },
  baijia: {
    id: 'baijia',
    label: '百家号',
    sessionName: 'baijiahao',
    harvesterName: 'baijiahao',
    url: 'https://baijiahao.baidu.com/builder/rc/edit?type=news',
    homepage: 'https://baijiahao.baidu.com',
    editorUrl: 'https://baijiahao.baidu.com/builder/rc/edit?type=news',
    llmwikiName: 'baijiahao',
    domains: ['baijiahao.baidu.com', 'baidu.com'],
    loginRedirectPatterns: ['login', 'passport'],
    capabilities: {
      hasTags: true,
      maxTags: 5,
      hasCategory: false,
      contentFormat: 'html',
      isApiPlatform: false,
    },
  },
  toutiao: {
    id: 'toutiao',
    label: '今日头条',
    sessionName: 'toutiao',
    harvesterName: 'toutiaohao',
    url: 'https://mp.toutiao.com/profile_v4/graphic/publish',
    homepage: 'https://www.toutiao.com',
    editorUrl: 'https://mp.toutiao.com/profile_v4/graphic/publish',
    llmwikiName: 'toutiao',
    domains: ['toutiao.com'],
    loginRedirectPatterns: ['login', 'passport'],
    capabilities: {
      hasTags: false,
      hasCategory: true,
      contentFormat: 'html',
      isApiPlatform: false,
    },
  },
  csdn: {
    id: 'csdn',
    label: 'CSDN',
    sessionName: 'csdn',
    harvesterName: 'csdn',
    url: 'https://editor.csdn.net/md/',
    homepage: 'https://www.csdn.net',
    editorUrl: 'https://editor.csdn.net/md/',
    llmwikiName: 'csdn',
    domains: ['csdn.net'],
    loginRedirectPatterns: ['login', 'passport'],
    capabilities: {
      hasTags: true,
      maxTags: 5,
      hasCategory: true,
      contentFormat: 'markdown',
      isApiPlatform: false,
    },
  },
  juejin: {
    id: 'juejin',
    label: '掘金',
    sessionName: 'juejin',
    harvesterName: 'juejin',
    url: 'https://juejin.cn/editor/drafts/new',
    homepage: 'https://juejin.cn',
    editorUrl: 'https://juejin.cn/editor/drafts/new',
    llmwikiName: 'juejin',
    domains: ['juejin.cn'],
    loginRedirectPatterns: ['login', 'passport'],
    capabilities: {
      hasTags: true,
      maxTags: 5,
      hasCategory: true,
      contentFormat: 'markdown',
      isApiPlatform: false,
    },
  },
  bilibili: {
    id: 'bilibili',
    label: '哔哩哔哩',
    sessionName: 'bilibili',
    harvesterName: 'bilibili',
    url: 'https://member.bilibili.com/article-text/home',
    homepage: 'https://www.bilibili.com',
    editorUrl: 'https://member.bilibili.com/article-text/home',
    llmwikiName: 'bilibili',
    domains: ['bilibili.com'],
    loginRedirectPatterns: ['login', 'passport'],
    capabilities: {
      hasTags: true,
      maxTags: 10,
      hasCategory: true,
      contentFormat: 'html',
      isApiPlatform: false,
    },
  },
  sohu: {
    id: 'sohu',
    label: '搜狐号',
    sessionName: 'sohu',
    harvesterName: 'sohuhao',
    url: 'https://mp.sohu.com/mpfe/static/main/edit.html',
    homepage: 'https://mp.sohu.com',
    editorUrl: 'https://mp.sohu.com/mpfe/static/main/edit.html',
    llmwikiName: 'sohuhao',
    domains: ['sohu.com'],
    loginRedirectPatterns: ['login', 'passport'],
    capabilities: {
      hasTags: false,
      hasCategory: true,
      contentFormat: 'html',
      isApiPlatform: false,
    },
  },
  netease: {
    id: 'netease',
    label: '网易号',
    sessionName: 'netease',
    harvesterName: 'wangyihao',
    url: 'https://mp.163.com/editor/article.html',
    homepage: 'https://mp.163.com',
    editorUrl: 'https://mp.163.com/editor/article.html',
    llmwikiName: 'wangyihao',
    domains: ['163.com', 'netease.com'],
    loginRedirectPatterns: ['login', 'passport'],
    capabilities: {
      hasTags: false,
      hasCategory: true,
      contentFormat: 'html',
      isApiPlatform: false,
    },
  },
  zhidao: {
    id: 'zhidao',
    label: '百度知道',
    sessionName: 'zhidao',
    harvesterName: 'zhidao',
    url: 'https://zhidao.baidu.com/ask',
    homepage: 'https://zhidao.baidu.com',
    editorUrl: 'https://zhidao.baidu.com/ask',
    llmwikiName: 'baidu_zhidao',
    domains: ['zhidao.baidu.com', 'baidu.com'],
    loginRedirectPatterns: ['login', 'passport'],
    capabilities: {
      hasTags: false,
      hasCategory: false,
      contentFormat: 'html',
      isApiPlatform: false,
    },
  },
};

/**
 * Get full platform info by ID.
 * Returns undefined for unknown platforms.
 */
export function getPlatformInfo(id: string): PlatformInfo | undefined {
  return REGISTRY[id as PlatformId];
}

/**
 * Get the harvester platform name for a given platform ID.
 * Falls back to the original ID if no special mapping exists.
 */
export function getHarvesterPlatformName(platformId: string): string {
  return getPlatformInfo(platformId)?.harvesterName ?? platformId;
}

/**
 * Get the session pool platform name for a given platform ID.
 * Falls back to the original ID if no special mapping exists.
 */
export function getSessionPlatformName(platformId: string): string {
  return getPlatformInfo(platformId)?.sessionName ?? platformId;
}

/**
 * Get the Chinese display label for a platform.
 * Falls back to the original ID if not found.
 */
export function getPlatformLabel(platformId: string): string {
  return getPlatformInfo(platformId)?.label ?? platformId;
}

/**
 * Get the editor / publish page URL for a platform.
 * Returns undefined if the platform has no editor URL (e.g., API-only platforms).
 */
export function getPlatformEditorUrl(id: string): string | undefined {
  const info = getPlatformInfo(id);
  return info?.editorUrl ?? info?.url;
}

/**
 * Get the LLMWiki platform name for a platform.
 * Returns undefined if no LLMWiki mapping exists.
 */
export function getPlatformLLMWikiName(id: string): string | undefined {
  return getPlatformInfo(id)?.llmwikiName;
}

/**
 * Get the primary domain(s) for a platform.
 * Returns an empty array if no domains are configured.
 */
export function getPlatformDomains(id: string): string[] {
  return getPlatformInfo(id)?.domains ?? [];
}

/**
 * Get the capabilities descriptor for a platform.
 * Returns undefined for unknown platforms.
 */
export function getPlatformCapabilities(id: string): PlatformCapabilities | undefined {
  return getPlatformInfo(id)?.capabilities;
}

/**
 * Check whether a platform is published via API (vs RPA).
 * Returns false for unknown platforms.
 */
export function isApiPlatform(id: string): boolean {
  return getPlatformInfo(id)?.capabilities.isApiPlatform ?? false;
}

/**
 * Check whether a platform is published via RPA (vs API).
 * Returns false for unknown platforms.
 */
export function isRpaPlatform(id: string): boolean {
  const info = getPlatformInfo(id);
  return info ? !info.capabilities.isApiPlatform : false;
}

/**
 * List all registered publishing platforms.
 */
export function listAllPlatforms(): PlatformInfo[] {
  return Object.values(REGISTRY);
}

/**
 * List all API-based platforms.
 */
export function listApiPlatforms(): PlatformInfo[] {
  return listAllPlatforms().filter((p) => p.capabilities.isApiPlatform);
}

/**
 * List all RPA-based platforms.
 */
export function listRpaPlatforms(): PlatformInfo[] {
  return listAllPlatforms().filter((p) => !p.capabilities.isApiPlatform);
}

/**
 * The full registry record (for advanced use cases like iteration).
 * Prefer the helper functions above for most usage.
 */
export const PLATFORM_REGISTRY = REGISTRY;
