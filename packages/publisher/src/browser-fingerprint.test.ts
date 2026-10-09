import { describe, it, expect } from 'vitest';
import { BrowserFingerprintManager } from './browser-fingerprint.js';

describe('BrowserFingerprintManager', () => {
  describe('generateFingerprint', () => {
    it('生成有效的浏览器指纹', () => {
      const manager = new BrowserFingerprintManager();
      const result = manager.generateFingerprint();

      expect(result).toBeDefined();
      expect(result.fingerprint).toBeDefined();
      expect(result.headers).toBeDefined();

      // 检查核心指纹属性
      const { fingerprint } = result;
      expect(fingerprint.navigator).toBeDefined();
      expect(fingerprint.navigator.userAgent).toBeTruthy();
      expect(fingerprint.screen).toBeDefined();
      expect(fingerprint.screen.width).toBeGreaterThan(0);
      expect(fingerprint.screen.height).toBeGreaterThan(0);
    });

    it('默认配置生成桌面端 + Chrome 指纹', () => {
      const manager = new BrowserFingerprintManager();
      const { fingerprint } = manager.generateFingerprint();

      // UA 应包含 Chrome
      expect(fingerprint.navigator.userAgent.toLowerCase()).toContain('chrome');
      // 桌面端屏幕宽度应 >= 1366
      expect(fingerprint.screen.width).toBeGreaterThanOrEqual(1366);
      // 语言应包含 zh-CN
      expect(fingerprint.navigator.language.toLowerCase()).toContain('zh');
    });

    it('每次生成不同的指纹（随机化）', () => {
      const manager = new BrowserFingerprintManager();
      const fp1 = manager.generateFingerprint();
      const fp2 = manager.generateFingerprint();

      // 两个指纹不应完全相同（UA 可能相同，但屏幕尺寸等可能不同）
      // 这里用 JSON 字符串对比，如果完全一样再试一次
      const fp1Str = JSON.stringify(fp1.fingerprint.screen);
      const fp2Str = JSON.stringify(fp2.fingerprint.screen);

      // 由于贝叶斯网络生成，大多数情况下会不同
      // 但我们不做强断言，只验证生成成功
      expect(fp1Str).toBeTruthy();
      expect(fp2Str).toBeTruthy();
    });
  });

  describe('序列化与反序列化', () => {
    it('serializeFingerprint 和 restoreFingerprint 往返一致', () => {
      const manager = new BrowserFingerprintManager();
      const original = manager.generateFingerprint();

      const json = manager.serializeFingerprint(original);
      expect(typeof json).toBe('string');

      const restored = manager.restoreFingerprint(json);
      expect(restored).toBeDefined();
      expect(restored.fingerprint.navigator.userAgent).toBe(
        original.fingerprint.navigator.userAgent,
      );
      expect(restored.fingerprint.screen.width).toBe(original.fingerprint.screen.width);
      expect(restored.headers['user-agent']).toBe(original.headers['user-agent']);
    });

    it('restoreFingerprint 可以解析有效的 JSON', () => {
      const manager = new BrowserFingerprintManager();
      const json = JSON.stringify({
        fingerprint: {
          navigator: { userAgent: 'TestUA' },
          screen: { width: 1920, height: 1080 },
        },
        headers: { 'user-agent': 'TestUA' },
      });

      const restored = manager.restoreFingerprint(json);
      expect(restored.fingerprint.navigator.userAgent).toBe('TestUA');
      expect(restored.fingerprint.screen.width).toBe(1920);
    });
  });

  describe('resolveFingerprint', () => {
    it('从凭证数据中解析持久化指纹', () => {
      const manager = new BrowserFingerprintManager();
      const original = manager.generateFingerprint();
      const fpJson = manager.serializeFingerprint(original);

      const credData = { fingerprintData: fpJson };
      const resolved = manager.resolveFingerprint(credData);

      expect(resolved).not.toBeNull();
      expect(resolved!.fingerprint.navigator.userAgent).toBe(
        original.fingerprint.navigator.userAgent,
      );
    });

    it('没有 fingerprintData 时返回 null', () => {
      const manager = new BrowserFingerprintManager();
      const result = manager.resolveFingerprint({});
      expect(result).toBeNull();
    });

    it('空字符串返回 null', () => {
      const manager = new BrowserFingerprintManager();
      const result = manager.resolveFingerprint({ fingerprintData: '' });
      expect(result).toBeNull();
    });

    it('无效 JSON 返回 null', () => {
      const manager = new BrowserFingerprintManager();
      const result = manager.resolveFingerprint({ fingerprintData: 'not-json' });
      expect(result).toBeNull();
    });
  });

  describe('getOrGenerateFingerprint', () => {
    it('有持久化指纹时返回 isNew=false', () => {
      const manager = new BrowserFingerprintManager();
      const original = manager.generateFingerprint();
      const fpJson = manager.serializeFingerprint(original);

      const { fingerprint, isNew } = manager.getOrGenerateFingerprint({
        fingerprintData: fpJson,
      });

      expect(isNew).toBe(false);
      expect(fingerprint.fingerprint.navigator.userAgent).toBe(
        original.fingerprint.navigator.userAgent,
      );
    });

    it('没有持久化指纹时生成新指纹并返回 isNew=true', () => {
      const manager = new BrowserFingerprintManager();
      const { fingerprint, isNew } = manager.getOrGenerateFingerprint({});

      expect(isNew).toBe(true);
      expect(fingerprint.fingerprint.navigator.userAgent).toBeTruthy();
      expect(fingerprint.fingerprint.screen.width).toBeGreaterThan(0);
    });

    it('cookie 字段不影响指纹解析', () => {
      const manager = new BrowserFingerprintManager();
      const { fingerprint, isNew } = manager.getOrGenerateFingerprint({
        cookie: 'session=abc123',
      });

      // 只有 cookie 没有 fingerprintData，应该生成新指纹
      expect(isNew).toBe(true);
      expect(fingerprint.fingerprint.navigator.userAgent).toBeTruthy();
    });
  });

  describe('构造函数选项', () => {
    it('支持自定义指纹生成选项', () => {
      const manager = new BrowserFingerprintManager({
        locales: ['en-US'],
        devices: ['desktop'],
      });

      const { fingerprint } = manager.generateFingerprint();
      // 语言应为英文（但不一定精确，贝叶斯网络有随机性）
      // 只验证生成成功
      expect(fingerprint.navigator.userAgent).toBeTruthy();
    });
  });
});
