import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CaptchaManager } from './session-health/captcha-manager.js';
import type { CaptchaType, CaptchaSource } from './session-health/captcha-manager.js';

/**
 * Tests for CaptchaManager pure logic functions.
 * DB-dependent methods are tested with a mock database.
 */

function createMockDb() {
  const captchaEvents: Array<{
    id: number;
    platform: string;
    captchaType: CaptchaType;
    source: CaptchaSource;
    status: string;
    createdAt: number;
    resolvedBy?: string;
  }> = [];
  let nextId = 1;

  return {
    selectors: {
      recordCaptchaEvent: vi.fn((platform: string, captchaType: CaptchaType, source: CaptchaSource) => {
        const id = nextId++;
        captchaEvents.push({
          id,
          platform,
          captchaType,
          source,
          status: 'pending',
          createdAt: Date.now(),
        });
        return id;
      }),
      resolveCaptchaEvent: vi.fn((eventId: number, resolvedBy: string) => {
        const event = captchaEvents.find((e) => e.id === eventId);
        if (event) {
          event.status = 'resolved';
          event.resolvedBy = resolvedBy;
          return true;
        }
        return false;
      }),
      getPendingCaptchaEvents: vi.fn((limit: number) => {
        return captchaEvents.filter((e) => e.status === 'pending').slice(0, limit);
      }),
      getCaptchaStats: vi.fn(() => ({
        total: captchaEvents.length,
        pending: captchaEvents.filter((e) => e.status === 'pending').length,
        resolved: captchaEvents.filter((e) => e.status === 'resolved').length,
      })),
      getCaptchaEvents: vi.fn((_limit: number, platform?: string, status?: string) => {
        return captchaEvents.filter((e) => {
          if (platform && e.platform !== platform) return false;
          if (status && e.status !== status) return false;
          return true;
        });
      }),
    },
    credentials: {
      insertHealthAlert: vi.fn(),
    },
    _captchaEvents: captchaEvents,
  };
}

describe('CaptchaManager', () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let manager: CaptchaManager;

  beforeEach(() => {
    mockDb = createMockDb();
    manager = new CaptchaManager(mockDb as any);
  });

  describe('getCaptchaSelectors', () => {
    it('为已知平台返回平台特定 + 通用选择器', () => {
      const selectors = manager.getCaptchaSelectors('zhihu');
      expect(selectors.length).toBeGreaterThan(0);
      // 应该包含平台特定选择器
      expect(selectors.some((s) => s.selector.includes('geetest'))).toBe(true);
      // 应该包含通用选择器（来自 GENERIC_CAPTCHA_SELECTORS）
      expect(selectors.some((s) => s.type === 'slider')).toBe(true);
    });

    it('为未知平台只返回通用选择器', () => {
      const selectors = manager.getCaptchaSelectors('unknown-platform');
      expect(selectors.length).toBeGreaterThan(0);
      // 所有返回的都应该是通用选择器类型
      const types = selectors.map((s) => s.type);
      expect(types.length).toBeGreaterThan(0);
    });

    it('每个选择器都有 selector 和 type 字段', () => {
      const selectors = manager.getCaptchaSelectors('csdn');
      const validTypes: CaptchaType[] = [
        'slider', 'geetest', 'image', 'text', 'behavioral', 'sms', 'qrcode', 'unknown',
      ];
      for (const s of selectors) {
        expect(typeof s.selector).toBe('string');
        expect(s.selector.length).toBeGreaterThan(0);
        expect(validTypes).toContain(s.type);
      }
    });

    it('支持所有主要发布平台', () => {
      const platforms = ['zhihu', 'baijia', 'toutiao', 'csdn', 'juejin', 'bilibili', 'sohu', 'netease', 'zhidao'];
      for (const p of platforms) {
        const selectors = manager.getCaptchaSelectors(p);
        expect(selectors.length).toBeGreaterThan(0);
      }
    });
  });

  describe('recordCaptcha', () => {
    it('记录验证码事件并返回事件 ID', () => {
      const eventId = manager.recordCaptcha('zhihu', 'geetest', 'publish', 'task-123');
      expect(eventId).toBeGreaterThan(0);
      expect(mockDb.selectors.recordCaptchaEvent).toHaveBeenCalledWith(
        'zhihu', 'geetest', 'publish', 'task-123', undefined, undefined, undefined,
      );
    });

    it('创建健康告警', () => {
      manager.recordCaptcha('baijia', 'slider', 'login');
      expect(mockDb.credentials.insertHealthAlert).toHaveBeenCalled();
      const callArgs = mockDb.credentials.insertHealthAlert.mock.calls[0];
      expect(callArgs[0]).toBe('baijia');
      expect(callArgs[1]).toBe('captcha_detected');
      expect(callArgs[2]).toContain('Captcha detected');
    });
  });

  describe('resolveCaptcha', () => {
    it('成功解析存在的验证码事件', () => {
      const eventId = manager.recordCaptcha('zhihu', 'geetest', 'publish');
      const result = manager.resolveCaptcha(eventId, 'manual');
      expect(result).toBe(true);
      expect(mockDb.selectors.resolveCaptchaEvent).toHaveBeenCalledWith(eventId, 'manual');
    });

    it('解析不存在的事件返回 false', () => {
      const result = manager.resolveCaptcha(9999, 'manual');
      expect(result).toBe(false);
    });
  });

  describe('canRetry', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('冷却期内不能重试', () => {
      const now = Date.now();
      vi.setSystemTime(now);
      // 刚刚发生的验证码，肯定在冷却期内
      expect(manager.canRetry('zhihu', now)).toBe(false);
    });

    it('冷却期后可以重试', () => {
      const now = Date.now();
      vi.setSystemTime(now);
      // 30 分钟前的验证码，应该已经过了冷却期
      const thirtyMinutesAgo = now - 30 * 60 * 1000;
      expect(manager.canRetry('zhihu', thirtyMinutesAgo)).toBe(true);
    });
  });

  describe('getStatus', () => {
    it('返回监控状态，包含配置信息', () => {
      const status = manager.getStatus();
      expect(status).toHaveProperty('total');
      expect(status).toHaveProperty('pending');
      expect(status).toHaveProperty('pendingEvents');
      expect(status).toHaveProperty('retryCooldownMs');
      expect(status).toHaveProperty('maxCaptchaPerDay');
      expect(status).toHaveProperty('monitoredPlatforms');
      expect(Array.isArray(status.monitoredPlatforms)).toBe(true);
      expect(status.monitoredPlatforms.length).toBeGreaterThan(0);
    });
  });
});
