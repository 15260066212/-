import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CookieWarmer } from './cookie-warmer.js';
import type { DatabaseAccess } from '../db.js';

function createMockDb(): DatabaseAccess {
  return {
    credentials: {
      getAllCredentials: vi.fn().mockReturnValue([]),
      getCredential: vi.fn(),
      updateCredentialData: vi.fn(),
      updateCredentialStatus: vi.fn(),
      recordHealthCheck: vi.fn(),
    },
  } as unknown as DatabaseAccess;
}

describe('CookieWarmer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('使用传入的 harvesterUrl', () => {
      const db = createMockDb();
      const warmer = new CookieWarmer(db, 'http://test-harvester:3003');
      const status = warmer.getStatus();
      expect(status.running).toBe(false);
      expect(status.lastRunAt).toBeNull();
      expect(status.lastResult).toBeNull();
      expect(status.platformStats).toEqual({});
    });

    it('未传入 harvesterUrl 时从环境变量读取', () => {
      const db = createMockDb();
      const original = process.env.RPA_REMOTE_URL;
      process.env.RPA_REMOTE_URL = 'http://env-harvester:3003';
      const warmer = new CookieWarmer(db);
      // 不抛错即表示正常初始化
      expect(warmer.getStatus().running).toBe(false);
      if (original === undefined) delete process.env.RPA_REMOTE_URL;
      else process.env.RPA_REMOTE_URL = original;
    });
  });

  describe('getStatus', () => {
    it('初始状态正确', () => {
      const db = createMockDb();
      const warmer = new CookieWarmer(db, 'http://test:3003');
      const status = warmer.getStatus();
      expect(status).toMatchObject({
        running: false,
        lastRunAt: null,
        lastResult: null,
        platformStats: {},
      });
      expect(typeof status.adaptiveIntervalMs).toBe('number');
      expect(status.adaptiveIntervalMs).toBeGreaterThan(0);
    });
  });

  describe('start / stop', () => {
    it('harvesterUrl 为空时不启动', () => {
      const db = createMockDb();
      const warmer = new CookieWarmer(db, '');
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      warmer.start();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('RPA_REMOTE_URL not set'),
      );
      consoleSpy.mockRestore();
    });

    it('stop 在未启动时不报错', () => {
      const db = createMockDb();
      const warmer = new CookieWarmer(db, 'http://test:3003');
      expect(() => warmer.stop()).not.toThrow();
    });

    it('重复调用 start 输出警告', () => {
      const db = createMockDb();
      const warmer = new CookieWarmer(db, 'http://test:3003');
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      warmer.start();
      warmer.start();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Already running'),
      );
      warmer.stop();
      consoleSpy.mockRestore();
    });
  });

  describe('warmForPublish', () => {
    it('harvesterUrl 为空时返回 null', async () => {
      const db = createMockDb();
      const warmer = new CookieWarmer(db, '');
      const result = await warmer.warmForPublish('weixin', 'test-account');
      expect(result).toBeNull();
    });

    it('凭证不存在时返回 null', async () => {
      const db = createMockDb();
      (db.credentials.getCredential as ReturnType<typeof vi.fn>).mockReturnValue(null);
      const warmer = new CookieWarmer(db, 'http://test:3003');
      const result = await warmer.warmForPublish('weixin', 'nonexistent');
      expect(result).toBeNull();
      expect(db.credentials.getCredential).toHaveBeenCalledWith(
        'weixin',
        'user_default',
        'nonexistent',
      );
    });
  });

  describe('adaptive interval', () => {
    it('无失败时使用默认间隔', () => {
      const db = createMockDb();
      const warmer = new CookieWarmer(db, 'http://test:3003');
      const status = warmer.getStatus();
      // 默认间隔应该 >= 最小间隔
      expect(status.adaptiveIntervalMs).toBeGreaterThanOrEqual(30 * 60 * 1000);
    });
  });
});

// --- Backward-compatible functional API tests ---
describe('CookieWarmer functional API (singleton wrappers)', () => {
  it('getCookieWarmerStatus 在未初始化时返回默认状态', async () => {
    // 动态导入以确保单例状态干净
    const { getCookieWarmerStatus } = await import('./cookie-warmer.js');
    const status = getCookieWarmerStatus();
    expect(status.running).toBe(false);
    expect(status.lastRunAt).toBeNull();
    expect(status.lastResult).toBeNull();
    expect(status.platformStats).toEqual({});
  });

  it('stopCookieWarmer 在未初始化时不报错', async () => {
    const { stopCookieWarmer } = await import('./cookie-warmer.js');
    expect(() => stopCookieWarmer()).not.toThrow();
  });
});
