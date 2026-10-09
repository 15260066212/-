import { MAX_CONSECUTIVE_FAILURES, type HealthCheckStatus } from './types.js';

/**
 * Pure utility functions for session health status transitions.
 * Extracted from SessionHealthChecker so they can be tested in isolation.
 */

export interface TransitionAlertDecision {
  shouldAlert: boolean;
  alertType?: 'session_recovered' | 'session_expired' | 'consecutive_failures';
  message?: string;
}

/**
 * Determine whether a credential should be marked as expired
 * based on the number of consecutive failures.
 *
 * Pure function — no side effects, same input always gives same output.
 */
export function shouldMarkExpired(
  failures: number,
  maxFailures: number = MAX_CONSECUTIVE_FAILURES,
): boolean {
  return failures >= maxFailures;
}

/**
 * Determine what alert (if any) should be created when a health check completes.
 *
 * Pure function — decides based solely on the input parameters.
 *
 * @param previousStatus - The health status before this check
 * @param currentStatus - The health status after this check (before auto-upgrade)
 * @param consecutiveFailures - Number of consecutive failures (including this one)
 * @param errorMessage - Error message from the current failed check (if any)
 * @param maxFailures - Threshold for marking a credential expired
 */
export function getTransitionAlert(
  previousStatus: HealthCheckStatus | undefined,
  currentStatus: HealthCheckStatus,
  consecutiveFailures: number,
  errorMessage: string | undefined,
  maxFailures: number = MAX_CONSECUTIVE_FAILURES,
): TransitionAlertDecision {
  const wasExpired = previousStatus === 'expired';

  // Recovery: was expired, now valid
  if (currentStatus === 'valid' && wasExpired) {
    return {
      shouldAlert: true,
      alertType: 'session_recovered',
      message: '登录态已恢复正常',
    };
  }

  // Failure path
  if (currentStatus === 'error') {
    // Just reached the expired threshold and wasn't expired before
    if (consecutiveFailures >= maxFailures && !wasExpired) {
      const reason = `连续 ${consecutiveFailures} 次检查失败: ${errorMessage || '未知错误'}`;
      return {
        shouldAlert: true,
        alertType: 'session_expired',
        message: reason,
      };
    }

    // First failure and wasn't already expired
    if (consecutiveFailures === 1 && !wasExpired) {
      return {
        shouldAlert: true,
        alertType: 'consecutive_failures',
        message: `健康检查失败: ${errorMessage || '未知错误'}`,
      };
    }
  }

  return { shouldAlert: false };
}

/**
 * Compute the final status after applying consecutive-failure auto-upgrade.
 *
 * Pure function — given current status and failure count, returns the final status.
 */
export function computeFinalStatus(
  currentStatus: HealthCheckStatus,
  consecutiveFailures: number,
  maxFailures: number = MAX_CONSECUTIVE_FAILURES,
): HealthCheckStatus {
  if (currentStatus === 'error' && consecutiveFailures >= maxFailures) {
    return 'expired';
  }
  return currentStatus;
}
