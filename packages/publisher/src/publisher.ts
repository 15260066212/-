import type { Article, PlatformCredentials, PlatformId, PublishTask } from '@zemingengine/shared';
import type { PublishResult, FailureAnalysis } from './types.js';
import { classifyFailure } from './types.js';
import { PublishDefaults } from './constants.js';
import { PlatformAdapter } from './adapters/base.js';
import { WechatAdapter, WechatSyncCoreAdapter } from './adapters/index.js';
import { ToutiaoApiAdapter } from './adapters/toutiao-api.js';
import { NeteaseApiAdapter } from './adapters/netease-api.js';
import { exportCookiesFromChrome } from './cookie-exporter.js';
import { RPAEngine } from './rpa-engine.js';
import type { RpaHandler } from './rpa-handlers/base.js';

/** Callback for writing publish log entries to DB or elsewhere. */
export type LogCallback = (entry: {
  taskId: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  metadata?: Record<string, unknown>;
}) => void;

export class Publisher {
  private adapters: Map<PlatformId, PlatformAdapter> = new Map();
  private rpaEngine: RPAEngine;

  /** Optional resolver to look up an Article by ID for queue processing. */
  articleResolver?: (articleId: string) => Promise<Article | undefined>;
  /** Optional resolver to look up credentials for a platform. */
  credentialsResolver?: (platform: PlatformId) => Promise<PlatformCredentials | undefined>;
  /** Optional log callback for persisting publish logs. */
  logCallback?: LogCallback;

  constructor(rpaEngine?: RPAEngine) {
    this.rpaEngine = rpaEngine ?? new RPAEngine();
  }

  /**
   * Create a Publisher with all built-in platform adapters and RPA handlers
   * auto-registered. This is the recommended way to construct a Publisher.
   *
   * All platform registration happens here — single source of truth for
   * which platforms are supported and how they publish (API vs RPA).
   */
  static createDefault(rpaEngine?: RPAEngine): Publisher {
    const pub = new Publisher(rpaEngine);

    // === API-based platforms ===
    pub.registerAdapter(new WechatAdapter());

    // === WechatSync Core API-based platforms (纯 Node.js fetch + Cookie，零 Chromium) ===
    // Cookie 通过 exportCookiesFromChrome 从 harvester 的 Chrome profile 导出
    const coreCookiesProvider = exportCookiesFromChrome;
    pub.registerAdapter(new WechatSyncCoreAdapter('csdn',    { cookiesProvider: coreCookiesProvider, debug: true }));
    pub.registerAdapter(new WechatSyncCoreAdapter('juejin',  { cookiesProvider: coreCookiesProvider, debug: true }));
    pub.registerAdapter(new WechatSyncCoreAdapter('zhihu',   { cookiesProvider: coreCookiesProvider, debug: true }));
    pub.registerAdapter(new WechatSyncCoreAdapter('sohu',    { cookiesProvider: coreCookiesProvider, debug: true }));
    // 头条：独立 API 适配器（来源: wechatsync git 历史 + v1 driver）
    // 默认存草稿（save=1）。若返回 err_no=7050（缺 msToken/a_bogus 签名），任务失败。
    pub.registerAdapter(new ToutiaoApiAdapter({ cookiesProvider: coreCookiesProvider, debug: true }));
    // 网易号：按 WechatSync 扩展包内 NeteaseAdapter 的站内接口实现（navinfo.do + publishV2.do）
    pub.registerAdapter(new NeteaseApiAdapter({ cookiesProvider: coreCookiesProvider, debug: true }));

    // RPA handler 已全部移除：发布仅走 API 适配器，无浏览器兜底。
    // 受影响平台：csdn/juejin/zhihu/sohu/toutiao/netease 失去降级路径。

    return pub;
  }

  registerAdapter(adapter: PlatformAdapter): void {
    this.adapters.set(adapter.platform, adapter);
  }

  /** Register an RPA handler for a platform. Delegates to the RPAEngine. */
  registerRpaHandler(handler: RpaHandler): void {
    this.rpaEngine.registerHandler(handler);
  }

  /**
   * Check if a platform is supported (either via API adapter or RPA handler).
   * Unified single entry point — replaces separate hasAdapter / hasHandler calls.
   */
  supportsPlatform(platform: PlatformId): boolean {
    return this.hasAdapter(platform) || this.rpaEngine.hasHandler(platform);
  }

  /**
   * List all supported platform IDs (both API adapters and RPA handlers).
   * Single source of truth for which platforms this Publisher can handle.
   */
  listSupportedPlatforms(): PlatformId[] {
    const platforms = new Set<PlatformId>();
    for (const p of this.adapters.keys()) platforms.add(p);
    for (const p of this.rpaEngine.getHandlerPlatforms()) platforms.add(p);
    return Array.from(platforms);
  }

  /** Close the RPA engine's browser if it's running. */
  async close(): Promise<void> {
    await this.rpaEngine.close();
  }

  /** Check if an adapter is registered for a platform. */
  hasAdapter(platform: PlatformId): boolean {
    return this.adapters.has(platform);
  }

  /** Get the adapter registered for a platform (or undefined). */
  getAdapter(platform: PlatformId): PlatformAdapter | undefined {
    return this.adapters.get(platform);
  }

  /** Get the publish method (api or rpa) for a given platform. */
  getMethodForPlatform(platform: PlatformId): 'api' | 'rpa' {
    const adapter = this.adapters.get(platform);
    return adapter?.getMethod() ?? 'rpa';
  }

  /**
   * Create a PublishTask with the correct method determined by the platform adapter.
   */
  createTask(params: {
    articleId: string;
    platform: PlatformId;
    maxRetries?: number;
    scheduledAt?: string;
    userId?: string;
    accountId?: string;
  }): PublishTask {
    const now = new Date().toISOString();
    return {
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      articleId: params.articleId,
      platform: params.platform,
      accountId: params.accountId,
      status: 'pending',
      method: this.getMethodForPlatform(params.platform),
      userId: params.userId,
      retryCount: 0,
      maxRetries: params.maxRetries ?? PublishDefaults.MAX_RETRIES,
      scheduledAt: params.scheduledAt,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Publish an article using the appropriate method:
   * - API platforms (weixin): use the registered adapter directly
   * - RPA platforms (all others): delegate to the RPAEngine with Playwright
   */
  async publishArticle(
    article: Article,
    credentials: PlatformCredentials,
    platform?: PlatformId,
  ): Promise<PublishResult> {
    const targetPlatform = platform || article.platform as PlatformId;
    const adapter = this.adapters.get(targetPlatform);
    // Only use adapter directly for API-based platforms
    if (adapter && adapter.getMethod() === 'api') {
      return adapter.publish({ article, credentials });
    }
    // For RPA platforms, delegate to the RPAEngine
    const accountId = credentials.accountId || 'default';
    return this.rpaEngine.publish(article, credentials, accountId);
  }

  /**
   * Save an article as a draft on the platform without publishing it.
   *
   * - API platforms (weixin): call adapter.saveDraft() (draft/add API)
   * - RPA platforms: delegate to RPAEngine.saveDraft() (fills editor + clicks
   *   save-draft button)
   *
   * Returns a PublishResult with `verificationStatus: 'draft_saved'` and
   * `draftSaved: true` on success.
   */
  async saveDraftArticle(
    article: Article,
    credentials: PlatformCredentials,
    platform?: PlatformId,
  ): Promise<PublishResult> {
    const targetPlatform = platform || article.platform as PlatformId;
    const adapter = this.adapters.get(targetPlatform);
    if (adapter && adapter.getMethod() === 'api') {
      return adapter.saveDraft({ article, credentials });
    }
    const accountId = credentials.accountId || 'default';
    return this.rpaEngine.saveDraft(article, credentials, accountId);
  }

  /**
   * Publish with intelligent retry based on failure classification.
   *
   * Failure-aware retry strategy:
   * - network errors: retry with 5s base delay
   * - rate_limit: retry with 30s delay
   * - platform errors (captcha, element not found): retry with 10s delay
   * - auth/credential errors: do NOT retry (won't fix itself)
   * - content violations: do NOT retry (won't fix itself)
   * - unknown: retry with 3s delay
   */
  async publishWithRetry(
    task: PublishTask,
    article: Article,
    credentials: PlatformCredentials,
    onTaskUpdate?: (updates: Partial<PublishTask>) => void,
  ): Promise<PublishResult> {
    const maxAttempts = task.maxRetries + 1;
    let lastResult: PublishResult = { success: false, error: 'No attempts made' };
    let lastAnalysis: FailureAnalysis | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const isRetry = attempt > 1;
      this.log(task.id, 'info', `Publish attempt ${attempt}/${maxAttempts} for ${task.platform}`, {
        articleId: article.id,
        attempt,
        isRetry,
        ...(isRetry && lastAnalysis ? { failureType: lastAnalysis.type, failureCategory: lastAnalysis.category } : {}),
      });

      if (isRetry && onTaskUpdate) {
        onTaskUpdate({ status: 'retrying', retryCount: attempt - 1 });
      }

      try {
        const result = await this.publishArticle(article, credentials, task.platform);
        lastResult = result;

        if (result.success) {
          this.log(task.id, 'info', `Publish succeeded on attempt ${attempt}`, {
            postId: result.postId,
            postUrl: result.postUrl,
          });
          return result;
        }

        lastAnalysis = classifyFailure(result.error ?? 'Unknown error');
        this.log(task.id, 'warn', `Publish attempt ${attempt} failed`, {
          error: result.error,
          failureType: lastAnalysis.type,
          failureCategory: lastAnalysis.category,
          retryable: lastAnalysis.retryable,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        lastResult = { success: false, error: errorMsg };
        lastAnalysis = classifyFailure(errorMsg);
        this.log(task.id, 'error', `Publish attempt ${attempt} threw error`, {
          error: errorMsg,
          failureType: lastAnalysis.type,
          failureCategory: lastAnalysis.category,
          retryable: lastAnalysis.retryable,
        });
      }

      if (attempt < maxAttempts && lastAnalysis) {
        if (!lastAnalysis.retryable) {
          this.log(task.id, 'warn', `Skipping retry: ${lastAnalysis.category} is not retryable`, {
            failureType: lastAnalysis.type,
          });
          break;
        }

        const delay = lastAnalysis.retryDelayMs * attempt;
        this.log(task.id, 'info', `Waiting ${delay}ms before retry ${attempt + 1}`, {
          delayMs: delay,
          failureType: lastAnalysis.type,
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    if (lastAnalysis) {
      onTaskUpdate?.({
        errorMessage: `[${lastAnalysis.category}] ${lastResult.error ?? ''}`.slice(0, 500),
      });
    }

    return lastResult;
  }

  /**
   * Save article as draft with intelligent retry based on failure classification.
   *
   * Mirrors publishWithRetry but calls saveDraftArticle() instead of
   * publishArticle(). On success the result will have draftSaved=true and
   * verificationStatus='draft_saved'.
   *
   * Uses the same failure-aware retry strategy as publishWithRetry.
   */
  async saveDraftWithRetry(
    task: PublishTask,
    article: Article,
    credentials: PlatformCredentials,
    onTaskUpdate?: (updates: Partial<PublishTask>) => void,
  ): Promise<PublishResult> {
    const maxAttempts = task.maxRetries + 1;
    let lastResult: PublishResult = { success: false, error: 'No attempts made' };
    let lastAnalysis: FailureAnalysis | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const isRetry = attempt > 1;
      this.log(task.id, 'info', `Draft-save attempt ${attempt}/${maxAttempts} for ${task.platform}`, {
        articleId: article.id,
        attempt,
        isRetry,
        ...(isRetry && lastAnalysis ? { failureType: lastAnalysis.type, failureCategory: lastAnalysis.category } : {}),
      });

      if (isRetry && onTaskUpdate) {
        onTaskUpdate({ status: 'retrying', retryCount: attempt - 1 });
      }

      try {
        const result = await this.saveDraftArticle(article, credentials, task.platform);
        lastResult = result;

        if (result.success) {
          this.log(task.id, 'info', `Draft-save succeeded on attempt ${attempt}`, {
            postId: result.postId,
            draftSaved: result.draftSaved,
          });
          return result;
        }

        lastAnalysis = classifyFailure(result.error ?? 'Unknown error');
        this.log(task.id, 'warn', `Draft-save attempt ${attempt} failed`, {
          error: result.error,
          failureType: lastAnalysis.type,
          failureCategory: lastAnalysis.category,
          retryable: lastAnalysis.retryable,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        lastResult = { success: false, error: errorMsg };
        lastAnalysis = classifyFailure(errorMsg);
        this.log(task.id, 'error', `Draft-save attempt ${attempt} threw error`, {
          error: errorMsg,
          failureType: lastAnalysis.type,
          failureCategory: lastAnalysis.category,
          retryable: lastAnalysis.retryable,
        });
      }

      if (attempt < maxAttempts && lastAnalysis) {
        if (!lastAnalysis.retryable) {
          this.log(task.id, 'warn', `Skipping retry: ${lastAnalysis.category} is not retryable`, {
            failureType: lastAnalysis.type,
          });
          break;
        }

        const delay = lastAnalysis.retryDelayMs * attempt;
        this.log(task.id, 'info', `Waiting ${delay}ms before retry ${attempt + 1}`, {
          delayMs: delay,
          failureType: lastAnalysis.type,
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    if (lastAnalysis) {
      onTaskUpdate?.({
        errorMessage: `[${lastAnalysis.category}] ${lastResult.error ?? ''}`.slice(0, 500),
      });
    }

    return lastResult;
  }

  private log(
    taskId: string,
    level: 'info' | 'warn' | 'error',
    message: string,
    metadata?: Record<string, unknown>,
  ): void {
    if (this.logCallback) {
      this.logCallback({ taskId, level, message, metadata });
    } else {
      const prefix = level === 'error' ? '[ERROR]' : level === 'warn' ? '[WARN]' : '[INFO]';
      console.log(`[Publisher] ${prefix} ${message}`, metadata ?? '');
    }
  }
}
