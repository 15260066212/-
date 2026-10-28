import type { Article, PlatformCredentials } from '@zemingengine/shared';

export interface PublishParams {
  article: Article;
  credentials: PlatformCredentials;
}

export interface PublishResult {
  success: boolean;
  postId?: string;
  postUrl?: string;
  error?: string;
  verificationStatus?: 'verified' | 'unverified' | 'failed' | 'api_confirmed' | 'draft_saved';
  verificationMessage?: string;
  /**
   * When true, the article was saved as a draft on the platform
   * (not actually published). The caller should treat this as a
   * partial success — the content is on the platform but needs
   * manual publishing action.
   */
  draftSaved?: boolean;
}

export type FailureType =
  | 'network'
  | 'auth'
  | 'rate_limit'
  | 'content'
  | 'platform'
  | 'draft_saved'
  | 'unknown';

export interface FailureAnalysis {
  type: FailureType;
  category: string;
  description: string;
  retryable: boolean;
  retryDelayMs: number;
}

export function classifyFailure(error: string): FailureAnalysis {
  const lower = error.toLowerCase();

  for (const rule of FAILURE_RULES) {
    if (rule.patterns.some((p) => p.test(lower))) {
      return {
        type: rule.type,
        category: rule.category,
        description: rule.description,
        retryable: rule.retryable,
        retryDelayMs: rule.retryDelayMs,
      };
    }
  }

  return {
    type: 'unknown',
    category: '未知错误',
    description: error.slice(0, 200),
    retryable: true,
    retryDelayMs: 3000,
  };
}

/**
 * Failure classification rules evaluated in priority order.
 *
 * Each rule has:
 * - type: the failure category identifier
 * - category: Chinese display name for the error category
 * - description: human-readable description of what went wrong
 * - patterns: regex patterns matched against the lowercased error message
 * - retryable: whether retrying makes sense for this failure type
 * - retryDelayMs: base delay in ms before retrying (multiplied by attempt number)
 *
 * Adding a new failure type: add a new entry to this array. Rules are
 * evaluated top-to-bottom; the first match wins.
 */
const FAILURE_RULES: Array<{
  type: FailureType;
  category: string;
  description: string;
  patterns: RegExp[];
  retryable: boolean;
  retryDelayMs: number;
}> = [
  {
    type: 'network',
    category: '网络错误',
    description: '网络连接超时或中断',
    patterns: [
      /timeout/,
      /timed out/,
      /network/,
      /econnrefused/,
      /enotfound/,
      /ehostunreach/,
      /fetch failed/,
      /socket/,
      /err_connection/,
      /connection reset/,
    ],
    retryable: true,
    retryDelayMs: 5000,
  },
  {
    type: 'auth',
    category: '认证失败',
    description: '账号认证失败或会话过期',
    patterns: [
      /auth/,
      /unauthorized/,
      /401/,
      /login/,
      /session/,
      /cookie/,
      /credential/,
      /token/,
      /permission/,
      /身份/,
      /登录/,
      /未授权/,
    ],
    retryable: false,
    retryDelayMs: 0,
  },
  {
    type: 'rate_limit',
    category: '频率限制',
    description: '发布频率过高被平台限制',
    patterns: [
      /rate/,
      /frequency/,
      /too many/,
      /429/,
      /频繁/,
      /limit/,
      /throttl/,
    ],
    retryable: true,
    retryDelayMs: 30000,
  },
  {
    type: 'content',
    category: '内容违规',
    description: '内容不符合平台规范',
    patterns: [
      /content/,
      /violation/,
      /forbidden/,
      /403/,
      /sensitive/,
      /违规/,
      /敏感/,
      /审核/,
      /rejected/,
    ],
    retryable: false,
    retryDelayMs: 0,
  },
  {
    type: 'platform',
    category: '平台异常',
    description: '平台页面结构变化或需要人工验证',
    patterns: [
      /not found/,
      /404/,
      /editor/,
      /element/,
      /selector/,
      /click/,
      /navigation/,
      /页面/,
      /元素/,
      /captcha/,
      /验证码/,
      /人机/,
    ],
    retryable: true,
    retryDelayMs: 10000,
  },
  {
    type: 'draft_saved',
    category: '仅存草稿',
    description: '文章仅保存为草稿，未真正发布到平台',
    patterns: [
      /draft only/,
      /saved as draft/,
      /仅存草稿/,
      /草稿/,
    ],
    retryable: true,
    retryDelayMs: 15000,
  },
];
