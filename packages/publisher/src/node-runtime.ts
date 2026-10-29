/**
 * NodeRuntime —— 纯 Node.js 运行时，实现 WechatSync Core 的 RuntimeInterface
 *
 * 让 @wechatsync/core 的平台适配器不依赖 Chrome 扩展就能跑。
 * 核心能力：fetch + cookies (get/set/remove) + headerRules + storage + session + dom
 */
// 动态 import linkedom：从 @zemingengine/wechatsync-core 的 node_modules 解析
// （publisher 包间接依赖，避免 workspace npm install 问题）
let parseHTMLFn: any = null;
async function getParseHTML() {
  if (parseHTMLFn) return parseHTMLFn;
  // 优先尝试直接 import（如果 publisher/node_modules 有）
  try {
    const mod: any = await import('linkedom');
    parseHTMLFn = mod.parseHTML;
    return parseHTMLFn;
  } catch {}
  // 回退：从 wechatsync-core 的 node_modules
  try {
    const path = await import('node:path');
    const url = await import('node:url');
    const wecoreDir = path.dirname(url.fileURLToPath(import.meta.resolve('@zemingengine/wechatsync-core/package.json')));
    const mod: any = await import(path.join(wecoreDir, 'node_modules', 'linkedom', 'esm', 'index.js'));
    parseHTMLFn = mod.parseHTML;
    return parseHTMLFn;
  } catch (e) {
    // 最后回退：返回 null parser（Dom 方法会返回空数组）
    console.warn('[NodeRuntime] linkedom 加载失败，DOM 方法将不可用。错误:', (e as Error).message);
    parseHTMLFn = () => null;
    return parseHTMLFn;
  }
}

export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure?: boolean;
  httpOnly?: boolean;
  expirationDate?: number;
}

export interface NodeRuntimeOptions {
  userAgent?: string;
  debug?: boolean;
}

export function formatCookiesForRuntime(rawCookies: Cookie[]): Record<string, Cookie[]> {
  const byDomain: Record<string, Cookie[]> = {};
  for (const c of rawCookies) {
    const d = (c.domain || '').replace(/^\./, '');
    if (!d) continue;
    if (!byDomain[d]) byDomain[d] = [];
    byDomain[d].push({ ...c });
  }
  return byDomain;
}

/**
 * 把主库凭证里的 Cookie 头字符串（`a=1; b=2`）还原成 Cookie 数组。
 * 主库只存 cookie 字符串（丢失 domain/path），需要调用方按平台域名回填，
 * 这样 NodeRuntime 才能按域名匹配到 Cookie，且每个账号各用各的凭证不会串号。
 */
export function parseCookieHeader(header: string, domain: string): Cookie[] {
  const cookies: Cookie[] = [];
  if (!header || !domain) return cookies;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!name) continue;
    cookies.push({ name, value, domain, path: '/', secure: true, httpOnly: false });
  }
  return cookies;
}

export class NodeRuntime {
  readonly type = 'node';
  readonly userAgent: string;
  private _cookieJar: Record<string, Cookie[]>;
  private _storage = new Map<string, string>();
  private _session = new Map<string, string>();
  private _headers = new Map<string, Record<string, string>>();
  private _debug: boolean;

  constructor(cookiesByDomain: Record<string, Cookie[]> = {}, options: NodeRuntimeOptions = {}) {
    this.userAgent = options.userAgent ??
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    this._cookieJar = cookiesByDomain;
    this._debug = options.debug ?? false;
  }

  async cookiesGet(domain: string): Promise<Cookie[]> {
    const r: Cookie[] = [];
    for (const [kd, list] of Object.entries(this._cookieJar)) {
      if (domain === kd || domain.endsWith('.' + kd) || kd.endsWith('.' + domain)) {
        r.push(...list);
      }
    }
    return r;
  }
  async cookiesSet(cookie: Cookie): Promise<void> {
    const d = (cookie.domain || '').replace(/^\./, '');
    if (!this._cookieJar[d]) this._cookieJar[d] = [];
    const existing = this._cookieJar[d].findIndex(c => c.name === cookie.name);
    if (existing >= 0) this._cookieJar[d][existing] = cookie;
    else this._cookieJar[d].push(cookie);
  }
  async cookiesRemove(name: string, domain: string): Promise<void> {
    const d = domain.replace(/^\./, '');
    if (this._cookieJar[d]) this._cookieJar[d] = this._cookieJar[d].filter(c => c.name !== name);
  }

  /** 按域名+名字读取单个 cookie（CodeAdapter 平台适配器依赖，如 sohu 的 mp-cv） */
  async getCookie(domain: string, name: string): Promise<string | null> {
    const cookies = await this.cookiesGet(domain.replace(/^\./, ''));
    return cookies.find(c => c.name === name)?.value ?? null;
  }

  async storageGet(key: string): Promise<string | null> { return this._storage.get(key) ?? null; }
  async storageSet(key: string, value: string): Promise<void> { this._storage.set(key, value); }
  async storageRemove(key: string): Promise<void> { this._storage.delete(key); }

  async sessionGet(key: string): Promise<string | null> { return this._session.get(key) ?? null; }
  async sessionSet(key: string, value: string): Promise<void> { this._session.set(key, value); }

  async headerRulesAdd(rules: Array<{ urlFilter: string; headers: Record<string, string> }>): Promise<string> {
    const id = 'hr_' + Math.random().toString(36).slice(2);
    this._headers.set(id, rules[0]?.headers ?? {});
    return id;
  }
  async headerRulesRemove(_id?: string): Promise<void> {}
  async headerRulesClear(): Promise<void> { this._headers.clear(); }

  async parseHTML(html: string) { return (await getParseHTML())(html); }
  querySelector(doc: any, selector: string) { return doc?.querySelector?.(selector) ?? null; }
  querySelectorAll(doc: any, selector: string) { return doc?.querySelectorAll?.(selector) ?? []; }
  getTextContent(el: any) { return el?.textContent ?? ''; }
  getInnerHTML(el: any) { return el?.innerHTML ?? ''; }

  async fetch(url: string, options: RequestInit = {}): Promise<Response> {
    const opts: RequestInit = { ...options };
    const headersMap: Record<string, string> = (opts.headers as any) ?? {};
    headersMap['User-Agent'] = this.userAgent;

    const urlObj = new URL(url);
    const domainCookies = await this.cookiesGet(urlObj.hostname);
    const validCookies = domainCookies
      .filter(c => !c.expirationDate || c.expirationDate > Date.now() / 1000)
      .map(c => `${c.name}=${c.value}`)
      .join('; ');
    if (validCookies) headersMap['Cookie'] = validCookies;

    for (const hdrs of this._headers.values()) Object.assign(headersMap, hdrs);

    (opts as any).headers = headersMap;
    delete (opts as any).credentials;

    if (this._debug) {
      const bodyStr = opts.body ? (typeof opts.body === 'string' ? opts.body.slice(0, 200) : '[FormData/Buffer]') : '';
      console.log(`[NodeRuntime] ${opts.method || 'GET'} ${url.slice(0, 120)}${bodyStr ? ` body=${bodyStr}` : ''}`);
    }

    const resp = await globalThis.fetch(url, opts);
    const text = await resp.text();

    if (this._debug) {
      console.log(`[NodeRuntime] ${resp.status} (${text.length} bytes) ${text.slice(0, 150)}`);
    }

    return new Response(text, { status: resp.status, statusText: resp.statusText, headers: resp.headers });
  }

  // RuntimeInterface compat getters
  get cookies() { return { get: (d: string) => this.cookiesGet(d), set: (c: Cookie) => this.cookiesSet(c), remove: (n: string, d: string) => this.cookiesRemove(n, d) }; }
  get storage() { return { get: (k: string) => this.storageGet(k), set: (k: string, v: string) => this.storageSet(k, v), remove: (k: string) => this.storageRemove(k) }; }
  get session() { return { get: (k: string) => this.sessionGet(k), set: (k: string, v: string) => this.sessionSet(k, v) }; }
  get headerRules() { return { add: (r: any) => this.headerRulesAdd(r), remove: () => {}, clear: () => this.headerRulesClear() }; }
  get dom() { return { parseHTML: (h: string) => this.parseHTML(h), querySelector: (d: any, s: string) => this.querySelector(d, s), querySelectorAll: (d: any, s: string) => this.querySelectorAll(d, s), getTextContent: (e: any) => this.getTextContent(e), getInnerHTML: (e: any) => this.getInnerHTML(e) }; }
}
