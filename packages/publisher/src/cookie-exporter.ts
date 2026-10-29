/**
 * CookieExporter —— 用 Playwright 从 Chrome persistent context 导出明文 Cookie
 *
 * 服务器上 Playwright 在 harvester 的 node_modules 里，
 * 所以这里用动态 import 避免编译时依赖。
 */
import { existsSync, readdirSync } from 'node:fs';
import type { PlatformId, PlatformCredentials } from '@zemingengine/shared';
import type { Cookie } from './node-runtime.js';

export interface CookieExporterOptions {
  profileBase?: string;
  playwrightImportPath?: string;
  profileMap?: Partial<Record<string, string[]>>;
}

const DEFAULT_PROFILE_BASE = '/home/ubuntu/geo-assistant-clean/harvester/data/browser-profiles';
const DEFAULT_PW_IMPORT = 'file:///home/ubuntu/geo-assistant-clean/harvester/node_modules/playwright/index.mjs';
const DEFAULT_PROFILE_MAP: Partial<Record<string, string[]>> = {
  csdn:    ['chrome-漳州新途科技有限公司-csdn', 'chrome-csdn'],
  juejin:  ['chrome-漳州肛肠医院-juejin', 'chrome-orgB-juejin', 'chrome-juejin'],
  zhihu:   ['chrome-漳州新途科技有限公司-zhihu', 'chrome-orgA-zhihu', 'chrome-default-zhihu'],
  toutiao: ['chrome-default-toutiaohao', 'chrome-toutiaohao'],
  sohu:    ['chrome-default-sohuhao', 'chrome-sohuhao', 'chrome-膜一姐汽车贴膜-sohuhao'],
  netease: ['chrome-default-wangyihao', 'chrome-wangyihao', 'chrome-default-netease', 'chrome-netease'],
};

export function resolveProfileDir(
  platform: string,
  options: CookieExporterOptions = {},
  accountName?: string,
): string | null {
  const base = options.profileBase ?? DEFAULT_PROFILE_BASE;
  const map = options.profileMap ?? DEFAULT_PROFILE_MAP;

  // 0. 多账号：只允许使用该账号专属 profile（chrome-<accountName>-<platform>）。
  //    找不到就返回 null，绝不回退到平台下的任意 profile，
  //    否则 A 账号的 Cookie 会被拿去给 B 账号发布，文章会串到 A 的草稿箱。
  if (accountName && accountName !== 'default') {
    const exact = `${base}/chrome-${accountName}-${platform}`;
    return existsSync(exact) ? exact : null;
  }

  // 1. 显式映射（单账号/默认账号）
  const candidates = map[platform] ?? [];
  for (const name of candidates) {
    const p = `${base}/${name}`;
    if (existsSync(p)) return p;
  }

  // 2. 模糊匹配
  try {
    const all = readdirSync(base);
    const hit = all.find(n => n.endsWith(`-${platform}`) || n.includes(`-${platform}-`));
    if (hit) return `${base}/${hit}`;
  } catch {}

  return null;
}

export async function exportCookiesFromChrome(
  platform: PlatformId | string,
  credentials?: PlatformCredentials,
  options: CookieExporterOptions = {},
): Promise<Cookie[]> {
  const accountName = credentials?.accountName;
  const profileDir = resolveProfileDir(String(platform), options, accountName);
  if (!profileDir) {
    const who = accountName && accountName !== 'default' ? `账号 ${accountName} 的` : '';
    throw new Error(`找不到 ${who}${platform} 专属 Chrome profile 目录（base=${options.profileBase ?? DEFAULT_PROFILE_BASE}）。为避免把文章发到其他账号的草稿箱，不会回退使用其他 profile。`);
  }

  const pwPath = options.playwrightImportPath ?? DEFAULT_PW_IMPORT;
  let chromium: any;
  try {
    const mod: any = await import(pwPath);
    chromium = mod.chromium;
  } catch (err) {
    throw new Error(`Playwright 加载失败（路径 ${pwPath}）: ${(err as Error).message}`);
  }

  // launchPersistentContext 返回的是 BrowserContext，不是 Browser
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  try {
    const rawCookies = await context.cookies();
    return rawCookies.map((c: any) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      expirationDate: c.expires,
    })) as Cookie[];
  } finally {
    await context.close();
  }
}
