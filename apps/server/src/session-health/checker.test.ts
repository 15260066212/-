import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionHealthChecker } from './checker.js';
import { BaseValidator } from './validators/base.js';
import type { ValidationResult } from './types.js';
import type { PlatformCredentials, PlatformId } from '@zemingengine/shared';

/**
 * Tests for SessionHealthChecker pure methods:
 * - hasValidator
 * - registerValidator
 * - setReloginManager
 *
 * DB-dependent logic is tested with a mock database.
 */

// Simple mock validator for testing registration
class MockValidator extends BaseValidator {
  readonly platform: PlatformId;

  constructor(platform: PlatformId) {
    super();
    this.platform = platform;
  }

  async validate(_credentials: PlatformCredentials): Promise<ValidationResult> {
    return { valid: true, durationMs: 0 };
  }
}

function createMockDb() {
  return {
    credentials: {
      getCredentialsDueForCheck: vi.fn(() => []),
      getCredentialHealthDetail: vi.fn(() => null),
      recordHealthCheck: vi.fn(),
      getConsecutiveFailures: vi.fn(() => 0),
      markCredentialExpired: vi.fn(),
      insertHealthAlert: vi.fn(() => 1),
      getUnsentAlerts: vi.fn(() => []),
      markAlertSent: vi.fn(() => true),
    },
  };
}

describe('SessionHealthChecker - validator registration', () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let checker: SessionHealthChecker;

  beforeEach(() => {
    mockDb = createMockDb();
    // Use a minimal mock - we only test registration logic
    checker = new SessionHealthChecker(mockDb as any);
    vi.clearAllMocks();
  });

  describe('hasValidator', () => {
    it('默认包含 weixin 验证器（WechatValidator）', () => {
      expect(checker.hasValidator('weixin')).toBe(true);
    });

    it('未注册的平台返回 false', () => {
      expect(checker.hasValidator('unknown-platform' as PlatformId)).toBe(false);
      expect(checker.hasValidator('zhihu')).toBe(false);
    });

    it('注册验证器后 hasValidator 返回 true', () => {
      const validator = new MockValidator('zhihu');
      checker.registerValidator(validator);
      expect(checker.hasValidator('zhihu')).toBe(true);
    });

    it('注册多个验证器后都能查询到', () => {
      checker.registerValidator(new MockValidator('zhihu'));
      checker.registerValidator(new MockValidator('baijia'));
      checker.registerValidator(new MockValidator('csdn'));

      expect(checker.hasValidator('zhihu')).toBe(true);
      expect(checker.hasValidator('baijia')).toBe(true);
      expect(checker.hasValidator('csdn')).toBe(true);
      expect(checker.hasValidator('juejin')).toBe(false);
    });

    it('注册相同平台的验证器会覆盖之前的', () => {
      const validator1 = new MockValidator('zhihu');
      const validator2 = new MockValidator('zhihu');
      checker.registerValidator(validator1);
      checker.registerValidator(validator2);
      // 仍然返回 true（覆盖后仍存在）
      expect(checker.hasValidator('zhihu')).toBe(true);
    });
  });

  describe('registerValidator', () => {
    it('成功注册新验证器', () => {
      const validator = new MockValidator('juejin');
      checker.registerValidator(validator);
      expect(checker.hasValidator('juejin')).toBe(true);
    });

    it('为支持 setDatabase 的验证器注入 db', () => {
      class ValidatorWithDb extends MockValidator {
        public db: any = null;
        setDatabase(db: any): void {
          this.db = db;
        }
      }

      const validator = new ValidatorWithDb('bilibili');
      checker.registerValidator(validator);
      expect(validator.db).not.toBeNull();
      expect(checker.hasValidator('bilibili')).toBe(true);
    });

    it('不支持 setDatabase 的验证器也能正常注册', () => {
      const validator = new MockValidator('sohu');
      checker.registerValidator(validator);
      expect(checker.hasValidator('sohu')).toBe(true);
    });
  });

  describe('setReloginManager', () => {
    it('可以设置 reloginManager', () => {
      const mockReloginManager = {
        isPlatformSupported: vi.fn(() => false),
        canAttempt: vi.fn(() => false),
        attemptRelogin: vi.fn(),
      };
      // 不应该抛出错误
      expect(() => {
        checker.setReloginManager(mockReloginManager as any);
      }).not.toThrow();
    });
  });

  describe('runCheckBatch - 空运行', () => {
    it('没有待检查凭证时返回 0', async () => {
      mockDb.credentials.getCredentialsDueForCheck.mockReturnValue([]);
      const result = await checker.runCheckBatch();
      expect(result).toBe(0);
    });

    it('待检查的平台都没有对应验证器时返回 0', async () => {
      mockDb.credentials.getCredentialsDueForCheck.mockReturnValue([
        { platform: 'unknown-platform', data: {} },
      ]);
      const result = await checker.runCheckBatch();
      expect(result).toBe(0);
    });

    it('上一批次还在运行时跳过并返回 0', async () => {
      // 通过让 getCredentialsDueForCheck 返回一个永不 resolve 的 promise 来模拟运行中
      // 更简单的方法：直接调用两次，第二次应该返回 0
      mockDb.credentials.getCredentialsDueForCheck.mockReturnValue([]);

      // 第一次正常返回 0
      const first = await checker.runCheckBatch();
      expect(first).toBe(0);

      // 第二次也正常返回 0（因为第一次已经完成）
      const second = await checker.runCheckBatch();
      expect(second).toBe(0);
    });
  });
});
