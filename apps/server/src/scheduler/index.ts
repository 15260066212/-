// Scheduler module — unified entry point
// All schedulers follow the same lifecycle pattern: startXxx() / stopXxx()
// Each scheduler is responsible for a single concern and manages its own lifecycle.

import {
  startScheduler,
  stopScheduler,
  recoverStaleTasks,
  filterDueTasks,
  checkDispatchGuard,
} from './publish-scheduler.js';

import {
  startCookieWarmer,
  stopCookieWarmer,
} from './cookie-warmer.js';

import {
  startHealthChecker,
  stopHealthChecker,
} from './health-checker.js';

import {
  startPlanTaskScheduler,
  stopPlanScheduler,
} from './plan-scheduler.js';

import {
  startCacheCleanup,
  stopCacheCleanup,
} from './cache-cleanup.js';

// Re-export individual scheduler functions
export {
  startScheduler,
  stopScheduler,
  recoverStaleTasks,
  filterDueTasks,
  checkDispatchGuard,
  startCookieWarmer,
  stopCookieWarmer,
  startHealthChecker,
  stopHealthChecker,
  startPlanTaskScheduler,
  stopPlanScheduler,
  startCacheCleanup,
  stopCacheCleanup,
};

/**
 * Start all schedulers at once.
 * Convenience function for server startup.
 */
export function startAllSchedulers(deps: {
  db: any;
  publisher: any;
  healthChecker: any;
  executePlanTask: (task: any) => Promise<void>;
}): void {
  startScheduler(deps.db, deps.publisher);
  startCookieWarmer(deps.db);
  startHealthChecker(deps.healthChecker);
  startPlanTaskScheduler(deps.db, deps.executePlanTask);
  startCacheCleanup(deps.db);
}

/**
 * Stop all schedulers at once.
 * Convenience function for server shutdown / graceful termination.
 */
export function stopAllSchedulers(): void {
  stopScheduler();
  stopCookieWarmer();
  stopHealthChecker();
  stopPlanScheduler();
  stopCacheCleanup();
}
