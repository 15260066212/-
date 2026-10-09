import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CHECK_INTERVAL_MS,
  CHECK_BATCH_SIZE,
  MAX_CONSECUTIVE_FAILURES,
} from './types.js';

describe('Session Health — 常量定义', () => {
  it('DEFAULT_CHECK_INTERVAL_MS 为 6 小时', () => {
    expect(DEFAULT_CHECK_INTERVAL_MS).toBe(6 * 60 * 60 * 1000);
    expect(DEFAULT_CHECK_INTERVAL_MS).toBe(21600000);
  });

  it('CHECK_BATCH_SIZE 为 3', () => {
    expect(CHECK_BATCH_SIZE).toBe(3);
  });

  it('MAX_CONSECUTIVE_FAILURES 为 3', () => {
    expect(MAX_CONSECUTIVE_FAILURES).toBe(3);
  });
});

import type { ValidationResult, Validator, HealthCheckStatus, HealthCheckLog } from './types.js';

describe('Session Health — 类型接口', () => {
  it('ValidationResult 结构正确', () => {
    const result: ValidationResult = {
      valid: true,
      durationMs: 100,
    };
    expect(result.valid).toBe(true);
    expect(result.durationMs).toBe(100);
  });

  it('ValidationResult 包含可选字段', () => {
    const result: ValidationResult = {
      valid: false,
      error: 'Session expired',
      evidence: {
        pageTitle: 'Login Page',
        finalUrl: 'https://example.com/login',
        screenshot: 'data:image/png;base64,abc',
      },
      durationMs: 50,
    };
    expect(result.error).toBe('Session expired');
    expect(result.evidence?.pageTitle).toBe('Login Page');
  });

  it('HealthCheckStatus 包含 5 种状态', () => {
    const statuses: HealthCheckStatus[] = ['valid', 'checking', 'expired', 'invalid', 'error'];
    expect(statuses.length).toBe(5);
    expect(statuses).toContain('valid');
    expect(statuses).toContain('checking');
    expect(statuses).toContain('expired');
    expect(statuses).toContain('invalid');
    expect(statuses).toContain('error');
  });

  it('HealthCheckLog 结构正确', () => {
    const log: HealthCheckLog = {
      platform: 'zhihu',
      userId: 'user1',
      status: 'valid',
      durationMs: 100,
      checkedAt: Date.now(),
    };
    expect(log.platform).toBe('zhihu');
    expect(log.status).toBe('valid');
  });
});
