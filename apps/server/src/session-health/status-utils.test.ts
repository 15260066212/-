import { describe, it, expect } from 'vitest';
import {
  shouldMarkExpired,
  getTransitionAlert,
  computeFinalStatus,
} from './status-utils.js';
import { MAX_CONSECUTIVE_FAILURES } from './types.js';

/**
 * Tests for pure utility functions extracted from SessionHealthChecker.
 * These have no side effects and can be tested without any mocks.
 */

describe('shouldMarkExpired', () => {
  it('连续失败次数达到阈值时返回 true', () => {
    expect(shouldMarkExpired(MAX_CONSECUTIVE_FAILURES)).toBe(true, 'should have correct shouldMarkExpired(MAX_CONSECUTIVE_FAILURES) when 连续失败次数达到阈值时返回 true');
  });

  it('连续失败次数超过阈值时返回 true', () => {
    expect(shouldMarkExpired(MAX_CONSECUTIVE_FAILURES + 1)).toBe(true, 'should have correct shouldMarkExpired(MAX_CONSECUTIVE_FAILURES + 1) when 连续失败次数超过阈值时返回 true');
    expect(shouldMarkExpired(10)).toBe(true, 'should have correct shouldMarkExpired(10) when 连续失败次数超过阈值时返回 true');
  });

  it('连续失败次数低于阈值时返回 false', () => {
    expect(shouldMarkExpired(0)).toBe(false, 'should have correct shouldMarkExpired(0) when 连续失败次数低于阈值时返回 false');
    expect(shouldMarkExpired(1)).toBe(false, 'should have correct shouldMarkExpired(1) when 连续失败次数低于阈值时返回 false');
    expect(shouldMarkExpired(MAX_CONSECUTIVE_FAILURES - 1)).toBe(false, 'should have correct shouldMarkExpired(MAX_CONSECUTIVE_FAILURES - 1) when 连续失败次数低于阈值时返回 false');
  });

  it('支持自定义最大失败次数', () => {
    expect(shouldMarkExpired(2, 5)).toBe(false, 'should have correct shouldMarkExpired(2, 5) when 支持自定义最大失败次数');
    expect(shouldMarkExpired(5, 5)).toBe(true, 'should have correct shouldMarkExpired(5, 5) when 支持自定义最大失败次数');
    expect(shouldMarkExpired(6, 5)).toBe(true, 'should have correct shouldMarkExpired(6, 5) when 支持自定义最大失败次数');
  });

  it('边界情况：0 次失败时返回 false', () => {
    expect(shouldMarkExpired(0)).toBe(false, 'should have correct shouldMarkExpired(0) when 边界情况：0 次失败时返回 false');
  });
});

describe('getTransitionAlert', () => {
  describe('恢复告警 (session_recovered)', () => {
    it('之前是 expired，现在变为 valid 时触发恢复告警', () => {
      const result = getTransitionAlert('expired', 'valid', 0, undefined);
      expect(result.shouldAlert).toBe(true, 'should have correct shouldAlert when 之前是 expired，现在变为 valid 时触发恢复告警');
      expect(result.alertType).toBe('session_recovered', 'should have correct alertType when 之前是 expired，现在变为 valid 时触发恢复告警');
      expect(result.message).toBe('登录态已恢复正常');
    });

    it('之前是 valid，现在仍是 valid 时不触发告警', () => {
      const result = getTransitionAlert('valid', 'valid', 0, undefined);
      expect(result.shouldAlert).toBe(false);
    });

    it('之前是 undefined（首次检查），现在是 valid 时不触发告警', () => {
      const result = getTransitionAlert(undefined, 'valid', 0, undefined);
      expect(result.shouldAlert).toBe(false);
    });
  });

  describe('过期告警 (session_expired)', () => {
    it('达到连续失败阈值且之前未过期时触发过期告警', () => {
      const result = getTransitionAlert(
        'valid',
        'error',
        MAX_CONSECUTIVE_FAILURES,
        '验证失败',
      );
      expect(result.shouldAlert).toBe(true);
      expect(result.alertType).toBe('session_expired');
      expect(result.message).toContain(`连续 ${MAX_CONSECUTIVE_FAILURES} 次检查失败`);
      expect(result.message).toContain('验证失败');
    });

    it('超过连续失败阈值但之前已经是 expired 时不重复触发', () => {
      const result = getTransitionAlert(
        'expired',
        'error',
        MAX_CONSECUTIVE_FAILURES + 1,
        '验证失败',
      );
      expect(result.shouldAlert).toBe(false);
    });

    it('错误消息为空时使用默认文本', () => {
      const result = getTransitionAlert(
        'valid',
        'error',
        MAX_CONSECUTIVE_FAILURES,
        undefined,
      );
      expect(result.shouldAlert).toBe(true);
      expect(result.message).toContain('未知错误');
    });
  });

  describe('首次失败告警 (consecutive_failures)', () => {
    it('第一次失败且之前未过期时触发连续失败告警', () => {
      const result = getTransitionAlert('valid', 'error', 1, '登录失败');
      expect(result.shouldAlert).toBe(true);
      expect(result.alertType).toBe('consecutive_failures');
      expect(result.message).toContain('健康检查失败');
      expect(result.message).toContain('登录失败');
    });

    it('第一次失败但之前已经是 expired 时不触发', () => {
      // 注意：如果已经 expired，连续失败计数不会是 1
      // 但防御性测试：逻辑上不应触发
      const result = getTransitionAlert('expired', 'error', 1, '登录失败');
      expect(result.shouldAlert).toBe(false);
    });

    it('第二次失败时不触发首次失败告警', () => {
      const result = getTransitionAlert('valid', 'error', 2, '登录失败');
      // 第二次失败，既不是首次失败，也没达到过期阈值
      expect(result.shouldAlert).toBe(false);
    });
  });

  describe('无告警情况', () => {
    it('检查成功且之前状态正常时不触发告警', () => {
      const result = getTransitionAlert('valid', 'valid', 0, undefined);
      expect(result.shouldAlert).toBe(false);
    });

    it('中间次数的失败（非首次、未达阈值）不触发告警', () => {
      const result = getTransitionAlert('valid', 'error', 2, '失败');
      expect(result.shouldAlert).toBe(false);
    });
  });

  describe('自定义最大失败次数', () => {
    it('使用自定义阈值判断过期', () => {
      const result = getTransitionAlert('valid', 'error', 5, '失败', undefined, 5);
      expect(result.shouldAlert).toBe(true);
      expect(result.alertType).toBe('session_expired');
    });

    it('自定义阈值下首次失败仍触发告警', () => {
      const result = getTransitionAlert('valid', 'error', 1, '失败', undefined, 10);
      expect(result.shouldAlert).toBe(true);
      expect(result.alertType).toBe('consecutive_failures');
    });
  });
});

describe('computeFinalStatus', () => {
  it('验证成功时状态保持 valid', () => {
    expect(computeFinalStatus('valid', 0)).toBe('valid');
    expect(computeFinalStatus('valid', 5)).toBe('valid');
  });

  it('失败但未达阈值时状态为 error', () => {
    expect(computeFinalStatus('error', 1)).toBe('error');
    expect(computeFinalStatus('error', MAX_CONSECUTIVE_FAILURES - 1)).toBe('error');
  });

  it('失败达到阈值时状态升级为 expired', () => {
    expect(computeFinalStatus('error', MAX_CONSECUTIVE_FAILURES)).toBe('expired');
    expect(computeFinalStatus('error', MAX_CONSECUTIVE_FAILURES + 1)).toBe('expired');
  });

  it('支持自定义最大失败次数', () => {
    expect(computeFinalStatus('error', 3, 5)).toBe('error');
    expect(computeFinalStatus('error', 5, 5)).toBe('expired');
  });

  it('checking 状态不被升级为 expired', () => {
    // checking 是中间状态，不应该被升级
    expect(computeFinalStatus('checking', 10)).toBe('checking');
  });
});
