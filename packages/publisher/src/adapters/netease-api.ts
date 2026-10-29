/**
 * NeteaseApiAdapter —— 网易号（mp.163.com）纯 Node.js 适配器
 *
 * 实现依据：已安装的「文章同步助手」（WechatSync v2）扩展包内自带的
 * NeteaseAdapter（meta.id = 'netease'）——它走的是 mp.163.com 站内接口，
 * 而不是 Playwright 页面操作。核心接口：
 *   1. 登录态：GET  https://mp.163.com/wemedia/navinfo.do?_=<ts>
 *              → { code:1, data:{ tid, tname, icon, realUserId } }
 *   2. 存草稿：POST https://mp.163.com/wemedia/article/status/api/publishV2.do
 *              ?_=<ts>&wemediaId=<tid>&realUserId=<realUserId>
 *              body(form-urlencoded): wemediaId / articleId=-1 / title / content
 *              / cover=threeImg / operation=saveDraft / scheduled=0 / ursToken
 *              / onlineState=1 / picUrl / original=0 / subjectId
 *   3. 传图：  POST https://mp.163.com/wemedia/article/api/uploadCoverImage.do?wemediaId=<tid>
 *              multipart，字段名 file → { code:1, data:{ url | picUrl } }
 *
 * ⚠️ 唯一无法纯 Node 复现的环节：ursToken。
 * 插件里是用 tabs + `window.neg.getToken()` 在已登录的 mp.163.com 页面里取的。
 * NodeRuntime 没有 tabs 能力，因此这里退化为传空字符串（与插件取不到 token 时
 * 的行为一致）。若服务端强校验，可通过 ursTokenProvider 注入外部获取的 token。
 */
import type { PlatformCredentials, PlatformId } from '@zemingengine/shared';
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
  /** 自定义 ursToken 获取方式（可选，默认传空串） */
  ursTokenProvider?: () => Promise<string | undefined>;
  debug?: boolean;
}

const NAVINFO_URL = 'https://mp.163.com/wemedia/navinfo.do';
const PUBLISH_URL = 'https://mp.163.com/wemedia/article/status/api/publishV2.do';
const UPLOAD_URL = 'https://mp.163.com/wemedia/article/api/uploadCoverImage.do';

const PAGE_HEADERS = {
  Origin: 'https://mp.163.com',
  Referer: 'https://mp.163.com/subscribe_v4/index.html',
};

interface NeteaseAccount {
  tid: string;
  tname?: string;
  icon?: string;
  realUserId?: string;
}

export class NeteaseApiAdapter extends PlatformAdapter {
  private readonly options: NeteaseApiAdapterOptions;

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
      } catch { /* ignore */ }
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

  private _createRuntime(cookies: Cookie[]): NodeRuntime {
    return new NodeRuntime(formatCookiesForRuntime(cookies), { debug: this.options.debug });
  }

  /** 用 navinfo.do 校验登录态并返回账号信息 */
  private async _fetchAccount(runtime: NodeRuntime): Promise<{ account: NeteaseAccount | null; error?: string }> {
    try {
      const resp = await runtime.fetch(`${NAVINFO_URL}?_=${Date.now()}`, {
        method: 'GET',
        headers: { ...PAGE_HEADERS, Accept: 'application/json, text/plain, */*' },
      });
      const data = await resp.json() as any;
      if (data?.code !== 1 || !data?.data?.tid) {
        return { account: null, error: data?.msg || 'navinfo.do 未返回登录账号' };
      }
      return { account: data.data as NeteaseAccount };
    } catch (err) {
      return { account: null, error: (err as Error).message };
    }
  }

  async checkAuth(credentials: PlatformCredentials): Promise<{
    isAuthenticated: boolean;
    username?: string;
    userId?: string;
    error?: string;
  }> {
    const cookies = await this._getCookies(credentials);
    if (cookies.length === 0) return { isAuthenticated: false, error: '无可用 Cookie' };

    const runtime = this._createRuntime(cookies);
    const result = await this._fetchAccount(runtime);
    if (!result.account) return { isAuthenticated: false, error: result.error };

    return {
      isAuthenticated: true,
      userId: result.account.tid,
      username: result.account.tname,
    };
  }

  async publish(params: PublishParams): Promise<PublishResult> {
    const cookies = await this._getCookies(params.credentials);
    if (cookies.length === 0) {
      return { success: false, error: `无可用 Cookie。请为账号 ${params.credentials.accountId} 配置网易号 Cookie。` };
    }

    const runtime = this._createRuntime(cookies);
    const auth = await this._fetchAccount(runtime);
    if (!auth.account) return { success: false, error: `网易号未登录: ${auth.error}` };

    const account = auth.account;
    let ursToken = '';
    if (this.options.ursTokenProvider) {
      try {
        ursToken = (await this.options.ursTokenProvider()) ?? '';
      } catch (err) {
        console.warn('[NeteaseApiAdapter] ursTokenProvider 失败:', err);
      }
    }

    const html = await this._processImages(
      runtime,
      account.tid,
      params.article.contentHtml || '',
    );

    const body = new URLSearchParams();
    body.append('wemediaId', account.tid);
    body.append('articleId', '-1');
    body.append('title', params.article.title);
    body.append('content', html);
    body.append('cover', 'threeImg');
    body.append('operation', 'saveDraft');
    body.append('scheduled', '0');
    body.append('ursToken', ursToken);
    body.append('onlineState', '1');
    body.append('picUrl', '');
    body.append('original', '0');
    body.append('subjectId', '');

    const url = `${PUBLISH_URL}?_=${Date.now()}&wemediaId=${account.tid}`
      + `&realUserId=${encodeURIComponent(account.realUserId || '')}`;

    try {
      const resp = await runtime.fetch(url, {
        method: 'POST',
        headers: {
          ...PAGE_HEADERS,
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: body.toString(),
      });
      const data = await resp.json() as any;
      if (data?.code !== 1) {
        return {
          success: false,
          error: `网易号保存草稿失败: ${data?.msg || JSON.stringify(data).slice(0, 200)}`
            + (ursToken ? '' : '（ursToken 为空，若为鉴权失败需通过 ursTokenProvider 注入）'),
        };
      }

      const docId = data.data
        ? (new URLSearchParams(String(data.data)).get('docId') || String(data.data))
        : '';
      return {
        success: true,
        postId: docId,
        postUrl: `https://mp.163.com/subscribe_v4/index.html#/article-publish/${docId}?option=editDraft`,
        draftSaved: true,
        verificationStatus: 'draft_saved',
        verificationMessage: `网易号草稿已保存（账号: ${account.tname || account.tid}）`,
      };
    } catch (err) {
      return { success: false, error: `网易号保存草稿异常: ${(err as Error).message}` };
    }
  }

  /** 把正文里的外链图片上传到网易号并替换为站内地址（失败保留原图） */
  private async _processImages(runtime: NodeRuntime, wemediaId: string, html: string): Promise<string> {
    if (!html) return html;
    const matches = [...html.matchAll(/<img[^>]*?src=["']([^"']+)["'][^>]*>/gi)];
    if (matches.length === 0) return html;

    let out = html;
    for (const m of matches) {
      const src = m[1];
      if (!src || src.startsWith('data:')) continue;
      if (/126\.net|163\.com|netease\.com/.test(src)) continue;
      try {
        const uploaded = await this._uploadImage(runtime, wemediaId, src);
        if (uploaded) out = out.split(m[0]).join(m[0].replace(src, uploaded));
      } catch (err) {
        console.warn(`[NeteaseApiAdapter] 图片上传失败，保留原图: ${src}`, err);
      }
    }
    return out;
  }

  private async _uploadImage(runtime: NodeRuntime, wemediaId: string, src: string): Promise<string | null> {
    const imgResp = await fetch(src);
    if (!imgResp.ok) return null;
    const blob = await imgResp.blob();

    const form = new FormData();
    form.append('file', blob, 'image.jpg');

    const resp = await runtime.fetch(`${UPLOAD_URL}?wemediaId=${wemediaId}`, {
      method: 'POST',
      headers: PAGE_HEADERS,
      body: form as any,
    });
    const data = await resp.json() as any;
    if (data?.code !== 1 || !data?.data) return null;
    return data.data.url || data.data.picUrl || null;
  }
}
