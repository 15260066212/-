import { Publisher } from '@zemingengine/publisher';
import type { PublishTask } from '@zemingengine/shared';
import type { DatabaseAccess } from '../db.js';
import { executePublishWithHandling } from '../publish-utils.js';
import { resolvePublishCredential } from '../credential-resolver.js';
import { PublishConcurrencyController } from './concurrency-controller.js';

const POLL_INTERVAL_MS = 30_000; // 30 seconds
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CONCURRENT = 5;
const MIN_COOLDOWN_MS = 30_000; // 30s minimum cooldown (healthy platform)
const DEFAULT_COOLDOWN_MS = 60_000; // 60s default cooldown
const RATE_LIMIT_COOLDOWN_MS = 3 * 60_000; // 3 min cooldown after rate limit
const CAPTCHA_COOLDOWN_MS = 5 * 60_000; // 5 min cooldown after captcha

let publishSchedulerTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Calculate dynamic cooldown for a platform based on recent performance.
 *
 * - High success rate (>80%) → 30s cooldown (fast lane)
 * - Medium success rate (50-80%) → 60s cooldown (normal)
 * - Low success rate (<50%) → 120s cooldown (cautious)
 * - Rate limit failure → 180s cooldown
 * - Captcha detected → 300s cooldown
 */
function calculateDynamicCooldown(
  db: DatabaseAccess,
  platform: string,
  _lastFailureType?: string,
  captchaPending?: boolean,
): number {
  // Captcha takes priority — longest cooldown
  if (captchaPending) {
    console.log(`[Scheduler] ${platform}: captcha cooldown (${CAPTCHA_COOLDOWN_MS}ms)`);
    return CAPTCHA_COOLDOWN_MS;
  }

  // Check recent platform health for failure type
  const health = db.publish.getPlatformPublishHealth(platform, 10);

  // Rate limit error — extended cooldown
  if (health.lastError && health.lastError.toLowerCase().includes('rate')) {
    console.log(`[Scheduler] ${platform}: rate-limit cooldown (${RATE_LIMIT_COOLDOWN_MS}ms)`);
    return RATE_LIMIT_COOLDOWN_MS;
  }

  if (health.total < 3) {
    return DEFAULT_COOLDOWN_MS; // Not enough data, use default
  }

  if (health.successRate >= 80) {
    return MIN_COOLDOWN_MS; // Healthy platform — fast cooldown
  } else if (health.successRate >= 50) {
    return DEFAULT_COOLDOWN_MS; // Normal
  } else {
    return 2 * DEFAULT_COOLDOWN_MS; // 120s — cautious approach
  }
}

/**
 * Recover tasks that were interrupted by a server restart.
 *
 * 1. Tasks stuck in 'publishing' status for more than 5 minutes are marked as
 *    'failed' — the server restart interrupted their execution.
 * 2. Tasks in 'retrying' status are reset to 'pending' so the scheduler can
 *    reprocess them on the next poll.
 */
export function recoverStaleTasks(db: DatabaseAccess): void {
  // 1. Mark stale 'publishing' tasks as 'failed'
  const stalePublishing = db.publish.getStalePublishingTasks(STALE_THRESHOLD_MS);
  for (const task of stalePublishing) {
    db.publish.updatePublishTask(task.id, {
      status: 'failed',
      errorMessage: 'Task interrupted by server restart',
      failureType: 'unknown',
    });
    console.warn(
      `[Scheduler] Recovered stale publishing task ${task.id} ` +
        `(last updated: ${task.updatedAt})`,
    );
  }
  if (stalePublishing.length > 0) {
    console.log(
      `[Scheduler] Recovered ${stalePublishing.length} stale publishing task(s)`,
    );
  }

  // 2. Reset 'retrying' tasks to 'pending' so the scheduler reprocesses them
  const pendingTasks = db.publish.getPendingPublishTasks();
  const retryingTasks = pendingTasks.filter((t) => t.status === 'retrying');
  for (const task of retryingTasks) {
    db.publish.updatePublishTask(task.id, { status: 'pending' });
    console.log(
      `[Scheduler] Reset retrying task ${task.id} to pending`,
    );
  }
  if (retryingTasks.length > 0) {
    console.log(
      `[Scheduler] Reset ${retryingTasks.length} retrying task(s) to pending`,
    );
  }
}

/** Filter tasks that are due for processing (pending/retrying with scheduledAt arrived). */
export function filterDueTasks(tasks: PublishTask[], now: number): PublishTask[] {
  return tasks.filter(
    (t) =>
      (t.status === 'pending' || t.status === 'retrying') &&
      !!t.scheduledAt &&
      new Date(t.scheduledAt).getTime() <= now,
  );
}

interface DispatchGuard {
  accountKey: string;
  skipReason: 'concurrency' | 'in_progress' | 'cooldown' | null;
}

/** Check if a task can be dispatched or should be skipped. */
export function checkDispatchGuard(
  task: PublishTask,
  activeCount: number,
  publishingAccounts: Set<string>,
  accountCooldowns: Map<string, number>,
  now: number,
): DispatchGuard {
  const accountId = task.accountId ?? 'default';
  const accountKey = `${task.platform}:${accountId}`;

  if (activeCount >= MAX_CONCURRENT) {
    return { accountKey, skipReason: 'concurrency' };
  }
  if (publishingAccounts.has(accountKey)) {
    return { accountKey, skipReason: 'in_progress' };
  }
  const cooldownEnd = accountCooldowns.get(accountKey);
  if (cooldownEnd && cooldownEnd > now) {
    return { accountKey, skipReason: 'cooldown' };
  }
  return { accountKey, skipReason: null };
}

/**
 * Start the scheduled publish task dispatcher.
 *
 * Polls the database every POLL_INTERVAL_MS for due publish tasks and
 * dispatches them, respecting concurrency limits and per-account cooldowns.
 * Before the first poll, `recoverStaleTasks()` is called to clean up any
 * tasks that were interrupted by a previous server restart.
 *
 * Idempotent — calling startScheduler() while already running is a no-op.
 */
export function startScheduler(db: DatabaseAccess, publisher: Publisher): void {
  if (publishSchedulerTimer) {
    console.warn('[PublishScheduler] Already running');
    return;
  }
  console.log('[PublishScheduler] Scheduled-publish scheduler started (polling every 30s)');

  const concurrency = new PublishConcurrencyController(MAX_CONCURRENT);

  // Recover stale tasks before starting the poll loop
  recoverStaleTasks(db);

  const tick = async (): Promise<void> => {
    try {
      const tasks = db.publish.getPendingPublishTasks();
      const now = Date.now();

      const dueTasks = filterDueTasks(tasks, now);

      console.log(
        `[Scheduler] Poll: ${tasks.length} pending/retrying task(s) in queue, ` +
          `${dueTasks.length} due for processing, ${concurrency.getActiveCount()}/${MAX_CONCURRENT} active`,
      );

      if (dueTasks.length === 0) return;

      let dispatched = 0;
      let skipped = 0;

      for (const task of dueTasks) {
        const guard = concurrency.checkDispatch(task, now);

        if (guard.skipReason === 'concurrency') {
          console.log(
            `[Scheduler] Global concurrency limit reached (${MAX_CONCURRENT}), ` +
              `${dueTasks.length - dispatched} task(s) deferred to next poll`,
          );
          break;
        }

        if (guard.skipReason !== null) {
          const accountId = task.accountId ?? 'default';
          if (guard.skipReason === 'in_progress') {
            console.log(
              `[Scheduler] Skipping task ${task.id}: ${task.platform} (${accountId}) already in progress`,
            );
          } else {
            const cooldownEnd = concurrency.getCooldownEnd(guard.accountKey);
            console.log(
              `[Scheduler] Skipping task ${task.id}: ${task.platform} (${accountId}) in cooldown ` +
                `until ${new Date(cooldownEnd!).toISOString()}`,
            );
          }
          skipped++;
          continue;
        }

        // Prevent duplicate execution: mark as publishing before executing
        db.publish.updatePublishTask(task.id, { status: 'publishing' });
        concurrency.startDispatch(guard.accountKey);
        dispatched++;

        console.log(
          `[Scheduler] Triggering publish for task ${task.id} ` +
            `(platform: ${task.platform}, account: ${task.accountId ?? 'default'}, scheduledAt: ${task.scheduledAt})`,
        );

        // Fire-and-forget with cleanup on completion
      void executeScheduledPublish(db, publisher, { ...task, status: 'publishing' })
        .finally(() => {
          // Dynamic cooldown based on recent performance and failure type
          const captchaPending = db.selectors.getPendingCaptchaEvents(1).some((e) => e.platform === task.platform);
          const cooldownMs = calculateDynamicCooldown(db, task.platform, undefined, captchaPending);
          concurrency.finishDispatch(guard.accountKey, cooldownMs, Date.now());
        });
      }

      console.log(
        `[Scheduler] Poll complete: dispatched ${dispatched}, skipped ${skipped}, ` +
          `active ${concurrency.getActiveCount()}/${MAX_CONCURRENT}`,
      );
    } catch (err) {
      console.error(
        '[Scheduler] Error during scheduled publish poll:',
        err instanceof Error ? err.message : err,
      );
    }
  };

  // Run an initial tick immediately, then on the interval
  void tick();
  publishSchedulerTimer = setInterval(() => void tick(), POLL_INTERVAL_MS);
}

/**
 * Stop the scheduled publish task dispatcher.
 * Idempotent — safe to call even if not running.
 */
export function stopScheduler(): void {
  if (publishSchedulerTimer) {
    clearInterval(publishSchedulerTimer);
    publishSchedulerTimer = null;
    console.log('[PublishScheduler] Stopped');
  }
}

/**
 * Execute a single scheduled publish task.
 *
 * Mirrors the `publishArticleAsync` logic in routes/publish.ts: fetches the
 * article and credentials from the database, calls
 * `publisher.publishWithRetry()`, and updates the task + article status
 * based on the result.
 */
async function executeScheduledPublish(
  db: DatabaseAccess,
  publisher: Publisher,
  task: PublishTask,
): Promise<void> {
  const article = db.articles.getArticle(task.articleId);
  if (!article) {
    console.error(`[Scheduler] Article ${task.articleId} not found for task ${task.id}`);
    db.publish.updatePublishTask(task.id, {
      status: 'failed',
      errorMessage: `Article not found: ${task.articleId}`,
      failureType: 'platform',
    });
    return;
  }

  // Rollback protection: skip publishing if article hasn't passed review
  if (!db.reviews.hasPassingReview(task.articleId)) {
    const latestReview = db.reviews.getLatestReviewStatus(task.articleId);
    const reviewStatus = latestReview
      ? `审核未通过（评分: ${latestReview.overallScore}, 第${latestReview.round}轮）`
      : '文章尚未审核';
    console.warn(`[Scheduler] Task ${task.id} blocked: ${reviewStatus}`);
    db.publish.updatePublishTask(task.id, {
      status: 'failed',
      errorMessage: `发布被阻止：${reviewStatus}`,
      failureType: 'platform',
    });
    return;
  }

  const taskUserId = task.userId ?? 'user_default';
  const credResult = resolvePublishCredential(db, task.platform, taskUserId, {
    accountId: task.accountId ?? 'default',
  });

  if (credResult.success === false) {
    db.publish.updatePublishTask(task.id, {
      status: 'failed',
      errorMessage: credResult.reason,
      failureType: credResult.failureType,
    });
    db.articles.updateArticle(article.id, { status: 'failed' });
    return;
  }

  await executePublishWithHandling(
    db, publisher, task, article, credResult.credentials, '[Scheduler]',
  );
}
