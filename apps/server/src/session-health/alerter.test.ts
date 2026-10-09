import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HealthAlerter } from './alerter.js';
import type { AlertInfo } from './alerter.js';

/**
 * Tests for HealthAlerter.createAlert pure logic:
 * - Platform name mapping (PLATFORM_NAMES lookup + fallback)
 * - Message formatting ([platformName] message)
 * - Default userId handling
 *
 * DB-dependent methods are tested with a mock database.
 */

function createMockDb() {
  return {
    credentials: {
      insertHealthAlert: vi.fn((
        _platform: string,
        _alertType: string,
        _message: string,
        _userId: string,
      ) => 42),
      getUnsentAlerts: vi.fn(() => []),
      markAlertSent: vi.fn(() => true),
    },
  };
}

describe('HealthAlerter.createAlert', () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let alerter: HealthAlerter;

  beforeEach(() => {
    mockDb = createMockDb();
    alerter = new HealthAlerter(mockDb as any);
    vi.clearAllMocks();
  });

  it('已知平台映射为中文显示名（zhihu -> 知乎）', () => {
    const info: AlertInfo = {
      platform: 'zhihu',
      alertType: 'session_expired',
      message: '登录态已过期',
    };
    alerter.createAlert(info);
    const callArgs = mockDb.credentials.insertHealthAlert.mock.calls[0];
    const formattedMessage = callArgs[2] as string;
    expect(formattedMessage).toContain('[知乎]');
    expect(formattedMessage).toContain('登录态已过期');
  });

  it('多个已知平台名都能正确映射', () => {
    const cases: Array<{ platform: string; expectedName: string }> = [
      { platform: 'weixin', expectedName: '微信公众号' },
      { platform: 'baijia', expectedName: '百家号' },
      { platform: 'toutiao', expectedName: '今日头条' },
      { platform: 'csdn', expectedName: 'CSDN' },
      { platform: 'juejin', expectedName: '掘金' },
      { platform: 'bilibili', expectedName: '哔哩哔哩' },
      { platform: 'sohu', expectedName: '搜狐号' },
      { platform: 'netease', expectedName: '网易号' },
      { platform: 'zhidao', expectedName: '百度知道' },
    ];

    for (const { platform, expectedName } of cases) {
      mockDb.credentials.insertHealthAlert.mockClear();
      alerter.createAlert({
        platform,
        alertType: 'session_expired',
        message: 'test message',
      });
      const callArgs = mockDb.credentials.insertHealthAlert.mock.calls[0];
      const formattedMessage = callArgs[2] as string;
      expect(formattedMessage).toContain(`[${expectedName}]`);
    }
  });

  it('未知平台使用原始平台名作为降级', () => {
    const info: AlertInfo = {
      platform: 'mystery-platform',
      alertType: 'session_expired',
      message: 'test',
    };
    alerter.createAlert(info);
    const callArgs = mockDb.credentials.insertHealthAlert.mock.calls[0];
    const formattedMessage = callArgs[2] as string;
    expect(formattedMessage).toContain('[mystery-platform]');
  });

  it('空字符串平台名也能正常格式化', () => {
    const info: AlertInfo = {
      platform: '',
      alertType: 'session_expired',
      message: 'test',
    };
    alerter.createAlert(info);
    const callArgs = mockDb.credentials.insertHealthAlert.mock.calls[0];
    const formattedMessage = callArgs[2] as string;
    expect(formattedMessage).toBe('[] test');
  });

  it('消息格式为 [平台名] 消息内容', () => {
    const info: AlertInfo = {
      platform: 'zhihu',
      alertType: 'session_expired',
      message: '登录态已过期，请重新登录',
    };
    alerter.createAlert(info);
    const callArgs = mockDb.credentials.insertHealthAlert.mock.calls[0];
    expect(callArgs[2]).toBe('[知乎] 登录态已过期，请重新登录');
  });

  it('提供 userId 时使用提供的值', () => {
    const info: AlertInfo = {
      platform: 'zhihu',
      alertType: 'session_expired',
      message: 'test',
      userId: 'user_12345',
    };
    alerter.createAlert(info);
    const callArgs = mockDb.credentials.insertHealthAlert.mock.calls[0];
    expect(callArgs[3]).toBe('user_12345');
  });

  it('未提供 userId 时使用默认值 user_default', () => {
    const info: AlertInfo = {
      platform: 'zhihu',
      alertType: 'session_expired',
      message: 'test',
    };
    alerter.createAlert(info);
    const callArgs = mockDb.credentials.insertHealthAlert.mock.calls[0];
    expect(callArgs[3]).toBe('user_default');
  });

  it('所有 alertType 都能正确传递给数据库', () => {
    const alertTypes: AlertInfo['alertType'][] = [
      'session_expired',
      'consecutive_failures',
      'session_recovered',
      'relogin_success',
      'relogin_captcha',
      'relogin_failed',
    ];

    for (const alertType of alertTypes) {
      mockDb.credentials.insertHealthAlert.mockClear();
      alerter.createAlert({
        platform: 'zhihu',
        alertType,
        message: 'test',
      });
      const callArgs = mockDb.credentials.insertHealthAlert.mock.calls[0];
      expect(callArgs[1]).toBe(alertType);
    }
  });

  it('返回 insertHealthAlert 的返回值（告警 ID）', () => {
    mockDb.credentials.insertHealthAlert.mockReturnValue(99);
    const result = alerter.createAlert({
      platform: 'zhihu',
      alertType: 'session_expired',
      message: 'test',
    });
    expect(result).toBe(99);
  });

  it('空消息内容也能正确格式化', () => {
    const info: AlertInfo = {
      platform: 'zhihu',
      alertType: 'session_expired',
      message: '',
    };
    alerter.createAlert(info);
    const callArgs = mockDb.credentials.insertHealthAlert.mock.calls[0];
    expect(callArgs[2]).toBe('[知乎] ');
  });

  it('platform 参数原样传递给 insertHealthAlert', () => {
    const info: AlertInfo = {
      platform: 'zhihu',
      alertType: 'session_expired',
      message: 'test',
    };
    alerter.createAlert(info);
    const callArgs = mockDb.credentials.insertHealthAlert.mock.calls[0];
    expect(callArgs[0]).toBe('zhihu');
  });
});
