import { FingerprintGenerator, type FingerprintGeneratorOptions, type BrowserFingerprintWithHeaders } from 'fingerprint-generator';
import { FingerprintInjector } from 'fingerprint-injector';
import type { Browser, BrowserContext, BrowserContextOptions } from 'playwright';

/**
 * 默认指纹生成选项：桌面端 + Windows + Chrome + 中文
 * 符合国内内容发布平台的主流用户特征
 */
const DEFAULT_FINGERPRINT_OPTIONS: Partial<FingerprintGeneratorOptions> = {
  devices: ['desktop'],
  operatingSystems: ['windows'],
  browsers: [{ name: 'chrome', minVersion: 120 }],
  locales: ['zh-CN'],
  screen: {
    minWidth: 1366,
    maxWidth: 1920,
    minHeight: 768,
    maxHeight: 1080,
  },
};

/**
 * 浏览器指纹管理器
 *
 * 负责生成、持久化和注入浏览器指纹。
 * 每个账号对应一个固定指纹，确保每次发布使用相同的浏览器身份，
 * 降低因"设备变更"触发的平台检测概率。
 *
 * 与 stealth 插件的关系：
 * - stealth 负责隐藏自动化特征（webdriver、plugins 等）
 * - fingerprint-suite 负责生成内部一致的真实浏览器指纹
 * - 两者互补，同时使用效果叠加
 */
export class BrowserFingerprintManager {
  private generator: FingerprintGenerator;
  private injector: FingerprintInjector;
  private defaultOptions: Partial<FingerprintGeneratorOptions>;

  constructor(options?: Partial<FingerprintGeneratorOptions>) {
    this.defaultOptions = { ...DEFAULT_FINGERPRINT_OPTIONS, ...options };
    this.generator = new FingerprintGenerator(this.defaultOptions);
    this.injector = new FingerprintInjector();
  }

  /**
   * 生成新的浏览器指纹
   *
   * 首次使用账号时调用，生成的指纹应保存到凭证数据中，
   * 后续使用同一账号时直接加载，保证指纹一致。
   */
  generateFingerprint(
    options?: Partial<FingerprintGeneratorOptions>,
  ): BrowserFingerprintWithHeaders {
    return this.generator.getFingerprint(options);
  }

  /**
   * 从持久化数据中恢复指纹
   *
   * 从 JSON 字符串解析出完整指纹对象。
   * 指纹数据应从凭证的 fingerprintData 字段读取。
   */
  restoreFingerprint(fingerprintJson: string): BrowserFingerprintWithHeaders {
    return JSON.parse(fingerprintJson) as BrowserFingerprintWithHeaders;
  }

  /**
   * 将指纹序列化为 JSON 字符串以便持久化
   */
  serializeFingerprint(fingerprint: BrowserFingerprintWithHeaders): string {
    return JSON.stringify(fingerprint);
  }

  /**
   * 将指纹注入到已有的 Playwright BrowserContext
   *
   * 注意：userAgent 和 viewport 需要在 context 创建时设置，
   * 建议使用 createContextWithFingerprint() 一次性完成。
   */
  async injectFingerprint(
    context: BrowserContext,
    fingerprint: BrowserFingerprintWithHeaders,
  ): Promise<void> {
    await this.injector.attachFingerprintToPlaywright(context, fingerprint);
  }

  /**
   * 创建带指纹的 Playwright BrowserContext
   *
   * 自动处理 userAgent、viewport 和指纹注入，
   * 同时支持传入额外的 context 选项（如 storageState）。
   */
  async createContextWithFingerprint(
    browser: Browser,
    fingerprint: BrowserFingerprintWithHeaders,
    contextOptions: BrowserContextOptions = {},
  ): Promise<BrowserContext> {
    const { fingerprint: fp } = fingerprint;

    // 从指纹中提取 viewport 和 userAgent
    const viewport = {
      width: fp.screen.width,
      height: fp.screen.height,
    };
    const userAgent = fp.navigator.userAgent;

    // 创建 context 时设置 UA 和 viewport（Playwright 不支持事后修改）
    const context = await browser.newContext({
      ...contextOptions,
      userAgent,
      viewport,
      deviceScaleFactor: fp.screen.devicePixelRatio,
    });

    // 注入完整指纹（navigator、screen、WebGL 等）
    await this.injectFingerprint(context, fingerprint);

    return context;
  }

  /**
   * 从凭证数据中解析指纹（如果存在）
   *
   * 优先从 fingerprintData 字段恢复，返回 null 表示没有持久化指纹。
   */
  resolveFingerprint(credentialData: Record<string, unknown>): BrowserFingerprintWithHeaders | null {
    const fpData = credentialData.fingerprintData;
    if (typeof fpData === 'string' && fpData) {
      try {
        return this.restoreFingerprint(fpData);
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * 便捷方法：获取或生成指纹
   *
   * 如果凭证中有持久化指纹则恢复，否则生成新指纹。
   * 返回 { fingerprint, isNew }，isNew 为 true 时调用方应保存新指纹。
   */
  getOrGenerateFingerprint(credentialData: Record<string, unknown>): {
    fingerprint: BrowserFingerprintWithHeaders;
    isNew: boolean;
  } {
    const existing = this.resolveFingerprint(credentialData);
    if (existing) {
      return { fingerprint: existing, isNew: false };
    }
    return { fingerprint: this.generateFingerprint(), isNew: true };
  }
}
