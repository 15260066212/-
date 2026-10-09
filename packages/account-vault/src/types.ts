/**
 * Account Vault Types
 * 支持多平台多账号的加密凭据管理
 */

export type PlatformName =
  | 'zhihu'
  | 'csdn'
  | 'baijiahao'
  | 'baike'
  | 'toutiao'
  | 'netease'
  | 'sohu'
  | 'juejin'
  | 'bilibili'
  | 'zhidao'
  | 'weixin';

export type AccountStatus =
  | 'active'        // 正常可用
  | 'session_expired' // session过期，需重新登录
  | 'banned'        // 被封禁
  | 'rate_limited'  // 触发限流
  | 'pending_login' // 待首次登录
  | 'error';        // 其他错误

export interface AccountCredentials {
  /** 平台 */
  platform: PlatformName;
  /** 账号ID（内部唯一标识） */
  accountId: string;
  /** 登录用户名/邮箱/手机号 */
  username: string;
  /** 加密后的密码 */
  encryptedPassword: string;
  /** 加密IV */
  iv: string;
  /** 加密AuthTag */
  authTag: string;
  /** 手机号（用于短信验证码接收） */
  phone?: string;
  /** 绑定的代理IP ID */
  proxyId?: string;
  /** 状态 */
  status: AccountStatus;
  /** session过期时间 */
  sessionExpiresAt?: number;
  /** 创建时间 */
  createdAt: number;
  /** 最后登录时间 */
  lastLoginAt?: number;
  /** 最后发布时间 */
  lastPublishAt?: number;
  /** 今日已发布数量 */
  todayPublishCount: number;
  /** 今日日期（用于重置计数） */
  todayDate: string; // YYYY-MM-DD
  /** 每日发布上限 */
  dailyLimit: number;
  /** 备注 */
  note?: string;
  /** 账号分组（按项目/客户隔离） */
  group?: string;
  /** 账号标签（多标签，逗号分隔） */
  tags?: string;
  /** 浏览器指纹ID（关联 fingerprints 表） */
  fingerprintId?: string;
}

export interface SessionState {
  /** 关联的账号ID */
  accountId: string;
  /** 平台 */
  platform: PlatformName;
  /** Playwright storageState JSON */
  storageState: string;
  /** 浏览器状态目录路径 */
  userDataDir: string;
  /** 代理配置 */
  proxy?: { server: string; username?: string; password?: string };
  /** 保存时间 */
  savedAt: number;
  /** 是否有效 */
  valid: boolean;
  /** session 有效期（毫秒），超过则需重新验证 */
  maxAge?: number;
  /** 关联的指纹ID */
  fingerprintId?: string;
}

export interface ProxyConfig {
  id: string;
  type: 'residential' | 'datacenter' | 'mobile';
  host: string;
  port: number;
  username?: string;
  password?: string;
  /** 绑定的账号ID */
  boundAccountId?: string;
  /** 所在地区 */
  region?: string;
  /** 是否健康（最近检查结果） */
  healthy?: boolean;
  /** 最近健康检查时间 */
  lastHealthCheck?: number;
  /** 健康检查延迟 (ms) */
  lastLatency?: number;
}

/** 浏览器指纹配置 — 每个账号独立指纹，防止平台关联检测 */
export interface BrowserFingerprint {
  /** User-Agent（每账号唯一） */
  userAgent: string;
  /** 屏幕分辨率 */
  viewport: { width: number; height: number };
  /** 时区（匹配代理区域） */
  timezone: string;
  /** 语言 */
  locale: string;
  /** 平台（硬件） */
  platform: string;
  /** WebGL vendor */
  webglVendor: string;
  /** WebGL renderer */
  webglRenderer: string;
  /** Canvas 噪声种子 */
  canvasNoise: number;
  /** 硬件并发数 */
  hardwareConcurrency: number;
  /** 设备内存 (GB) */
  deviceMemory: number;
}

/** 代理健康检查结果 */
export interface ProxyHealthCheck {
  proxyId: string;
  healthy: boolean;
  latency: number;
  lastCheckedAt: number;
  error?: string;
}

export interface AccountVaultConfig {
  /** 主加密密钥（环境变量或密钥文件） */
  encryptionKeyEnv?: string;
  /** 默认每日发布上限 */
  defaultDailyLimit?: number;
  /** 数据库路径 */
  dbPath?: string;
}
