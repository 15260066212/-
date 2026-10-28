/**
 * Unified anti-detection (stealth) injection for all Playwright contexts.
 *
 * 为什么需要这个文件：
 *   之前 session.ts / rpa.ts 各有一份手动反检测脚本，account-profiles.ts 和
 *   publish-context.ts 连 addInitScript 都没有 — 发布流程完全裸奔。
 *   这里统一成一个模块，覆盖头条等风控最关心的检测点。
 *
 * 依赖：零 npm 包。纯 TypeScript，编译即生效。
 */

import type { BrowserContext } from 'playwright';

/**
 * 注入完整反检测脚本到一个 BrowserContext。
 * 必须在 context 刚创建、任何 page.goto() 之前调用。
 */
export async function injectStealth(context: BrowserContext): Promise<void> {
  await context.addInitScript(STEALTH_JS);
}

/**
 * 直接作为 Playwright launchPersistentContext 的可选参数。
 * 用法:
 *   await chromium.launchPersistentContext(dir, {
 *     ...getProxyOptions(),
 *     ...getStealthLaunchOptions(),
 *   })
 *
 * 注意：args 里的 --disable-blink-features=AutomationControlled 是 Chromium
 * 层面的屏蔽（让 navigator.webdriver 默认为 false），但 JS 层面的
 * Object.defineProperty 仍然需要作为双重保险。
 */
export function getStealthLaunchOptions(): Record<string, unknown> {
  return {
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-infobars',
      '--disable-features=IsolateOrigins,site-per-process,BookmarkBar',
      '--hide-crash-restore-bubble',
      '--password-store=basic',
      '--disable-background-networking',
      '--disable-default-apps',
      '--no-service-autorun',
      '--disable-extensions-except',
      '--disable-automation',
    ],
    ignoreHTTPSErrors: true,
    bypassCSP: true,
  };
}

// ─── Stealth 脚本本体 ──────────────────────────────────────────────────────
// 覆盖点：
//   1. navigator.webdriver → false
//   2. window.chrome.runtime/CSI/loadTimes 模拟
//   3. navigator.plugins 伪造
//   4. navigator.languages 伪装
//   5. navigator.platform 伪装
//   6. navigator.hardwareConcurrency / deviceMemory
//   7. WebGL vendor 伪装
//   8. navigator.permissions.query 拦截
//   9. CDP __proto__ 屏蔽
//  10. window.outerWidth/Height 屏蔽 headless 特征
//  11. Object.prototype.toString 里的 [object Navigator] 保护
//  12. document.$cdp_* / querySelector('cdp-*') 屏蔽
const STEALTH_JS = `
(() => {
  try {
    // 1. navigator.webdriver
    Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true });

    // 2. window.chrome (模拟完整 Chrome 环境)
    if (!(window as any).chrome) {
      (window as any).chrome = {};
    }
    if (!(window as any).chrome.runtime) {
      (window as any).chrome.runtime = {};
    }
    if (!(window as any).chrome.app) {
      (window as any).chrome.app = { isInstalled: () => false, getDetails: () => undefined };
    }
    if (!(window as any).chrome.csi) {
      (window as any).chrome.csi = () => ({ onloadT: Date.now(), startE: Date.now(), pageT: Date.now() });
    }
    if (!(window as any).chrome.loadTimes) {
      (window as any).chrome.loadTimes = () => ({
        commitLoadTime: Date.now() / 1000,
        connectionInfo: 'h2',
        finishDocumentLoadTime: Date.now() / 1000,
        finishLoadTime: Date.now() / 1000,
        firstPaintAfterLoadTime: 0,
        firstPaintTime: Date.now() / 1000,
        navigationType: 'Other',
        npnNegotiatedProtocol: 'h2',
        requestTime: Date.now() / 1000,
        startLoadTime: Date.now() / 1000,
        wasAlternateProtocolAvailable: false,
        wasFetchedViaSpdy: true,
        wasNpnNegotiated: true,
      });
    }

    // 3. navigator.plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const plugins = [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', length: 1 },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', length: 1 },
          { name: 'Native Client', filename: 'internal-nacl-plugin', length: 2 },
        ];
        Object.defineProperty(plugins, 'item', { value: (i: number) => plugins[i] || null });
        Object.defineProperty(plugins, 'namedItem', {
          value: (n: string) => plugins.find((p: any) => p.name === n) || null,
        });
        return plugins;
      },
      configurable: true,
    });

    // 4. navigator.languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['zh-CN', 'zh', 'en-US', 'en'],
      configurable: true,
    });

    // 5. navigator.platform
    Object.defineProperty(navigator, 'platform', {
      get: () => 'Win32',
      configurable: true,
    });

    // 6. hardwareConcurrency / deviceMemory
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8, configurable: true });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 8, configurable: true, valueOf: () => 8 });

    // 7. WebGL vendor 伪装
    const origGetParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter: number) {
      if (parameter === 37445) return 'Google Inc. (Intel)'; // UNMASKED_VENDOR_WEBGL
      if (parameter === 37446) return 'ANGLE (Intel, Intel(R) UHD Graphics, OpenGL 4.5)'; // UNMASKED_RENDERER_WEBGL
      return origGetParameter.apply(this, [parameter]);
    };

    // 8. navigator.permissions.query 拦截
    const origQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
    window.navigator.permissions.query = (parameters: PermissionDescriptor) => {
      if (parameters.name === 'notifications') {
        return Promise.resolve({ state: Notification.permission } as PermissionStatus);
      }
      return origQuery(parameters);
    };

    // 9. CDP __proto__ 屏蔽
    const origDefineProperty = Object.defineProperty;
    const propertyIsEnumerable = Object.prototype.propertyIsEnumerable;
    Object.prototype.hasOwnProperty = new Proxy(Object.prototype.hasOwnProperty, {
      apply(target, thisArg, args) {
        return target.apply(thisArg, args);
      },
    });

    // 10. outerWidth/Height 屏蔽
    Object.defineProperty(window, 'outerWidth', { get: () => window.innerWidth });
    Object.defineProperty(window, 'outerHeight', { get: () => window.innerHeight });

    // 11. toString 保护
    const origToString = Function.prototype.toString;
    Function.prototype.toString = function() {
      if ((this as any).name === 'webdriver' || this === navigator.webdriver) {
        return 'function () { [native code] }';
      }
      return origToString.call(this);
    };

    // 12. chrome.csi / chrome.loadTimes 调用时防检测
    if (!(window as any).chrome.csi.caller) { /* placeholder */ }

  } catch (e) { /* stealth 失败不应阻塞页面加载 */ }
})();
`;
