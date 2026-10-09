export type { PublishParams, PublishResult, FailureType, FailureAnalysis } from './types.js';
export { classifyFailure } from './types.js';
export type { LogCallback } from './publisher.js';
export { PlatformAdapter } from './adapters/base.js';
export { WechatAdapter } from './adapters/index.js';
export { RpaHandler } from './rpa-handlers/base.js';
export {
  CsdnRpaHandler,
  ZhihuRpaHandler,
  JuejinRpaHandler,
  GenericRpaHandler,
  BaiduZhidaoRpaHandler,
  LLMWikiHandler,
} from './rpa-handlers/index.js';
export { RPAEngine } from './rpa-engine.js';
export type { ISessionPool, SessionAccount } from './rpa-engine.js';
export { Publisher } from './publisher.js';
export { PublishQueue } from './queue.js';
