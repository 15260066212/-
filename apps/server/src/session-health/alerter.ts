import { getPlatformLabel } from '@zemingengine/shared';
import type { DatabaseAccess } from '../db.js';

export interface AlertInfo {
  platform: string;
  alertType: 'session_expired' | 'consecutive_failures' | 'session_recovered' | 'relogin_success' | 'relogin_captcha' | 'relogin_failed';
  message: string;
  userId?: string;
}

export class HealthAlerter {
  private db: DatabaseAccess;

  constructor(db: DatabaseAccess) {
    this.db = db;
  }

  /**
   * Create an alert in the database.
   * The alert will be sent by the `sendPendingAlerts()` method.
   */
  createAlert(info: AlertInfo): number {
    const platformName = getPlatformLabel(info.platform);
    const formattedMessage = `[${platformName}] ${info.message}`;
    return this.db.credentials.insertHealthAlert(
      info.platform,
      info.alertType,
      formattedMessage,
      info.userId ?? 'user_default',
    );
  }

  /**
   * Send all unsent alerts via webhook.
   * Supports WeCom bot and generic webhook URLs.
   */
  async sendPendingAlerts(): Promise<number> {
    const webhookUrl = process.env.HEALTH_ALERT_WEBHOOK_URL || process.env.WECOM_BOT_WEBHOOK;
    if (!webhookUrl) {
      return 0;
    }

    const alerts = this.db.credentials.getUnsentAlerts();
    if (alerts.length === 0) {
      return 0;
    }

    let sentCount = 0;
    const failedAlerts: number[] = [];

    for (const alert of alerts) {
      try {
        const success = await this.sendWebhook(webhookUrl, alert.message);
        if (success) {
          this.db.credentials.markAlertSent(alert.id);
          sentCount++;
        } else {
          failedAlerts.push(alert.id);
        }
      } catch (err) {
        console.error(
          `[HealthAlerter] Failed to send alert ${alert.id}:`,
          err instanceof Error ? err.message : err,
        );
        failedAlerts.push(alert.id);
      }
    }

    if (sentCount > 0) {
      console.log(`[HealthAlerter] Sent ${sentCount} alert(s)`);
    }
    if (failedAlerts.length > 0) {
      console.warn(`[HealthAlerter] Failed to send ${failedAlerts.length} alert(s)`);
    }

    return sentCount;
  }

  /**
   * Send a message via webhook.
   * Supports WeCom bot format and generic JSON webhook.
   */
  private async sendWebhook(url: string, message: string): Promise<boolean> {
    const isWeCom = url.includes('qyapi.weixin.qq.com');
    const isLark = url.includes('hooks.feishu.cn') || url.includes('open.feishu.cn');

    let body: string;

    if (isWeCom) {
      body = JSON.stringify({
        msgtype: 'text',
        text: { content: `🔔 GEO系统告警\n${message}` },
      });
    } else if (isLark) {
      body = JSON.stringify({
        msg_type: 'text',
        content: { text: `🔔 GEO系统告警\n${message}` },
      });
    } else {
      body = JSON.stringify({
        text: `🔔 GEO系统告警\n${message}`,
      });
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      console.error(`[HealthAlerter] Webhook returned ${res.status}`);
      return false;
    }

    const data = await res.json().catch(() => ({}));
    if (data.errcode && data.errcode !== 0) {
      console.error(`[HealthAlerter] Webhook error: ${data.errcode} ${data.errmsg || ''}`);
      return false;
    }

    return true;
  }

  /**
   * Check if alerting is configured.
   */
  isConfigured(): boolean {
    return !!(process.env.HEALTH_ALERT_WEBHOOK_URL || process.env.WECOM_BOT_WEBHOOK);
  }
}
