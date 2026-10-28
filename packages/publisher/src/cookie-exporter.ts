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
): string | null {
  const base = options.profileBase ?? DEFAULT_PROFILE_BASE;
  const map = options.profileMap ?? DEFAULT_PROFILE_MAP;

  // 1. 显式映射
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
  _credentials?: PlatformCredentials,
  options: CookieExporterOptions = {},
): Promise<Cookie[]> {
  const profileDir = resolveProfileDir(String(platform), options);
  if (!profileDir) {
    throw new Error(`找不到 ${platform} 的 Chrome profile 目录（base=${options.profileBase ?? DEFAULT_PROFILE_BASE}）`);
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
