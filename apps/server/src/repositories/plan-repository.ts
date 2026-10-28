import type { DB } from '../db.js';

export class PlanRepository {
  constructor(private db: DB) {}

  saveOptimizationPlan(plan: {
    id: string;
    sessionId: string;
    enterpriseName: string;
    duration: string;
    platforms: string[];
    contentTypes: string[];
    htmlContent: string;
    planArticles: any[];
    autoPublish: boolean;
    contentSupplement?: string;
  }): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO optimization_plans
        (id, session_id, enterprise_name, duration, platforms, content_types,
         html_content, plan_articles, auto_publish, content_supplement, created_at, updated_at)
      VALUES (@id, @sessionId, @enterpriseName, @duration, @platforms, @contentTypes,
              @htmlContent, @planArticles, @autoPublish, @contentSupplement, @createdAt, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        html_content = @htmlContent,
        plan_articles = @planArticles,
        content_supplement = @contentSupplement,
        auto_publish = @autoPublish,
        updated_at = @updatedAt
    `).run({
      id: plan.id,
      sessionId: plan.sessionId,
      enterpriseName: plan.enterpriseName,
      duration: plan.duration,
      platforms: JSON.stringify(plan.platforms),
      contentTypes: JSON.stringify(plan.contentTypes),
      htmlContent: plan.htmlContent,
      planArticles: JSON.stringify(plan.planArticles),
      autoPublish: plan.autoPublish ? 1 : 0,
      contentSupplement: plan.contentSupplement || null,
      createdAt: now,
      updatedAt: now,
    });
  }

  getOptimizationPlan(sessionId: string): any | null {
    const row = this.db.prepare(
      'SELECT * FROM optimization_plans WHERE session_id = ? ORDER BY updated_at DESC LIMIT 1'
    ).get(sessionId) as any;
    if (!row) return null;
    return {
      ...row,
      platforms: JSON.parse(row.platforms),
      content_types: JSON.parse(row.content_types),
      plan_articles: JSON.parse(row.plan_articles),
      auto_publish: !!row.auto_publish,
    };
  }

  updatePlanContentSupplement(planId: string, supplement: string): void {
    this.db.prepare(
      'UPDATE optimization_plans SET content_supplement = ?, updated_at = ? WHERE id = ?'
    ).run(supplement, new Date().toISOString(), planId);
  }

  // === Scheduled Plan Tasks ===

  createScheduledPlanTasks(tasks: any[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO scheduled_plan_tasks
        (id, plan_id, session_id, enterprise_name, scheduled_date, platform,
         content_type, topic, keyword, week, status, content_supplement, created_at)
      VALUES (@id, @planId, @sessionId, @enterpriseName, @scheduledDate, @platform,
              @contentType, @topic, @keyword, @week, 'pending', @contentSupplement, @createdAt)
    `);
    const now = new Date().toISOString();
    const tx = this.db.transaction((rows: any[]) => {
      for (const r of rows) {
        stmt.run({
          id: r.id,
          planId: r.planId,
          sessionId: r.sessionId,
          enterpriseName: r.enterpriseName,
          scheduledDate: r.scheduledDate,
          platform: r.platform,
          contentType: r.contentType,
          topic: r.topic,
          keyword: r.keyword || null,
          week: r.week || 1,
          contentSupplement: r.contentSupplement || null,
          createdAt: now,
        });
      }
    });
    tx(tasks);
  }

  getScheduledPlanTasks(planId: string): any[] {
    return this.db.prepare(
      'SELECT * FROM scheduled_plan_tasks WHERE plan_id = ? ORDER BY scheduled_date, week'
    ).all(planId) as any[];
  }

  getDueScheduledTasks(): any[] {
    const today = new Date().toISOString().slice(0, 10);
    return this.db.prepare(
      "SELECT * FROM scheduled_plan_tasks WHERE status = 'pending' AND scheduled_date <= ? ORDER BY scheduled_date, week"
    ).all(today) as any[];
  }

  updateScheduledTaskStatus(taskId: string, status: string, extra?: { articleId?: string; runId?: string; errorMessage?: string; executedAt?: string }): void {
    const sets: string[] = ['status = ?'];
    const params: (string | number | null)[] = [status];
    if (extra?.articleId) { sets.push('article_id = ?'); params.push(extra.articleId); }
    if (extra?.runId) { sets.push('run_id = ?'); params.push(extra.runId); }
    if (extra?.errorMessage) { sets.push('error_message = ?'); params.push(extra.errorMessage); }
    if (extra?.executedAt) { sets.push('executed_at = ?'); params.push(extra.executedAt); }
    params.push(taskId);
    this.db.prepare(`UPDATE scheduled_plan_tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  getScheduledTasksBySession(sessionId: string): any[] {
    return this.db.prepare(
      'SELECT * FROM scheduled_plan_tasks WHERE session_id = ? ORDER BY scheduled_date, week'
    ).all(sessionId) as any[];
  }
}
