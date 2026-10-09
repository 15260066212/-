import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BaseValidator } from './base.js';

class TestValidator extends BaseValidator {
  readonly platform = 'test' as any;

  async validate(_credentials: any): Promise<any> {
    return { valid: true, durationMs: 0 };
  }

  async runMeasure(fn: () => Promise<any>) {
    return this.measure(fn);
  }
}

describe('BaseValidator — measure 方法', () => {
  let validator: TestValidator;

  beforeEach(() => {
    validator = new TestValidator();
  });

  it('返回 result 和 durationMs', async () => {
    const { result, durationMs } = await validator.runMeasure(async () => 42);
    expect(result).toBe(42);
    expect(durationMs).toBeGreaterThanOrEqual(0);
  });

  it('返回对象结果', async () => {
    const { result } = await validator.runMeasure(async () => ({ valid: true }));
    expect(result.valid).toBe(true);
  });

  it('durationMs 反映实际耗时', async () => {
    vi.useFakeTimers();
    const start = 1000;
    vi.setSystemTime(start);

    const promise = validator.runMeasure(async () => {
      vi.setSystemTime(start + 50); // advance 50ms
      return 'done';
    });

    const { result, durationMs } = await promise;
    expect(result).toBe('done');
    expect(durationMs).toBe(50);
    vi.useRealTimers();
  });

  it('异常也会被 measure 捕获 durationMs', async () => {
    vi.useFakeTimers();
    const start = 2000;
    vi.setSystemTime(start);

    const promise = validator.runMeasure(async () => {
      vi.setSystemTime(start + 30);
      throw new Error('test error');
    });

    await expect(promise).rejects.toThrow('test error');
    vi.useRealTimers();
  });

  it('platform 属性被子类设置', () => {
    expect(validator.platform).toBe('test');
  });

  it('validate 方法被子类实现', async () => {
    const result = await validator.validate({} as any);
    expect(result.valid).toBe(true);
  });
});

afterEach(() => {
  vi.useRealTimers();
});
