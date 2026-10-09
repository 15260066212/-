import type { DatabaseAccess } from '../db.js';

// === Plan Task Scheduler ===
// Checks daily for due scheduled plan tasks and executes them via pipeline

const PLAN_CHECK_INTERVAL_MS = 60 * 60 * 1000; // Check every hour

let planSchedulerTimer: ReturnType<typeof setInterval> | null = null;

export function startPlanTaskScheduler(
  db: DatabaseAccess,
  executeTaskFn: (task: any) => Promise<void>,
): void {
  if (planSchedulerTimer) {
    console.warn('[PlanScheduler] Already running');
    return;
  }
  console.log('[PlanScheduler] Starting (check every 1 hour)');

  const tick = async () => {
    try {
      const dueTasks = db.plans.getDueScheduledTasks();
      if (dueTasks.length === 0) return;

      console.log(`[PlanScheduler] Found ${dueTasks.length} due plan task(s)`);

      for (const task of dueTasks) {
        try {
          db.plans.updateScheduledTaskStatus(task.id, 'running', { executedAt: new Date().toISOString() });
          await executeTaskFn(task);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          console.error(`[PlanScheduler] Task ${task.id} failed:`, msg);
          db.plans.updateScheduledTaskStatus(task.id, 'failed', { errorMessage: msg });
        }
      }
    } catch (err) {
      console.error('[PlanScheduler] Tick failed:', err instanceof Error ? err.message : err);
    }
  };

  // Run first check after 30 seconds
  setTimeout(() => { tick().catch(() => {}); }, 30000);
  planSchedulerTimer = setInterval(() => { tick().catch(() => {}); }, PLAN_CHECK_INTERVAL_MS);
}

export function stopPlanScheduler(): void {
  if (planSchedulerTimer) {
    clearInterval(planSchedulerTimer);
    planSchedulerTimer = null;
    console.log('[PlanScheduler] Stopped');
  }
}
