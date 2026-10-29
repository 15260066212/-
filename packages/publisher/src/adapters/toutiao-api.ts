/**
 * ToutiaoApiAdapter —— 头条号（mp.toutiao.com）纯 Node.js API 适配器
 *
 * 来源：wechatsync-v2 git 历史中的扩展适配器（commit 2cf6027，
 * 后被移入 private submodule）+ v1 driver（commit ea0fedf）。
 *
 * 端点：
 *   - checkAuth:  GET  /mp/agw/media/get_media_info
 *   - publish:    POST /mp/agw/article/publish?source=mp&type=article&aid=1231
 *   - 图片中转:   POST /tools/catch_picture/ (服务端代抓图)
 *
 * ⚠️ 已知限制：
 *   - 扩展版发布时由页面 fetch 自动注入 msToken/a_bogus 签名；
 *     纯 Node.js 无法生成这些签名。若发布返回 err_no=7050（风控）
 *     或类似反爬错误，需要补 a_bogus 签名算法或退回 RPA。
 *   - checkAuth 不需要签名，可直接验证登录态和 Cookie 有效性。
 *   - save 参数默认 '1'（存草稿，安全）；传 { save: '0' } 才会直接发布。
 */
import type { Article, PlatformCredentials } from '@zemingengine/shared';
import type { PublishParams, PublishResult } from '../types.js';
import { PlatformAdapter } from './base.js';
import { NodeRuntime, formatCookiesForRuntime, parseCookieHeader } from '../node-runtime.js';
import type { Cookie } from '../node-runtime.js';
import { getPlatformDomains } from '@zemingengine/shared';

export type ToutiaoCookieProvider = (
  platform: string,
  credentials: PlatformCredentials,
) => Promise<Cookie[]>;

export interface ToutiaoApiAdapterOptions {
  cookiesProvider?: ToutiaoCookieProvider;
  debug?: boolean;
  /** '1' = 存草稿（默认，安全），'0' = 直接发布 */
  save?: '0' | '1';
}

interface ToutiaoMediaInfo {
  message?: string;
  data?: {
    user?: {
      id: number;
      screen_name: string;
      https_avatar_url: string;
    };
  };
}

interface ToutiaoPublishResponse {
  err_no?: number;
  message?: string;
  data?: {
    pgc_id?: string | number;
  };
}

const ORIGIN = 'https://mp.toutiao.com';
const REFERER = 'https://mp.toutiao.com/profile_v4/graphic/publish';

// 图片已托管在头条图床的域名，跳过中转
const IMAGE_SKIP_PATTERNS = ['pstatp.com', 'toutiao.com', 'byteimg.com', 'zjcdn.com'];

export class ToutiaoApiAdapter extends PlatformAdapter {
  private readonly options: ToutiaoApiAdapterOptions;
  /**
   * 同平台发布串行队列 + 每次发布使用局部 runtime。
   *
   * Publisher 每个平台只注册一个 adapter 单例。若把 runtime 存在实例字段上，
   * 多会话/多账号并发发布时会互相覆盖，A 账号的文章可能带着 B 账号的 Cookie
   * 写进 B 的草稿箱。这里不再持有实例级 runtime，并让同一实例的 publish 串行执行。
   */
  private _publishChain: Promise<unknown> = Promise.resolve();

  constructor(options: ToutiaoApiAdapterOptions = {}) {
    super('toutiao');
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

    // 2. credentials.data.cookie（harvester 同步到主库的 Cookie 头字符串，主库的常规格式）
    const rawHeader = (credentials.data as any)?.cookie;
    if (typeof rawHeader === 'string' && rawHeader.trim().length > 0) {
      const domain = getPlatformDomains(this.platform)[0];
      const parsed = domain ? parseCookieHeader(rawHeader, domain) : [];
      if (parsed.length > 0) return parsed;
    }

    if (this.options.cookiesProvider) {
      try {
        const cookies = await this.options.cookiesProvider(this.platform, credentials);
        if (cookies && cookies.length > 0) return cookies;
      } catch (err) {
        console.warn('[ToutiaoApiAdapter] cookiesProvider 失败:', err);
      }
    }
    return [];
  }

  private _createRuntime(cookies: Cookie[]): NodeRuntime {
    return new NodeRuntime(formatCookiesForRuntime(cookies), {
      debug: this.options.debug,
    });
  }

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
    return this._checkAuthWith(this._createRuntime(cookies));
  }

  private async _checkAuthWith(runtime: NodeRuntime): Promise<{
    isAuthenticated: boolean;
    username?: string;
    userId?: string;
    error?: string;
  }> {
    try {
      const resp = await runtime.fetch(
        'https://mp.toutiao.com/mp/agw/media/get_media_info',
        { method: 'GET', headers: { 'Referer': ORIGIN } },
      );
      const res: ToutiaoMediaInfo = await resp.json();

      if (res.data?.user?.id) {
        return {
          isAuthenticated: true,
          userId: String(res.data.user.id),
          username: res.data.user.screen_name,
        };
      }
      return {
        isAuthenticated: false,
        error: `get_media_info 未返回用户: ${res.message ?? JSON.stringify(res).slice(0, 120)}`,
      };
    } catch (err) {
      return { isAuthenticated: false, error: (err as Error).message };
    }
  }

  private async _toHtml(article: Article): Promise<string> {
    if (article.contentHtml && article.contentHtml.trim().length > 0) {
      return article.contentHtml;
    }
    const md = article.contentMarkdown ?? '';
    if (!md) return '';
    const { marked }: any = await import('marked');
    return marked.parse(md) as string;
  }

  /** 最小 HTML 清理：移除 script/style/iframe */
  private _cleanHtml(html: string): string {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<iframe[\s\S]*?<\/iframe>/gi, '');
  }

  /**
   * 图片中转上传（服务端代抓，无需 multipart/CSRF）
   * v1 端点: POST /tools/catch_picture/  body: upfile=<src>&version=2
   * 响应形态不确定，尽力解析；失败则保留原图（草稿可在编辑器里修）
   */
  private async _relayImage(src: string, runtime: NodeRuntime): Promise<string | null> {
    try {
      const resp = await runtime.fetch('https://mp.toutiao.com/tools/catch_picture/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Origin': ORIGIN,
          'Referer': REFERER,
        },
        body: new URLSearchParams({ upfile: src, version: '2' }).toString(),
      });
      const res: any = await resp.json();
      const first = Array.isArray(res?.images) ? res.images[0] : undefined;
      if (typeof first === 'string' && first.startsWith('http')) return first;
      if (first && typeof first === 'object') {
        const url = first.url ?? first.image_url ?? first.web_uri ?? first.large_url;
        if (typeof url === 'string' && url.startsWith('http')) return url;
      }
      return null;
    } catch (err) {
      if (this.options.debug) console.warn('[ToutiaoApiAdapter] 图片中转失败:', (err as Error).message);
      return null;
    }
  }

  /** 替换外域图片为头条图床，失败保留原图 */
  private async _processImages(html: string, runtime: NodeRuntime): Promise<string> {
    const imgRe = /<img\s[^>]*src=["']([^"']+)["'][^>]*>/gi;
    const matches: Array<{ full: string; src: string }> = [];
    let m: RegExpExecArray | null;
    while ((m = imgRe.exec(html)) !== null) {
      matches.push({ full: m[0], src: m[1] });
    }

    let result = html;
    for (const { full, src } of matches) {
      if (IMAGE_SKIP_PATTERNS.some(p => src.includes(p))) continue;
      if (!src.startsWith('http')) continue;
      const relayed = await this._relayImage(src, runtime);
      if (relayed) {
        result = result.replace(full, full.replace(src, relayed));
      }
    }
    return result;
  }

  /** 头条编辑器要求 img 包在 pgc-img div 里 */
  private _wrapImages(html: string): string {
    return html.replace(/<img\s+([^>]+)>/gi, '<div class="pgc-img"><img $1><p class="pgc-img-caption"></p></div>');
  }

  async publish(params: PublishParams): Promise<PublishResult> {
    // 同平台串行：两个账号的发布请求交错执行时，各自持有独立的局部 runtime，不会串号
    const run = this._publishChain.then(() => this._publishOnce(params));
    this._publishChain = run.catch(() => {});
    return run;
  }

  private async _publishOnce(params: PublishParams): Promise<PublishResult> {
    // 1. 认证（失败自动重导 Cookie 重试一次）—— runtime 全部是局部变量
    const cookies = await this._getCookies(params.credentials);
    if (cookies.length === 0) {
      return { success: false, error: '头条号未登录: 无可用 Cookie' };
    }
    let runtime = this._createRuntime(cookies);
    let auth = await this._checkAuthWith(runtime);
    if (!auth.isAuthenticated && this.options.cookiesProvider) {
      try {
        const fresh = await this.options.cookiesProvider(this.platform, params.credentials);
        if (fresh.length > 0) {
          runtime = this._createRuntime(fresh);
          auth = await this._checkAuthWith(runtime);
        }
      } catch { /* keep first error */ }
    }
    if (!auth.isAuthenticated) {
      return { success: false, error: `头条号未登录: ${auth.error ?? '未知原因'}` };
    }
    if (this.options.debug) {
      console.log(`[ToutiaoApiAdapter] checkAuth 通过: ${auth.username}`);
    }

    try {
      // 2. 准备内容
      let content = this._cleanHtml(await this._toHtml(params.article));
      content = await this._processImages(content, runtime);
      content = this._wrapImages(content);
      content = content.replace(/<figure[^>]*>\s*<\/figure>/gi, '').replace(/\n{3,}/g, '\n\n');

      // 3. 组装表单（字段与 wechatsync 扩展版一致）
      const extra = JSON.stringify({
        content_source: 100000000402,
        content_word_cnt: content.length,
        is_multi_title: 0,
        sub_titles: [],
        gd_ext: {
          entrance: '',
          from_page: 'publisher_mp',
          enter_from: 'PC',
          device_platform: 'mp',
          is_message: 0,
        },
      });
      const titleId = `${Date.now()}_${Math.random().toString().slice(2, 18)}`;
      const save = this.options.save ?? '1'; // 默认存草稿

      const form = new URLSearchParams({
        pgc_id: '0',
        source: '29',
        extra,
        content,
        title: params.article.title,
        search_creation_info: JSON.stringify({ searchTopOne: 0, abstract: '', clue_id: '' }),
        title_id: titleId,
        mp_editor_stat: '{}',
        is_refute_rumor: '0',
        save,
        timer_status: '0',
        timer_time: '',
        educluecard: '',
        draft_form_data: JSON.stringify({ coverType: 3 }),
        pgc_feed_covers: '[]',
        article_ad_type: '3',
        is_fans_article: '0',
        govern_forward: '0',
        praise: '0',
        disable_praise: '0',
        tree_plan_article: '0',
        activity_tag: '0',
        trends_writing_tag: '0',
        claim_exclusive: '0',
      });

      // 4. 发布请求
      const resp = await runtime.fetch(
        'https://mp.toutiao.com/mp/agw/article/publish?source=mp&type=article&aid=1231',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Origin': ORIGIN,
            'Referer': REFERER,
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: form.toString(),
        },
      );
      const text = await resp.text();
      let res: ToutiaoPublishResponse;
      try {
        res = JSON.parse(text);
      } catch {
        return { success: false, error: `发布响应非 JSON (HTTP ${resp.status}): ${text.slice(0, 150)}` };
      }

      if (res.err_no !== 0 || !res.data?.pgc_id) {
        // err_no=7050 即头条风控（msToken/a_bogus 缺失的典型表现）
        return {
          success: false,
          error: `头条发布失败 err_no=${res.err_no}: ${res.message ?? text.slice(0, 120)}`
            + (res.err_no === 7050 ? '（风控拦截，纯 Node 缺 msToken/a_bogus 签名，需退回 RPA 或补签名）' : ''),
        };
      }

      const postId = String(res.data.pgc_id);
      return {
        success: true,
        postId,
        postUrl: `https://mp.toutiao.com/profile_v4/graphic/publish?pgc_id=${postId}`,
        draftSaved: save === '1',
        verificationStatus: 'draft_saved',
        verificationMessage: `头条草稿保存成功 (账号: ${auth.username})`,
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }
}
