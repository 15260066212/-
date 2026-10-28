/**
 * NeteaseApiAdapter —— 网易号（mp.163.com）纯 Node.js 适配器骨架
 *
 * ⚠️ 当前状态：骨架。checkAuth 可用；publish 需要抓包补全。
 *
 * 背景：网易号编辑器是 React SPA + DraftJS，所有公开开源实现
 * （wechatsync / artipub / wangyi-publish-skill）都走 Playwright CDP，
 * 没有人逆向过纯 fetch API。
 *
 * 启用方式（需要抓包后）：
 *   1. 在浏览器登录 mp.163.com，进入 https://mp.163.com/#/article-publish
 *   2. 打开 DevTools Network，填标题+正文，等 1 分钟自动保存触发
 *   3. 抓保存草稿的 XHR（应该是 POST /mp/media/api/... 或 /api/...）
 *   4. 把端点 + 请求体字段填到下方 PUBLISH_API 和 buildDraftBody()
 *   5. 在 Publisher.createDefault() 里注册：
 *      pub.registerAdapter(new NeteaseApiAdapter({ cookiesProvider: exportCookiesFromChrome }))
 *
 * 风险：
 *   - 网易易盾滑块（登录环节）
 *   - 账号实名认证门槛（未认证点发布会弹窗，但草稿可保存）
 */
import type { Article, PlatformCredentials, PlatformId } from '@zemingengine/shared';
import type { PublishParams, PublishResult } from '../types.js';
import { PlatformAdapter } from './base.js';
import { NodeRuntime, formatCookiesForRuntime } from '../node-runtime.js';
import type { Cookie } from '../node-runtime.js';

export type NeteaseCookieProvider = (
  platform: PlatformId,
  credentials: PlatformCredentials,
) => Promise<Cookie[]>;

export interface NeteaseApiAdapterOptions {
  cookiesProvider?: NeteaseCookieProvider;
  debug?: boolean;
}

// ===== 待抓包补全的 API 端点 =====
// 登录态检查：用首页 GET 即可（响应含账号信息则已登录，跳登录页则未登录）
const CHECK_AUTH_URL = 'https://mp.163.com/';
// 草稿保存：⚠️ 未抓包，目前是占位符
const DRAFT_API_URL = 'https://mp.163.com/mp/media/api/article/saveDraft'; // TODO: 抓包确认

export class NeteaseApiAdapter extends PlatformAdapter {
  private readonly options: NeteaseApiAdapterOptions;
  private _runtime: NodeRuntime | null = null;

  constructor(options: NeteaseApiAdapterOptions = {}) {
    super('netease');
    this.options = options;
  }

  getMethod(): 'api' { return 'api'; }

  private async _getCookies(credentials: PlatformCredentials): Promise<Cookie[]> {
    const rawCookies = (credentials.data as any)?.cookies;
    if (typeof rawCookies === 'string' && rawCookies.length > 0) {
      try {
        const parsed = JSON.parse(rawCookies);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed as Cookie[];
      } catch {}
    }
    if (Array.isArray(rawCookies) && rawCookies.length > 0) return rawCookies as Cookie[];

    if (this.options.cookiesProvider) {
      try {
        const cookies = await this.options.cookiesProvider(this.platform, credentials);
        if (cookies && cookies.length > 0) return cookies;
      } catch (err) {
        console.warn('[NeteaseApiAdapter] cookiesProvider 失败:', err);
      }
    }
    return [];
  }

  private _ensureRuntime(cookies: Cookie[]): void {
    this._runtime = new NodeRuntime(formatCookiesForRuntime(cookies), {
      debug: this.options.debug,
    });
  }

  /**
   * 检查登录态：GET 首页，看响应是否含登录后特征
   * 网易号首页未登录会 302 到 passport.163.com
   */
  async checkAuth(credentials: PlatformCredentials): Promise<{
    isAuthenticated: boolean;
    username?: string;
    userId?: string;
    error?: string;
  }> {
    const cookies = await this._getCookies(credentials);
    if (cookies.length === 0) {
      return { isAuthenticated: false, error: '无可用 Cookie' };
    }
    this._ensureRuntime(cookies);

    try {
      // NodeRuntime.fetch 不跟随重定向时，我们需要手动检查
      // 由于 Node.js fetch 默认跟随重定向，我们用 response.url 判断最终落点
      const resp = await this._runtime!.fetch(CHECK_AUTH_URL, {
        method: 'GET',
        redirect: 'follow',
      });
      const finalUrl = resp.url;
      const text = await resp.text();

      // 未登录：被重定向到 passport.163.com / login
      if (finalUrl.includes('passport.163.com') || finalUrl.includes('login')) {
        return { isAuthenticated: false, error: `被重定向到登录页: ${finalUrl}` };
      }
      // 未登录：响应里包含登录引导文案
      if (text.includes('登录网易') || text.includes('请登录')) {
        return { isAuthenticated: false, error: '响应包含登录引导文案' };
      }
      // 已登录：响应里包含编辑器入口或用户信息
      // 这里只是启发式判断，具体特征需抓包确认
      const hasAuthCookie = cookies.some(c =>
        c.name === 'NTES_SESS' || c.name === 'P_INFO' || c.name === 'NTES_PASSPORT',
      );
      if (!hasAuthCookie) {
        return { isAuthenticated: false, error: '缺少关键鉴权 Cookie (NTES_SESS/P_INFO/NTES_PASSPORT)' };
      }

      return {
        isAuthenticated: true,
        username: 'netease-user', // TODO: 从响应解析真实用户名
      };
    } catch (err) {
      return { isAuthenticated: false, error: (err as Error).message };
    }
  }

  /**
   * 保存草稿 —— ⚠️ 当前是占位实现，需要抓包补全
   *
   * 抓包步骤：
   *   1. 浏览器登录 https://mp.163.com/#/article-publish
   *   2. DevTools → Network → 过滤 XHR
   *   3. 填写标题 + 正文，等约 60s 触发自动保存
   *   4. 找到 POST 请求（大概率路径含 /api/ 或 /mp/media/）
   *   5. 记录：URL / Method / Content-Type / Request Payload 字段名
   *   6. 把字段填到下面的 buildDraftBody()
   */
  async publish(params: PublishParams): Promise<PublishResult> {
    const auth = await this.checkAuth(params.credentials);
    if (!auth.isAuthenticated) {
      return { success: false, error: `网易号未登录: ${auth.error}` };
    }

    // ⚠️ 占位实现：API 端点未抓包确认
    return {
      success: false,
      error: [
        '网易号 publish API 尚未实现（骨架适配器）。',
        '原因：网易号编辑器是 React SPA + DraftJS，公开生态无 fetch API 逆向记录。',
        '启用步骤：抓包 mp.163.com 编辑器自动保存 XHR → 填入 DRAFT_API_URL 和 buildDraftBody()。',
        `占位 URL: ${DRAFT_API_URL}`,
        '临时方案：保持现有 NeteaseRpaHandler 兜底（不要在 Publisher.createDefault 注册本 adapter）。',
      ].join(' '),
    };

    // 抓包后启用以下模板：
    /*
    const article = params.article;
    const body = this.buildDraftBody(article);
    const resp = await this._runtime!.fetch(DRAFT_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'Origin': 'https://mp.163.com',
        'Referer': 'https://mp.163.com/',
      },
      body: JSON.stringify(body),
    });
    const res = await resp.json();
    if (!res.success) {
      return { success: false, error: res.msg ?? '草稿保存失败' };
    }
    return {
      success: true,
      postId: String(res.data),
      postUrl: `https://mp.163.com/subscribe_v4/index.html#/article/${res.data}`,
      draftSaved: true,
      verificationStatus: 'draft_saved',
      verificationMessage: '网易号草稿保存成功',
    };
    */
  }

  /**
   * 构建草稿请求体 —— 抓包后填充字段
   */
  // private buildDraftBody(article: Article): Record<string, unknown> {
  //   return {
  //     title: article.title,
  //     content: article.contentHtml ?? '',
  //     // TODO: 抓包补全 categoryId / summary / cover / tags 等字段
  //   };
  // }
}
