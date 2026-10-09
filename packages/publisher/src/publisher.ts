import type { Article, PlatformCredentials, PlatformId, PublishTask } from '@zemingengine/shared';
import type { PublishResult, FailureAnalysis } from './types.js';
import { classifyFailure } from './types.js';
import { PublishDefaults } from './constants.js';
import { PlatformAdapter } from './adapters/base.js';
import { WechatAdapter } from './adapters/index.js';
import { RPAEngine } from './rpa-engine.js';
import { RpaHandler } from './rpa-handlers/base.js';
import {
  CsdnRpaHandler,
  ZhihuRpaHandler,
  JuejinRpaHandler,
  BaijiaRpaHandler,
  ToutiaoRpaHandler,
  BilibiliRpaHandler,
  SohuRpaHandler,
  NeteaseRpaHandler,
  BaiduZhidaoRpaHandler,
} from './rpa-handlers/index.js';

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

    // === RPA-based platforms ===
    pub.registerRpaHandler(new CsdnRpaHandler());
    pub.registerRpaHandler(new ZhihuRpaHandler());
    pub.registerRpaHandler(new JuejinRpaHandler());
    pub.registerRpaHandler(new BaijiaRpaHandler());
    pub.registerRpaHandler(new ToutiaoRpaHandler());
    pub.registerRpaHandler(new BilibiliRpaHandler());
    pub.registerRpaHandler(new SohuRpaHandler());
    pub.registerRpaHandler(new NeteaseRpaHandler());
    pub.registerRpaHandler(new BaiduZhidaoRpaHandler());

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
    platform?: string,
  ): Promise<PublishResult> {
    const targetPlatform = platform || article.platform;
    const adapter = this.adapters.get(targetPlatform);
    // Only use adapter directly for API-based platforms
    if (adapter && adapter.getMethod() === 'api') {
      return adapter.publish({ article, credentials });
    }
    // For RPA platforms, delegate to the RPAEngine
    return this.rpaEngine.publish(targetPlatform, article, credentials);
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
