import type { SessionHealthChecker } from '../session-health/index.js';

const HEALTH_CHECK_INTERVAL_MS = 10 * 60 * 1000; // 每 10 分钟检查一批

let healthCheckTimer: ReturnType<typeof setInterval> | null = null;

export function startHealthChecker(checker: SessionHealthChecker): void {
  if (healthCheckTimer) {
    console.warn('[HealthChecker] Already running');
    return;
  }
  console.log('[HealthChecker] Starting (batch check every 10 min)');

  // Run first check after a short delay (let server fully start)
  setTimeout(() => {
    checker.runCheckBatch().catch((err) => {
      console.error('[HealthChecker] First batch failed:', err.message);
    });
  }, 5000);

  healthCheckTimer = setInterval(() => {
    checker.runCheckBatch().catch((err) => {
      console.error('[HealthChecker] Batch check failed:', err.message);
    });
  }, HEALTH_CHECK_INTERVAL_MS);
}

export function stopHealthChecker(): void {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
    console.log('[HealthChecker] Stopped');
  }
}
