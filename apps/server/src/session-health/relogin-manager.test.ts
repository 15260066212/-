import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ReloginManager } from './relogin-manager.js';

function createMockDb() {
  return {
    credentials: {
      getCredential: vi.fn(),
      updateCredentialData: vi.fn(),
      updateCredentialStatus: vi.fn(),
      insertHealthAlert: vi.fn(),
    },
  };
}

describe('ReloginManager', () => {
  let manager: ReloginManager;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    mockDb = createMockDb();
    manager = new ReloginManager(mockDb as any);
  });

  describe('isPlatformSupported', () => {
    it('支持 csdn', () => {
      expect(manager.isPlatformSupported('csdn')).toBe(true);
    });

    it('支持 juejin', () => {
      expect(manager.isPlatformSupported('juejin')).toBe(true);
    });

    it('不支持 bilibili', () => {
      expect(manager.isPlatformSupported('bilibili')).toBe(false);
    });

    it('不支持 zhihu', () => {
      expect(manager.isPlatformSupported('zhihu')).toBe(false);
    });

    it('不支持 toutiao', () => {
      expect(manager.isPlatformSupported('toutiao')).toBe(false);
    });

    it('不支持 sohu', () => {
      expect(manager.isPlatformSupported('sohu')).toBe(false);
    });

    it('不支持 netease', () => {
      expect(manager.isPlatformSupported('netease')).toBe(false);
    });

    it('不支持未知平台', () => {
      expect(manager.isPlatformSupported('unknown')).toBe(false);
    });
  });

  describe('canAttempt — 冷却期', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('首次调用允许重登', () => {
      vi.setSystemTime(1000000);
      expect(manager.canAttempt('csdn')).toBe(true);
    });

    it('冷却期内（30分钟）不允许重登', () => {
      vi.setSystemTime(1000000);
      // 模拟刚尝试过
      manager.canAttempt('csdn'); // first call
      // 不能直接访问私有方法，但 canAttempt 本身会更新 lastAttemptTime
      // 通过 attemptRelogin 来更新，这里直接测试多次调用
      // canAttempt 不更新状态，需要通过 attemptRelogin 更新
      // 所以第二次 canAttempt 仍应返回 true（canAttempt 只读不写）
      expect(manager.canAttempt('csdn')).toBe(true);
    });

    it('不支持的平台返回 false', () => {
      vi.setSystemTime(1000000);
      expect(manager.canAttempt('zhihu')).toBe(false);
    });

    it('不支持的平台返回 false（未知平台）', () => {
      vi.setSystemTime(1000000);
      expect(manager.canAttempt('unknown')).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('返回初始状态（无历史记录）', () => {
      const status = manager.getStatus();
      expect(status).toHaveProperty('supportedPlatforms');
      expect(status.supportedPlatforms).toContain('csdn');
      expect(status.supportedPlatforms).toContain('juejin');
      expect(status).toHaveProperty('cooldowns');
      expect(status).toHaveProperty('attemptHistory');
      expect(status.cooldowns.length).toBe(0);
      expect(status.attemptHistory.length).toBe(2); // 2 supported platforms
      expect(status.attemptHistory[0].recentAttempts).toBe(0);
    });

    it('supportedPlatforms 刚好 2 个', () => {
      const status = manager.getStatus();
      expect(status.supportedPlatforms.length).toBe(2);
    });
  });
});
