/**
 * WechatSyncCoreAdapter —— 用 @wechatsync/core 纯 Node.js 平台适配器发布文章
 *
 * 架构：
 *   shared Article  →  WechatSync Core Article  →  adapter.publish() → 平台 API
 *
 * Cookie 来源（按优先级）：
 *   1. credentials.data.cookies（Cookie 数组 / JSON 字符串）
 *   2. credentials.data.cookie（harvester 同步的 Cookie 头字符串，按账号隔离）
 *   3. cookiesProvider() 动态提供（从 Chrome profile 导出）
 *   4. checkAuth 失败时自动触发 cookiesProvider() 重导 Cookie → 重试一次
 */
import type { Article, PlatformCredentials, PlatformId } from '@zemingengine/shared';
import { getPlatformDomains } from '@zemingengine/shared';
import type { PublishParams, PublishResult } from '../types.js';
import { PlatformAdapter } from './base.js';
import { NodeRuntime, formatCookiesForRuntime, parseCookieHeader } from '../node-runtime.js';
import type { Cookie } from '../node-runtime.js';

// 平台 ID 映射：@zemingengine/shared PlatformId → @wechatsync/core adapter id
// 只列 shared PlatformId 里实际存在的平台
const PLATFORM_ID_MAP: Partial<Record<string, string>> = {
  csdn: 'csdn',
  juejin: 'juejin',
  zhihu: 'zhihu',
  sohu: 'sohu',
  // toutiao/netease 由独立适配器处理（toutiao-api.ts / netease-api.ts）
};

// Cookie provider 类型
export type CookieProvider = (platform: PlatformId, credentials: PlatformCredentials) => Promise<Cookie[]>;

export interface WechatSyncCoreAdapterOptions {
  cookiesProvider?: CookieProvider;
  debug?: boolean;
}

export class WechatSyncCoreAdapter extends PlatformAdapter {
  private readonly options: WechatSyncCoreAdapterOptions;
  private _registered = false;
  /**
   * 同平台发布串行队列。
   *
   * Publisher 里每个 platform 只注册一个 adapter 单例，多个会话同时发布同一平台时，
   * 若把 runtime/adapter 存在实例字段上会互相覆盖，导致 A 账号的文章用 B 账号的
   * Cookie 写进 B 的草稿箱。这里同时做两件事：
   *   1. 每次发布都用局部 runtime/adapter，不再写实例字段；
   *   2. 同一 adapter 实例的 publish 串行执行（跨平台互不影响）。
   */
  private _publishChain: Promise<unknown> = Promise.resolve();

  constructor(platform: PlatformId, options: WechatSyncCoreAdapterOptions = {}) {
    super(platform);
    this.options = options;
  }

  getMethod(): 'api' { return 'api'; }

  /** 懒加载 wechatsync-core adapter 类 */
  private async _loadAdapterCtor(): Promise<any> {
    const coreId = PLATFORM_ID_MAP[this.platform];
    if (!coreId) {
      console.warn(`[WechatSyncCoreAdapter] platform "${this.platform}" 无对应 @wechatsync/core adapter`);
      return null;
    }

    try {
      const mod: any = await import('@zemingengine/wechatsync-core/adapters');
      const ctorMap: Record<string, any> = {
        csdn: mod.CSDNAdapter,
        juejin: mod.JuejinAdapter,
        zhihu: mod.ZhihuAdapter,
        sohu: mod.SohuAdapter,
        baijiahao: mod.BaijiahaoAdapter,
        bilibili: mod.BilibiliAdapter,
        toutiao: null, // private submodule
      };
      return ctorMap[coreId] ?? null;
    } catch (err) {
      console.error(`[WechatSyncCoreAdapter] 加载 @zemingengine/wechatsync-core 失败:`, err);
      return null;
    }
  }

  /** 初始化 runtime + adapter 实例（全部为局部对象，不写实例字段） */
  private async _createAdapter(cookies: Cookie[]): Promise<{ adapter: any; runtime: NodeRuntime } | null> {
    const Ctor = await this._loadAdapterCtor();
    if (!Ctor) return null;

    const runtime = new NodeRuntime(formatCookiesForRuntime(cookies), { debug: this.options.debug });
    const adapter = new Ctor();
    const mod: any = await import('@zemingengine/wechatsync-core/adapters');

    if (!this._registered) {
      try {
        mod.adapterRegistry.register({
          meta: adapter.meta,
          factory: () => new Ctor(),
          preprocessConfig: adapter.preprocessConfig,
        });
        this._registered = true;
      } catch { /* already registered */ }
    }

    (adapter as any).runtime = runtime;
    return { adapter, runtime };
  }

  /** 从 credentials 或 cookiesProvider 获取 Cookie */
  private async _getCookies(params: PublishParams): Promise<Cookie[]> {
    const cred = params.credentials;

    // 1. credentials.data.cookies 直接读
    const rawCookies = (cred.data as any)?.cookies;
    if (typeof rawCookies === 'string' && rawCookies.length > 0) {
      try {
        const parsed = JSON.parse(rawCookies);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed as Cookie[];
      } catch {}
    }
    if (Array.isArray(rawCookies) && rawCookies.length > 0) return rawCookies as Cookie[];

    // 2. credentials.data.cookie（harvester 同步的 Cookie 头字符串，主库的常规格式）
    const rawHeader = (cred.data as any)?.cookie;
    if (typeof rawHeader === 'string' && rawHeader.trim().length > 0) {
      const domain = getPlatformDomains(this.platform)[0];
      const parsed = domain ? parseCookieHeader(rawHeader, domain) : [];
      if (parsed.length > 0) return parsed;
    }

    // 3. cookiesProvider 动态获取
    if (this.options.cookiesProvider) {
      try {
        const cookies = await this.options.cookiesProvider(this.platform, cred);
        if (cookies && cookies.length > 0) return cookies;
      } catch (err) {
        console.warn(`[WechatSyncCoreAdapter] cookiesProvider 失败:`, err);
      }
    }

    return [];
  }

  /** shared Article → WechatSync Core Article */
  private _adaptArticle(article: Article) {
    return {
      title: article.title,
      markdown: article.contentMarkdown || '',
      html: article.contentHtml || '', // CSDN API 必须两个字段都有
      summary: article.summary,
      tags: article.tags || [],
    };
  }

  async publish(params: PublishParams): Promise<PublishResult> {
    // 同平台串行，避免多会话并发发布时互相覆盖凭证
    const run = this._publishChain.then(() => this._publishOnce(params));
    this._publishChain = run.catch(() => {});
    return run;
  }

  private async _publishOnce(params: PublishParams): Promise<PublishResult> {
    const cred = params.credentials;

    // 获取 Cookie
    let cookies = await this._getCookies(params);
    if (cookies.length === 0) {
      return { success: false, error: `无可用 Cookie。请为账号 ${cred.accountId} 配置 Cookie 或 cookiesProvider。平台: ${this.platform}` };
    }

    // 初始化（局部实例，本次发布独享）
    let ctx = await this._createAdapter(cookies);
    if (!ctx) {
      return { success: false, error: `无法初始化 @wechatsync/core adapter for ${this.platform}（平台可能不在公开适配器列表中）` };
    }

    // checkAuth
    const auth = await ctx.adapter.checkAuth();
    if (!auth.isAuthenticated) {
      console.warn(`[WechatSyncCoreAdapter] checkAuth 失败，尝试重导 Cookie 重试...`);
      if (this.options.cookiesProvider) {
        try {
          const fresh = await this.options.cookiesProvider(this.platform, cred);
          if (fresh.length > 0) {
            ctx = await this._createAdapter(fresh);
            if (!ctx) {
              return { success: false, error: `重导 Cookie 后仍无法初始化 adapter。平台: ${this.platform}` };
            }
            const retry = await ctx.adapter.checkAuth();
            if (!retry.isAuthenticated) {
              return { success: false, error: `checkAuth 失败（重导 Cookie 后仍未登录）。平台: ${this.platform}` };
            }
            console.log(`[WechatSyncCoreAdapter] 重导 Cookie 后 checkAuth 通过: ${retry.username}`);
          } else {
            return { success: false, error: `Cookie 全部过期，重导也失败。平台: ${this.platform}` };
          }
        } catch (err) {
          return { success: false, error: `重导 Cookie 失败: ${(err as Error).message}` };
        }
      } else {
        return { success: false, error: `checkAuth 失败且无 cookiesProvider。Cookie 可能已过期。平台: ${this.platform}` };
      }
    } else {
      console.log(`[WechatSyncCoreAdapter] checkAuth 通过: ${auth.username ?? auth.userId}`);
    }

    // 发布（存草稿）
    const coreArticle = this._adaptArticle(params.article);
    const result = await ctx.adapter.publish(coreArticle, { draft: true });

    if (result.success) {
      return {
        success: true,
        postId: result.postId,
        postUrl: result.postUrl,
        draftSaved: true,
        verificationStatus: 'draft_saved',
        verificationMessage: `WechatSyncCore draft saved via pure Node.js (账号: ${auth.username ?? auth.userId})`,
      };
    }

    return { success: false, error: result.error ?? '未知错误' };
  }
}
