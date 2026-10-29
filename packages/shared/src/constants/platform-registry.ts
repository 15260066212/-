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

import type { PlatformId } from '../types/platform.types.js';

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

/**
 * Login automation configuration for platforms that support auto-login.
 */
export interface PlatformLoginConfig {
  loginUrl: string;
  usernameSelector: string;
  passwordSelector: string;
  submitSelector: string;
  switchToPasswordSelector?: string;
  successUrl: string;
  successSelectors: string[];
  captchaSelectors: string[];
  maxWaitMs: number;
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
  /** URL used to verify the user is logged in (harvester health checks) */
  checkUrl?: string;
  /** LLMWiki platform name (for LLMWiki fallback and remote publish) */
  llmwikiName?: string;
  /** Primary domain(s) for cookie filtering */
  domains?: string[];
  /** Login redirect URL patterns (indicates session expired) */
  loginRedirectPatterns?: string[];
  /** Text fragments found on login pages (for detecting login pages) */
  loginTexts?: string[];
  /** CSS selectors that indicate the user is logged in */
  loggedInSelectors?: string[];
  /** Auto-login configuration (for platforms that support it) */
  loginConfig?: PlatformLoginConfig;
  /** Names of authentication cookies for this platform */
  authCookieNames?: string[];
  /** Platform capabilities */
  capabilities: PlatformCapabilities;
}

const REGISTRY: Partial<Record<PlatformId, PlatformInfo>> = {
  weixin: {
    id: 'weixin',
    label: '微信公众号',
    sessionName: 'weixin',
    harvesterName: 'wechat',
    homepage: 'https://mp.weixin.qq.com',
    checkUrl: 'https://mp.weixin.qq.com/',
    llmwikiName: 'wechat',
    domains: ['weixin.qq.com', 'qq.com'],
    loginRedirectPatterns: ['login', 'mp.weixin.qq.com/cgi-bin/login', 'token'],
    loginTexts: ['请登录', '扫码登录', '微信公众号登录'],
    loggedInSelectors: ['.account_info', '.weui-desktop-card', '.card_content'],
    authCookieNames: ['slave_user', 'slave_sid'],
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
    checkUrl: 'https://www.zhihu.com/people/me',
    llmwikiName: 'zhihu',
    domains: ['zhihu.com'],
    loginRedirectPatterns: ['signin', 'login', 'sso.zhihu.com'],
    loginTexts: ['请登录', '登录知乎', '登录 / 注册', '扫码登录'],
    loggedInSelectors: ['img.Avatar', '.AppHeader-userInfo', '.ProfileHeader-name', 'button[data-za-detail-view-element_name]'],
    authCookieNames: ['z_c0'],
    capabilities: {
      hasTags: true,
      maxTags: 5,
      hasCategory: false,
      contentFormat: 'markdown',
      isApiPlatform: false,
    },
  },
  baike: {
    id: 'baike',
    label: '百度百科',
    sessionName: 'baike',
    harvesterName: 'baike',
    homepage: 'https://baike.baidu.com',
    checkUrl: 'https://baike.baidu.com/',
    domains: ['baike.baidu.com', 'baidu.com'],
    loginRedirectPatterns: ['login', 'passport.baidu.com', 'wappass.baidu.com'],
    loginTexts: ['登录百度', '请登录', '扫码登录'],
    loggedInSelectors: ['.user-bar', '.user-name'],
    authCookieNames: ['BDUSS', 'STOKEN'],
    capabilities: {
      hasTags: false,
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
    checkUrl: 'https://mp.toutiao.com/profile_v4/index',
    llmwikiName: 'toutiaohao',
    domains: ['toutiao.com', 'douyin.com'],
    loginRedirectPatterns: ['login', 'sso.toutiao.com', 'passport.toutiao.com'],
    loginTexts: ['请登录', '登录今日', '扫码登录'],
    loggedInSelectors: ['.profile-v4', '.index-module', '.user-info'],
    authCookieNames: ['sessionid', 'sessionid_ss', 'sid_tt', 'uid_tt'],
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
    checkUrl: 'https://mp.csdn.net/mp_blog/manage/article',
    llmwikiName: 'csdn',
    domains: ['csdn.net'],
    loginRedirectPatterns: ['login', 'passport.csdn.net'],
    loginTexts: ['登录 CSDN', '登录CSDN', '请登录', '扫码登录'],
    loggedInSelectors: ['.toolbar-search', '.blog-content', '#csdn-toolbar', '.user-login'],
    authCookieNames: ['UserName', 'UserToken', 'C_SESSION'],
    loginConfig: {
      loginUrl: 'https://passport.csdn.net/login',
      usernameSelector: 'input[type="text"], input[name="username"], input[placeholder*="手机"], input[placeholder*="邮箱"]',
      passwordSelector: 'input[type="password"], input[name="password"]',
      submitSelector: 'button[type="submit"], button:has-text("登录"), .btn-login, .btn-primary',
      switchToPasswordSelector: '.btn-group a:has-text("账号登录"), .tab-group a:has-text("账号登录"), a:has-text("账号登录")',
      successUrl: 'csdn.net',
      successSelectors: ['#csdn-toolbar', '.toolbar-search', '.blog-content'],
      captchaSelectors: ['.geetest', '.captcha', '#captcha', '.verify-wrap'],
      maxWaitMs: 20000,
    },
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
    checkUrl: 'https://juejin.cn/editor/drafts',
    llmwikiName: 'juejin',
    domains: ['juejin.cn'],
    loginRedirectPatterns: ['login', 'passport.juejin.cn'],
    loginTexts: ['登录掘金', '请登录', '扫码登录'],
    loggedInSelectors: ['.drafts', '.publish-panel', '.entry-publish-form'],
    authCookieNames: ['sessionid', 'sessionid_ss'],
    loginConfig: {
      loginUrl: 'https://juejin.cn/login',
      usernameSelector: 'input[placeholder*="手机"], input[type="tel"], input[name="phone"]',
      passwordSelector: 'input[type="password"]',
      submitSelector: 'button:has-text("登录"), button.btn-login, .login-btn',
      switchToPasswordSelector: '.switch-account, a:has-text("密码登录"), .login-type:has-text("密码登录")',
      successUrl: 'juejin.cn',
      successSelectors: ['.drafts', '.publish-panel', '.entry-publish-form', '.user-avatar'],
      captchaSelectors: ['.geetest', '.captcha', '#captcha'],
      maxWaitMs: 20000,
    },
    capabilities: {
      hasTags: true,
      maxTags: 5,
      hasCategory: true,
      contentFormat: 'markdown',
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
    checkUrl: 'https://mp.sohu.com/',
    llmwikiName: 'sohuhao',
    domains: ['sohu.com'],
    loginRedirectPatterns: ['login', 'passport.sohu.com'],
    loginTexts: ['登录搜狐', '请登录'],
    loggedInSelectors: ['.mp-sohu', '.home-container'],
    // 只放登录后才出现的 passport Cookie。
    // SUV/IPLOC 是游客身份 + 地域 Cookie，匿名访问首页就会下发，会造成「未登录也判定已登录」。
    authCookieNames: ['ppinf', 'pprdig', 'passport'],
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
    checkUrl: 'https://mp.163.com/',
    llmwikiName: 'wangyihao',
    domains: ['163.com', 'netease.com'],
    loginRedirectPatterns: ['login', 'passport.163.com', 'reg.163.com'],
    loginTexts: ['登录网易', '请登录', '网易邮箱登录'],
    loggedInSelectors: ['.mp-163', '.home-container'],
    authCookieNames: ['NTES_CMT_USER_INFO', 'P_INFO'],
    capabilities: {
      hasTags: false,
      hasCategory: true,
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
 * Get full platform info by session pool platform name (sessionName).
 * Falls back to ID-based lookup if no sessionName match is found.
 * Returns undefined for unknown platforms.
 */
export function getPlatformInfoBySessionName(sessionName: string): PlatformInfo | undefined {
  // First try direct ID match (many platforms use the same name for id and sessionName)
  const direct = REGISTRY[sessionName as PlatformId];
  if (direct) return direct;
  // Fallback: search by sessionName field
  for (const p of Object.values(REGISTRY)) {
    if (p.sessionName === sessionName) return p;
  }
  return undefined;
}

/**
 * Get full platform info by harvester platform name (harvesterName).
 * Falls back to ID-based lookup if no harvesterName match is found.
 * Returns undefined for unknown platforms.
 */
export function getPlatformInfoByHarvesterName(harvesterName: string): PlatformInfo | undefined {
  // First try direct ID match (some platforms use the same name for id and harvesterName)
  const direct = REGISTRY[harvesterName as PlatformId];
  if (direct) return direct;
  // Fallback: search by harvesterName field
  for (const p of Object.values(REGISTRY)) {
    if (p.harvesterName === harvesterName) return p;
  }
  return undefined;
}

/**
 * Get the harvester platform name for a given platform ID.
 * Falls back to the original ID if no special mapping exists.
 */
export function getHarvesterPlatformName(platformId: string): string {
  return getPlatformInfo(platformId)?.harvesterName ?? platformId;
}

/**
 * Resolve any platform naming variant (internal id, harvesterName,
 * sessionName, llmwikiName) to the canonical internal platform id.
 * Falls back to the input when nothing matches.
 *
 * Use this at storage boundaries (e.g. credential repository) so that
 * rows written under harvester names like 'toutiaohao' and internal
 * names like 'toutiao' converge to a single canonical row.
 */
export function getCanonicalPlatformId(name: string): string {
  const direct = REGISTRY[name as PlatformId];
  if (direct) return direct.id;
  for (const p of Object.values(REGISTRY)) {
    if (p.harvesterName === name || p.llmwikiName === name || p.sessionName === name) {
      return p.id;
    }
  }
  return name;
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
 * Get authentication cookie names for a platform.
 */
export function getPlatformAuthCookieNames(id: string): string[] {
  return getPlatformInfo(id)?.authCookieNames ?? [];
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
