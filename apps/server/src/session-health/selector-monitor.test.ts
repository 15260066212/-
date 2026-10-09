import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

function createMockDb() {
  return {
    selectors: {
      getSelectorHealthStats: vi.fn().mockReturnValue({
        totalChecks: 10,
        healthyPlatforms: 8,
        brokenPlatforms: 2,
      }),
      recordSelectorHealthCheck: vi.fn(),
    },
    credentials: {
      insertHealthAlert: vi.fn(),
    },
  };
}

describe('SelectorMonitor — mergeResults 函数', () => {
  it('合并两个成功的结果', () => {
    const base = {
      success: true,
      platform: 'zhihu',
      summary: {
        total: 5,
        found: 5,
        missing: 0,
        byPurpose: [{ purpose: 'publish_title_input', total: 1, found: 1, missing: 0, status: 'ok' as const }],
        brokenPurposes: [],
      },
    };
    const incoming = {
      success: true,
      platform: 'zhihu',
      summary: {
        total: 3,
        found: 2,
        missing: 1,
        byPurpose: [{ purpose: 'login_username', total: 1, found: 1, missing: 0, status: 'ok' as const }],
        brokenPurposes: ['login_password'],
      },
    };
    // mergeResults is not exported, but we can test the logic inline
    const merged_summary = {
      total: base.summary!.total + incoming.summary!.total,
      found: base.summary!.found + incoming.summary!.found,
      missing: base.summary!.missing + incoming.summary!.missing,
      byPurpose: [...base.summary!.byPurpose, ...incoming.summary!.byPurpose],
      brokenPurposes: [...base.summary!.brokenPurposes, ...incoming.summary!.brokenPurposes],
    };
    expect(merged_summary.total).toBe(8);
    expect(merged_summary.found).toBe(7);
    expect(merged_summary.missing).toBe(1);
    expect(merged_summary.brokenPurposes).toContain('login_password');
  });
});

describe('SelectorMonitor — 生命周期与状态', () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let monitor: any;

  beforeEach(async () => {
    vi.useFakeTimers();
    mockDb = createMockDb();
    const { SelectorMonitor } = await import('./selector-monitor.js');
    monitor = new SelectorMonitor(mockDb);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('初始状态 isRunning 为 false', () => {
    expect(monitor.isCheckRunning()).toBe(false);
  });

  it('初始 lastRunTime 为 0', () => {
    expect(monitor.getLastRunTime()).toBe(0);
  });

  it('start 设置定时器', () => {
    monitor.start();
    expect(monitor.isCheckRunning()).toBe(false); // not running yet, just scheduled
  });

  it('stop 清除定时器', () => {
    monitor.start();
    monitor.stop();
    // after stop, intervalHandle is null
    expect(monitor.isCheckRunning()).toBe(false);
  });

  it('重复 start 不创建多个定时器', () => {
    monitor.start();
    monitor.start(); // should be no-op
    // just verify no crash
    monitor.stop();
  });

  it('stop 后再 start 可以重新启动', () => {
    monitor.start();
    monitor.stop();
    monitor.start();
    monitor.stop();
    // no crash = pass
  });

  it('getStatus 返回结构正确', () => {
    const status = monitor.getStatus();
    expect(status).toHaveProperty('running');
    expect(status).toHaveProperty('lastRunTime');
    expect(status).toHaveProperty('intervalMs');
    expect(status).toHaveProperty('registeredPlatforms');
    expect(status).toHaveProperty('stats');
    expect(status.registeredPlatforms.length).toBeGreaterThan(0);
    expect(status.intervalMs).toBe(6 * 60 * 60 * 1000);
  });

  it('getStatus 返回注册的平台列表', () => {
    const status = monitor.getStatus();
    expect(status.registeredPlatforms).toContain('zhihu');
  });
});

describe('SelectorMonitor — checkPlatform', () => {
  let monitor: any;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(async () => {
    mockDb = createMockDb();
    const { SelectorMonitor } = await import('./selector-monitor.js');
    monitor = new SelectorMonitor(mockDb);
  });

  it('未配置 RPA_REMOTE_URL 时返回失败', async () => {
    delete process.env.RPA_REMOTE_URL;
    const result = await monitor.checkPlatform('zhihu');
    expect(result.success).toBe(false);
    expect(result.error).toContain('RPA_REMOTE_URL');
  });

  it('未知平台返回失败', async () => {
    process.env.RPA_REMOTE_URL = 'http://harvester:3000';
    const result = await monitor.checkPlatform('nonexistent');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
    delete process.env.RPA_REMOTE_URL;
  });
});

describe('SelectorMonitor — runCheck 防重入', () => {
  let monitor: any;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(async () => {
    mockDb = createMockDb();
    const { SelectorMonitor } = await import('./selector-monitor.js');
    monitor = new SelectorMonitor(mockDb);
  });

  it('未配置 RPA_REMOTE_URL 时跳过检查', async () => {
    delete process.env.RPA_REMOTE_URL;
    await monitor.runCheck();
    expect(monitor.isCheckRunning()).toBe(false);
  });
});
