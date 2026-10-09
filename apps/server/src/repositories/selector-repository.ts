import type { DB } from '../db.js';

export class SelectorRepository {
  constructor(private db: DB) {}

  /** Record a selector health check result. */
  recordSelectorHealthCheck(
    platform: string,
    url: string,
    totalSelectors: number,
    foundSelectors: number,
    missingSelectors: number,
    brokenPurposes: string,
    resultsJson: string,
    triggeredBy: string = 'scheduled',
  ): void {
    this.db.prepare(
      `INSERT INTO selector_health_logs
        (platform, url, total_selectors, found_selectors, missing_selectors, broken_purposes, results_json, triggered_by, checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      platform, url, totalSelectors, foundSelectors, missingSelectors,
      brokenPurposes, resultsJson, triggeredBy, Date.now(),
    );
  }

  /** Get recent selector health logs. */
  getSelectorHealthLogs(limit: number = 50, platform?: string): Array<{
    id: number;
    platform: string;
    url: string;
    totalSelectors: number;
    foundSelectors: number;
    missingSelectors: number;
    brokenPurposes: string | null;
    triggeredBy: string;
    checkedAt: number;
  }> {
    const safeLimit = Math.max(1, Math.floor(limit));
    let sql = 'SELECT id, platform, url, total_selectors, found_selectors, missing_selectors, broken_purposes, triggered_by, checked_at FROM selector_health_logs';
    const params: unknown[] = [];
    if (platform) {
      sql += ' WHERE platform = ?';
      params.push(platform);
    }
    sql += ' ORDER BY checked_at DESC LIMIT ?';
    params.push(safeLimit);
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: Number(r.id),
      platform: String(r.platform),
      url: String(r.url),
      totalSelectors: Number(r.total_selectors),
      foundSelectors: Number(r.found_selectors),
      missingSelectors: Number(r.missing_selectors),
      brokenPurposes: r.broken_purposes ? String(r.broken_purposes) : null,
      triggeredBy: String(r.triggered_by ?? 'scheduled'),
      checkedAt: Number(r.checked_at),
    }));
  }

  /** Get the latest selector health check for each platform. */
  getLatestSelectorHealth(): Array<{
    platform: string;
    url: string;
    totalSelectors: number;
    foundSelectors: number;
    missingSelectors: number;
    brokenPurposes: string | null;
    checkedAt: number;
  }> {
    const rows = this.db.prepare(
      `SELECT s.platform, s.url, s.total_selectors, s.found_selectors, s.missing_selectors, s.broken_purposes, s.checked_at
       FROM selector_health_logs s
       INNER JOIN (
         SELECT platform, MAX(checked_at) as max_checked
         FROM selector_health_logs
         GROUP BY platform
       ) latest ON s.platform = latest.platform AND s.checked_at = latest.max_checked`,
    ).all() as Record<string, unknown>[];
    return rows.map((r) => ({
      platform: String(r.platform),
      url: String(r.url),
      totalSelectors: Number(r.total_selectors),
      foundSelectors: Number(r.found_selectors),
      missingSelectors: Number(r.missing_selectors),
      brokenPurposes: r.broken_purposes ? String(r.broken_purposes) : null,
      checkedAt: Number(r.checked_at),
    }));
  }

  /** Get selector health statistics. */
  getSelectorHealthStats(): {
    totalChecks: number;
    totalBrokenPurposes: number;
    byPlatform: Array<{
      platform: string;
      lastChecked: number;
      foundSelectors: number;
      totalSelectors: number;
      brokenPurposes: string[];
    }>;
  } {
    const latest = this.getLatestSelectorHealth();
    const byPlatform = latest.map((r) => ({
      platform: r.platform,
      lastChecked: r.checkedAt,
      foundSelectors: r.foundSelectors,
      totalSelectors: r.totalSelectors,
      brokenPurposes: r.brokenPurposes ? r.brokenPurposes.split(',').filter(Boolean) : [],
    }));
    return {
      totalChecks: byPlatform.length,
      totalBrokenPurposes: byPlatform.reduce((sum, p) => sum + p.brokenPurposes.length, 0),
      byPlatform,
    };
  }

  // === Captcha Event Tracking ===

  /** Record a captcha event. */
  recordCaptchaEvent(
    platform: string,
    captchaType: string,
    captchaSource: string,
    taskId?: string,
    userId?: string,
    pageUrl?: string,
    screenshot?: string,
  ): number {
    const result = this.db.prepare(
      `INSERT INTO captcha_events
        (platform, task_id, user_id, captcha_type, captcha_source, status, page_url, screenshot, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    ).run(
      platform,
      taskId ?? null,
      userId ?? 'user_default',
      captchaType,
      captchaSource,
      pageUrl ?? null,
      screenshot ?? null,
      Date.now(),
    );
    return Number(result.lastInsertRowid);
  }

  /** Get pending captcha events (awaiting manual intervention). */
  getPendingCaptchaEvents(limit: number = 50): Array<{
    id: number;
    platform: string;
    taskId: string | null;
    userId: string;
    captchaType: string;
    captchaSource: string;
    pageUrl: string | null;
    screenshot: string | null;
    createdAt: number;
  }> {
    const safeLimit = Math.max(1, Math.floor(limit));
    const rows = this.db.prepare(
      `SELECT id, platform, task_id, user_id, captcha_type, captcha_source, page_url, screenshot, created_at
       FROM captcha_events WHERE status = 'pending'
       ORDER BY created_at DESC LIMIT ?`,
    ).all(safeLimit) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: Number(r.id),
      platform: String(r.platform),
      taskId: r.task_id ? String(r.task_id) : null,
      userId: String(r.user_id),
      captchaType: String(r.captcha_type),
      captchaSource: String(r.captcha_source),
      pageUrl: r.page_url ? String(r.page_url) : null,
      screenshot: r.screenshot ? String(r.screenshot) : null,
      createdAt: Number(r.created_at),
    }));
  }

  /** Get recent captcha events. */
  getCaptchaEvents(limit: number = 50, platform?: string, status?: string): Array<{
    id: number;
    platform: string;
    taskId: string | null;
    captchaType: string;
    captchaSource: string;
    status: string;
    resolvedBy: string | null;
    resolvedAt: number | null;
    createdAt: number;
  }> {
    const safeLimit = Math.max(1, Math.floor(limit));
    let sql = 'SELECT id, platform, task_id, captcha_type, captcha_source, status, resolved_by, resolved_at, created_at FROM captcha_events';
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (platform) {
      conditions.push('platform = ?');
      params.push(platform);
    }
    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(safeLimit);
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: Number(r.id),
      platform: String(r.platform),
      taskId: r.task_id ? String(r.task_id) : null,
      captchaType: String(r.captcha_type),
      captchaSource: String(r.captcha_source),
      status: String(r.status),
      resolvedBy: r.resolved_by ? String(r.resolved_by) : null,
      resolvedAt: r.resolved_at ? Number(r.resolved_at) : null,
      createdAt: Number(r.created_at),
    }));
  }

  /** Resolve a captcha event. */
  resolveCaptchaEvent(eventId: number, resolvedBy: string = 'manual'): boolean {
    const result = this.db.prepare(
      `UPDATE captcha_events SET status = 'resolved', resolved_by = ?, resolved_at = ? WHERE id = ? AND status = 'pending'`,
    ).run(resolvedBy, Date.now(), eventId);
    return result.changes > 0;
  }

  /** Get captcha statistics. */
  getCaptchaStats(): {
    total: number;
    pending: number;
    resolved: number;
    expired: number;
    byPlatform: Array<{ platform: string; total: number; pending: number; resolved: number }>;
    byType: Array<{ captchaType: string; total: number }>;
  } {
    const rows = this.db.prepare(
      `SELECT platform, captcha_type, status, COUNT(*) as count
       FROM captcha_events GROUP BY platform, captcha_type, status`,
    ).all() as { platform: string; captcha_type: string; status: string; count: number }[];

    const byPlatformMap = new Map<string, { total: number; pending: number; resolved: number }>();
    const byTypeMap = new Map<string, number>();
    let total = 0, pending = 0, resolved = 0, expired = 0;

    for (const row of rows) {
      const p = byPlatformMap.get(row.platform) || { total: 0, pending: 0, resolved: 0 };
      p.total += row.count;
      total += row.count;
      if (row.status === 'pending') { p.pending += row.count; pending += row.count; }
      if (row.status === 'resolved') { p.resolved += row.count; resolved += row.count; }
      if (row.status === 'expired') { expired += row.count; }
      byPlatformMap.set(row.platform, p);

      const t = byTypeMap.get(row.captcha_type) || 0;
      byTypeMap.set(row.captcha_type, t + row.count);
    }

    return {
      total,
      pending,
      resolved,
      expired,
      byPlatform: Array.from(byPlatformMap.entries()).map(([platform, s]) => ({
        platform,
        ...s,
      })),
      byType: Array.from(byTypeMap.entries()).map(([captchaType, count]) => ({
        captchaType,
        total: count,
      })),
    };
  }
}
