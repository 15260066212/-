/**
 * CaptchaManager — Centralized captcha detection, tracking, alerting,
 * and manual intervention queue for RPA publishing operations.
 *
 * Flow:
 * 1. During publish, harvester detects captcha elements on the page
 * 2. CaptchaManager.recordCaptcha() logs the event to DB + creates alert
 * 3. Task is moved to 'captcha_blocked' status, waiting for manual intervention
 * 4. When captcha is resolved (manually or automatically), resolveCaptcha() is called
 * 5. Task can then be retried
 *
 * Also provides:
 * - Platform captcha frequency tracking (detect high-risk accounts)
 * - Retry policy with exponential backoff
 * - Real-time alert notifications
 */

import type { DatabaseAccess } from '../db.js';

/** Captcha types supported by the system. */
export type CaptchaType =
  | 'slider'      // 滑块验证码
  | 'geetest'     // 极验验证码
  | 'image'       // 图片验证码
  | 'text'        // 文字验证码
  | 'behavioral'  // 行为验证码
  | 'sms'         // 短信验证码
  | 'qrcode'      // 扫码登录
  | 'unknown';    // 未知类型

export type CaptchaSource = 'publish' | 'login' | 'relogin' | 'session_check' | 'manual_check';

export type CaptchaStatus = 'pending' | 'resolved' | 'expired' | 'ignored';

/** Platform-specific captcha selectors. */
const CAPTCHA_SELECTORS: Record<string, { selector: string; type: CaptchaType }[]> = {
  csdn: [
    { selector: '.geetest', type: 'geetest' },
    { selector: '.captcha', type: 'image' },
    { selector: '#captcha', type: 'image' },
    { selector: '.verify-wrap', type: 'behavioral' },
    { selector: '.geetest_widget', type: 'geetest' },
    { selector: '.geetest_slider_button', type: 'slider' },
  ],
  zhihu: [
    { selector: '.geetest', type: 'geetest' },
    { selector: '.Captcha', type: 'image' },
    { selector: '#js-captcha', type: 'image' },
    { selector: '.sign-container .captcha', type: 'image' },
    { selector: '.verify-modal', type: 'behavioral' },
  ],
  baijia: [
    { selector: '.geetest', type: 'geetest' },
    { selector: '.captcha', type: 'image' },
    { selector: '#captcha', type: 'image' },
    { selector: '.verify-wrap', type: 'behavioral' },
    { selector: '.nc_wrapper', type: 'slider' },
  ],
  toutiao: [
    { selector: '.captcha', type: 'image' },
    { selector: '#captcha', type: 'image' },
    { selector: '.geetest', type: 'geetest' },
    { selector: '.verify-modality', type: 'behavioral' },
    { selector: '.captcha_container', type: 'image' },
  ],
  juejin: [
    { selector: '.geetest', type: 'geetest' },
    { selector: '.captcha', type: 'image' },
    { selector: '#captcha', type: 'image' },
    { selector: '.JCaptcha', type: 'image' },
  ],
  bilibili: [
    { selector: '.geetest', type: 'geetest' },
    { selector: '.captcha', type: 'image' },
    { selector: '#captcha', type: 'image' },
    { selector: '.nc_wrapper', type: 'slider' },
    { selector: '.geetest_widget', type: 'geetest' },
  ],
  sohu: [
    { selector: '.captcha', type: 'image' },
    { selector: '#captcha', type: 'image' },
    { selector: '.geetest', type: 'geetest' },
  ],
  netease: [
    { selector: '.captcha', type: 'image' },
    { selector: '#captcha', type: 'image' },
    { selector: '.geetest', type: 'geetest' },
    { selector: '.nc-container', type: 'slider' },
  ],
  zhidao: [
    { selector: '.captcha', type: 'image' },
    { selector: '#captcha', type: 'image' },
    { selector: '.geetest', type: 'geetest' },
    { selector: '.verifyCode', type: 'image' },
  ],
  wechat: [],
};

/** Generic captcha selectors that apply to all platforms. */
const GENERIC_CAPTCHA_SELECTORS: { selector: string; type: CaptchaType }[] = [
  { selector: '.geetest_panel', type: 'geetest' },
  { selector: '.geetest_widget', type: 'geetest' },
  { selector: '.geetest_slider', type: 'slider' },
  { selector: 'iframe[src*="captcha"]', type: 'behavioral' },
  { selector: 'iframe[src*="verify"]', type: 'behavioral' },
  { selector: 'img[src*="captcha"]', type: 'image' },
  { selector: 'img[src*="verify"]', type: 'image' },
  { selector: 'canvas[id*="captcha"]', type: 'image' },
  { selector: '[class*="captcha"][class*="modal"]', type: 'image' },
  { selector: '[class*="verify"][class*="modal"]', type: 'behavioral' },
  { selector: '[id*="captchaModal"]', type: 'image' },
];

/** Cooldown after a captcha before retrying (5 minutes). */
const CAPTCHA_RETRY_COOLDOWN_MS = 5 * 60 * 1000;

/** Max captcha occurrences before escalating (per platform per day). */
const MAX_CAPTCHA_PER_DAY = 5;

export interface CaptchaDetectionResult {
  detected: boolean;
  type: CaptchaType;
  selector: string;
  source: CaptchaSource;
}

export class CaptchaManager {
  private db: DatabaseAccess;

  constructor(db: DatabaseAccess) {
    this.db = db;
  }

  /** Get all captcha selectors for a platform (platform-specific + generic). */
  getCaptchaSelectors(platform: string): { selector: string; type: CaptchaType }[] {
    const platformSelectors = CAPTCHA_SELECTORS[platform] || [];
    return [...platformSelectors, ...GENERIC_CAPTCHA_SELECTORS];
  }

  /**
   * Record a captcha event when one is detected during RPA operations.
   * Creates a DB record, generates a health alert, and returns the event ID.
   */
  recordCaptcha(
    platform: string,
    captchaType: CaptchaType,
    source: CaptchaSource,
    taskId?: string,
    userId?: string,
    pageUrl?: string,
    screenshot?: string,
  ): number {
    const eventId = this.db.selectors.recordCaptchaEvent(
      platform,
      captchaType,
      source,
      taskId,
      userId,
      pageUrl,
      screenshot,
    );

    // Create health alert
    const message = `Captcha detected on ${platform} during ${source}` +
      (taskId ? ` (task: ${taskId})` : '') +
      ` — type: ${captchaType}. Manual intervention required.`;
    this.db.credentials.insertHealthAlert(platform, 'captcha_detected', message);
    console.warn(`[CaptchaManager] Captcha detected: ${platform} ${captchaType} (${source}) — event #${eventId}`);

    return eventId;
  }

  /** Resolve a captcha event (after manual or automatic resolution). */
  resolveCaptcha(eventId: number, resolvedBy: string = 'manual'): boolean {
    const resolved = this.db.selectors.resolveCaptchaEvent(eventId, resolvedBy);
    if (resolved) {
      console.log(`[CaptchaManager] Captcha event #${eventId} resolved by ${resolvedBy}`);
    }
    return resolved;
  }

  /** Get pending captcha events awaiting manual intervention. */
  getPendingEvents(limit: number = 50) {
    return this.db.selectors.getPendingCaptchaEvents(limit);
  }

  /** Get captcha statistics for the monitor dashboard. */
  getStats() {
    return this.db.selectors.getCaptchaStats();
  }

  /** Get recent captcha events with optional filtering. */
  getEvents(limit: number = 50, platform?: string, status?: string) {
    return this.db.selectors.getCaptchaEvents(limit, platform, status);
  }

  /**
   * Check if a platform has exceeded its daily captcha limit.
   * If so, the platform should be paused to avoid account bans.
   */
  shouldPausePlatform(platform: string): boolean {
    const events = this.db.selectors.getCaptchaEvents(100, platform, 'pending');
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const recentCount = events.filter((e) => e.createdAt > oneDayAgo).length;
    return recentCount >= MAX_CAPTCHA_PER_DAY;
  }

  /** Check if a retry is allowed (not in cooldown). */
  canRetry(_platform: string, lastCaptchaTime: number): boolean {
    return Date.now() - lastCaptchaTime > CAPTCHA_RETRY_COOLDOWN_MS;
  }

  /** Get captcha monitor status for API. */
  getStatus() {
    const stats = this.db.selectors.getCaptchaStats();
    const pending = this.db.selectors.getPendingCaptchaEvents(10);
    return {
      ...stats,
      pendingEvents: pending,
      retryCooldownMs: CAPTCHA_RETRY_COOLDOWN_MS,
      maxCaptchaPerDay: MAX_CAPTCHA_PER_DAY,
      monitoredPlatforms: Object.keys(CAPTCHA_SELECTORS),
    };
  }
}
