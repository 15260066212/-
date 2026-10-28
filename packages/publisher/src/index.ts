export type { PublishParams, PublishResult, FailureType, FailureAnalysis } from './types.js';
export { classifyFailure } from './types.js';
export type { LogCallback } from './publisher.js';
export { PlatformAdapter } from './adapters/base.js';
export { WechatAdapter, WechatSyncCoreAdapter } from './adapters/index.js';
export type { CookieProvider, WechatSyncCoreAdapterOptions } from './adapters/index.js';
export { RpaHandler } from './rpa-handlers/base.js';
export {
  CsdnRpaHandler,
  ZhihuRpaHandler,
  JuejinRpaHandler,
  LLMWikiHandler,
} from './rpa-handlers/index.js';
export { RPAEngine } from './rpa-engine.js';
export type { ISessionPool, SessionAccount } from './rpa-engine.js';
export { Publisher } from './publisher.js';

// WechatSync Core 纯 Node.js 运行时 + Cookie 导出
export { NodeRuntime, formatCookiesForRuntime } from './node-runtime.js';
export type { Cookie, NodeRuntimeOptions } from './node-runtime.js';
export { exportCookiesFromChrome, resolveProfileDir } from './cookie-exporter.js';
export type { CookieExporterOptions } from './cookie-exporter.js';
