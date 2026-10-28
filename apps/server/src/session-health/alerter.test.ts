import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { HealthAlerter } from './alerter.js';
import type { AlertInfo } from './alerter.js';
import { createTestDatabase } from '../test-helpers.js';

/**
 * Tests for HealthAlerter.
 *
 * Strategy:
 * - Use a real in-memory database to verify the final state of alerts.
 * - createAlert: verify alert records in DB (message formatting, platform, type, userId).
 * - sendPendingAlerts: mock fetch (external HTTP), verify DB state changes + return value.
 * - isConfigured: test environment variable behavior.
 */
describe('HealthAlerter.createAlert', () => {
  let dbAccess: ReturnType<typeof createTestDatabase>['dbAccess'];
  let alerter: HealthAlerter;

  beforeEach(() => {
    const { dbAccess: dba } = createTestDatabase();
    dbAccess = dba;
    alerter = new HealthAlerter(dbAccess as any);
  });

  function getLastAlert() {
    const alerts = dbAccess.credentials.getUnsentAlerts();
    return alerts[alerts.length - 1];
  }

  it('已知平台映射为中文显示名（zhihu -> 知乎）', () => {
    const info: AlertInfo = {
      platform: 'zhihu',
      alertType: 'session_expired',
      message: '登录态已过期',
    };
    alerter.createAlert(info);

    const alert = getLastAlert();
    expect(alert.message).toContain('[知乎]');
    expect(alert.message).toContain('登录态已过期');
    expect(alert.platform).toBe('zhihu');
    expect(alert.alertType).toBe('session_expired');
  });

  it('多个已知平台名都能正确映射', () => {
    const cases: Array<{ platform: string; expectedName: string }> = [
      { platform: 'weixin', expectedName: '微信公众号' },
      { platform: 'toutiao', expectedName: '今日头条' },
      { platform: 'csdn', expectedName: 'CSDN' },
      { platform: 'juejin', expectedName: '掘金' },
      { platform: 'sohu', expectedName: '搜狐号' },
      { platform: 'netease', expectedName: '网易号' },
    ];

    for (const { platform, expectedName } of cases) {
      alerter.createAlert({
        platform,
        alertType: 'session_expired',
        message: 'test message',
      });
      const alert = getLastAlert();
      expect(alert.message).toContain(`[${expectedName}]`);
    }
  });

  it('未知平台使用原始平台名作为降级', () => {
    const info: AlertInfo = {
      platform: 'mystery-platform',
      alertType: 'session_expired',
      message: 'test',
    };
    alerter.createAlert(info);

    const alert = getLastAlert();
    expect(alert.message).toContain('[mystery-platform]');
    expect(alert.platform).toBe('mystery-platform');
  });

  it('空字符串平台名也能正常格式化', () => {
    const info: AlertInfo = {
      platform: '',
      alertType: 'session_expired',
      message: 'test',
    };
    alerter.createAlert(info);

    const alert = getLastAlert();
    expect(alert.message).toBe('[] test');
  });

  it('消息格式为 [平台名] 消息内容', () => {
    const info: AlertInfo = {
      platform: 'zhihu',
      alertType: 'session_expired',
      message: '登录态已过期，请重新登录',
    };
    alerter.createAlert(info);

    const alert = getLastAlert();
    expect(alert.message).toBe('[知乎] 登录态已过期，请重新登录');
  });

  it('提供 userId 时使用提供的值', () => {
    const info: AlertInfo = {
      platform: 'zhihu',
      alertType: 'session_expired',
      message: 'test',
      userId: 'user_12345',
    };
    alerter.createAlert(info);

    const alert = getLastAlert();
    expect(alert.userId).toBe('user_12345');
  });

  it('未提供 userId 时使用默认值 user_default', () => {
    const info: AlertInfo = {
      platform: 'zhihu',
      alertType: 'session_expired',
      message: 'test',
    };
    alerter.createAlert(info);

    const alert = getLastAlert();
    expect(alert.userId).toBe('user_default');
  });

  it('所有 alertType 都能正确存入数据库', () => {
    const alertTypes: AlertInfo['alertType'][] = [
      'session_expired',
      'consecutive_failures',
      'session_recovered',
      'relogin_success',
      'relogin_captcha',
      'relogin_failed',
    ];

    for (const alertType of alertTypes) {
      alerter.createAlert({
        platform: 'zhihu',
        alertType,
        message: 'test',
      });
      const alert = getLastAlert();
      expect(alert.alertType).toBe(alertType);
    }
  });

  it('返回告警 ID（自增主键）', () => {
    const id1 = alerter.createAlert({
      platform: 'zhihu',
      alertType: 'session_expired',
      message: 'test 1',
    });
    const id2 = alerter.createAlert({
      platform: 'zhihu',
      alertType: 'session_expired',
      message: 'test 2',
    });
    expect(typeof id1).toBe('number');
    expect(id2).toBeGreaterThan(id1);
  });

  it('空消息内容也能正确格式化', () => {
    const info: AlertInfo = {
      platform: 'zhihu',
      alertType: 'session_expired',
      message: '',
    };
    alerter.createAlert(info);

    const alert = getLastAlert();
    expect(alert.message).toBe('[知乎] ');
  });

  it('platform 原样存入数据库', () => {
    const info: AlertInfo = {
      platform: 'zhihu',
      alertType: 'session_expired',
      message: 'test',
    };
    alerter.createAlert(info);

    const alert = getLastAlert();
    expect(alert.platform).toBe('zhihu');
  });

  it('创建多条告警后数据库中告警数量正确', () => {
    alerter.createAlert({ platform: 'zhihu', alertType: 'session_expired', message: 'a' });
    alerter.createAlert({ platform: 'weixin', alertType: 'session_expired', message: 'b' });
    alerter.createAlert({ platform: 'csdn', alertType: 'consecutive_failures', message: 'c' });

    const alerts = dbAccess.credentials.getUnsentAlerts();
    expect(alerts.length).toBe(3);

    const stats = dbAccess.credentials.getAlertStats();
    expect(stats.total).toBe(3);
    expect(stats.unsent).toBe(3);
    expect(stats.sent).toBe(0);
  });
});

describe('HealthAlerter.sendPendingAlerts', () => {
  let dbAccess: ReturnType<typeof createTestDatabase>['dbAccess'];
  let alerter: HealthAlerter;
  let originalWebhook: string | undefined;
  let originalWecom: string | undefined;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const { dbAccess: dba } = createTestDatabase();
    dbAccess = dba;
    alerter = new HealthAlerter(dbAccess as any);

    // Save original env vars
    originalWebhook = process.env.HEALTH_ALERT_WEBHOOK_URL;
    originalWecom = process.env.WECOM_BOT_WEBHOOK;
    delete process.env.HEALTH_ALERT_WEBHOOK_URL;
    delete process.env.WECOM_BOT_WEBHOOK;

    // Mock global fetch
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    // Restore env vars
    if (originalWebhook !== undefined) {
      process.env.HEALTH_ALERT_WEBHOOK_URL = originalWebhook;
    } else {
      delete process.env.HEALTH_ALERT_WEBHOOK_URL;
    }
    if (originalWecom !== undefined) {
      process.env.WECOM_BOT_WEBHOOK = originalWecom;
    } else {
      delete process.env.WECOM_BOT_WEBHOOK;
    }
    vi.unstubAllGlobals();
  });

  it('未配置 webhook 时返回 0 且不发送请求', async () => {
    const sent = await alerter.sendPendingAlerts();
    expect(sent).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('没有未发送告警时返回 0 且不发送请求', async () => {
    process.env.HEALTH_ALERT_WEBHOOK_URL = 'https://example.com/webhook';
    const sent = await alerter.sendPendingAlerts();
    expect(sent).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('发送成功的告警会被标记为已发送', async () => {
    process.env.HEALTH_ALERT_WEBHOOK_URL = 'https://example.com/webhook';

    alerter.createAlert({ platform: 'zhihu', alertType: 'session_expired', message: 'alert 1' });
    alerter.createAlert({ platform: 'weixin', alertType: 'consecutive_failures', message: 'alert 2' });

    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ errcode: 0 }),
    });

    const sent = await alerter.sendPendingAlerts();

    expect(sent).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // All alerts should be marked as sent
    const stats = dbAccess.credentials.getAlertStats();
    expect(stats.sent).toBe(2);
    expect(stats.unsent).toBe(0);

    // No more unsent alerts
    const unsent = dbAccess.credentials.getUnsentAlerts();
    expect(unsent.length).toBe(0);
  });

  it('Webhook 返回非 200 时不标记为已发送', async () => {
    process.env.HEALTH_ALERT_WEBHOOK_URL = 'https://example.com/webhook';

    alerter.createAlert({ platform: 'zhihu', alertType: 'session_expired', message: 'alert 1' });

    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    });

    const sent = await alerter.sendPendingAlerts();

    expect(sent).toBe(0);
    const stats = dbAccess.credentials.getAlertStats();
    expect(stats.unsent).toBe(1);
    expect(stats.sent).toBe(0);
  });

  it('Webhook 返回 errcode 非 0 时不标记为已发送', async () => {
    process.env.HEALTH_ALERT_WEBHOOK_URL = 'https://example.com/webhook';

    alerter.createAlert({ platform: 'zhihu', alertType: 'session_expired', message: 'alert 1' });

    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ errcode: 400, errmsg: 'invalid parameter' }),
    });

    const sent = await alerter.sendPendingAlerts();

    expect(sent).toBe(0);
    const stats = dbAccess.credentials.getAlertStats();
    expect(stats.unsent).toBe(1);
  });

  it('部分成功时只标记成功的告警为已发送', async () => {
    process.env.HEALTH_ALERT_WEBHOOK_URL = 'https://example.com/webhook';

    alerter.createAlert({ platform: 'zhihu', alertType: 'session_expired', message: 'alert 1' });
    alerter.createAlert({ platform: 'weixin', alertType: 'consecutive_failures', message: 'alert 2' });

    // First succeeds, second fails
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ errcode: 0 }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      });

    const sent = await alerter.sendPendingAlerts();

    expect(sent).toBe(1);
    const stats = dbAccess.credentials.getAlertStats();
    expect(stats.sent).toBe(1);
    expect(stats.unsent).toBe(1);
  });

  it('企业微信 webhook 使用正确的消息格式', async () => {
    process.env.WECOM_BOT_WEBHOOK = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx';

    alerter.createAlert({ platform: 'zhihu', alertType: 'session_expired', message: '登录态过期' });

    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ errcode: 0 }),
    });

    await alerter.sendPendingAlerts();

    const callArgs = fetchMock.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.msgtype).toBe('text');
    expect(body.text.content).toContain('GEO系统告警');
    expect(body.text.content).toContain('[知乎] 登录态过期');
  });

  it('飞书 webhook 使用正确的消息格式', async () => {
    process.env.HEALTH_ALERT_WEBHOOK_URL = 'https://open.feishu.cn/open-apis/bot/v2/hook/xxx';

    alerter.createAlert({ platform: 'zhihu', alertType: 'session_expired', message: 'test' });

    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ errcode: 0 }),
    });

    await alerter.sendPendingAlerts();

    const callArgs = fetchMock.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.msg_type).toBe('text');
    expect(body.content.text).toContain('GEO系统告警');
  });

  it('通用 webhook 使用正确的消息格式', async () => {
    process.env.HEALTH_ALERT_WEBHOOK_URL = 'https://hooks.example.com/generic';

    alerter.createAlert({ platform: 'zhihu', alertType: 'session_expired', message: 'test alert' });

    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    await alerter.sendPendingAlerts();

    const callArgs = fetchMock.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.text).toContain('GEO系统告警');
    expect(body.text).toContain('[知乎] test alert');
  });

  it('fetch 抛出异常时捕获并继续处理其他告警', async () => {
    process.env.HEALTH_ALERT_WEBHOOK_URL = 'https://example.com/webhook';

    alerter.createAlert({ platform: 'zhihu', alertType: 'session_expired', message: 'alert 1' });
    alerter.createAlert({ platform: 'weixin', alertType: 'session_expired', message: 'alert 2' });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    fetchMock
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ errcode: 0 }),
      });

    const sent = await alerter.sendPendingAlerts();

    expect(sent).toBe(1);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe('HealthAlerter.isConfigured', () => {
  let alerter: HealthAlerter;
  let originalWebhook: string | undefined;
  let originalWecom: string | undefined;

  beforeEach(() => {
    const { dbAccess } = createTestDatabase();
    alerter = new HealthAlerter(dbAccess as any);
    originalWebhook = process.env.HEALTH_ALERT_WEBHOOK_URL;
    originalWecom = process.env.WECOM_BOT_WEBHOOK;
    delete process.env.HEALTH_ALERT_WEBHOOK_URL;
    delete process.env.WECOM_BOT_WEBHOOK;
  });

  afterEach(() => {
    if (originalWebhook !== undefined) {
      process.env.HEALTH_ALERT_WEBHOOK_URL = originalWebhook;
    } else {
      delete process.env.HEALTH_ALERT_WEBHOOK_URL;
    }
    if (originalWecom !== undefined) {
      process.env.WECOM_BOT_WEBHOOK = originalWecom;
    } else {
      delete process.env.WECOM_BOT_WEBHOOK;
    }
  });

  it('未配置任何 webhook 时返回 false', () => {
    expect(alerter.isConfigured()).toBe(false);
  });

  it('配置 HEALTH_ALERT_WEBHOOK_URL 时返回 true', () => {
    process.env.HEALTH_ALERT_WEBHOOK_URL = 'https://example.com/hook';
    expect(alerter.isConfigured()).toBe(true);
  });

  it('配置 WECOM_BOT_WEBHOOK 时返回 true', () => {
    process.env.WECOM_BOT_WEBHOOK = 'https://qyapi.weixin.qq.com/xxx';
    expect(alerter.isConfigured()).toBe(true);
  });
});
