import type { PublishTask } from '@zemingengine/shared';

const MAX_CONCURRENT = 5;

export type DispatchSkipReason = 'concurrency' | 'in_progress' | 'cooldown' | null;

export interface DispatchGuard {
  accountKey: string;
  skipReason: DispatchSkipReason;
}

/**
 * Manages concurrency control for scheduled publishing.
 *
 * Tracks:
 * - Global concurrency limit (max active tasks)
 * - Per-account in-progress tracking (one task per account at a time)
 * - Per-account cooldown periods (rate-limit protection between publishes)
 *
 * Encapsulates all mutable state so the scheduler tick function only
 * deals with task selection and dispatch, not state bookkeeping.
 */
export class PublishConcurrencyController {
  private publishingAccounts = new Set<string>();
  private accountCooldowns = new Map<string, number>();
  private activeCount = 0;
  private maxConcurrent: number;

  constructor(maxConcurrent: number = MAX_CONCURRENT) {
    this.maxConcurrent = maxConcurrent;
  }

  /**
   * Check whether a task can be dispatched right now.
   * Returns a guard object with the reason if it must be skipped.
   */
  checkDispatch(task: PublishTask, now: number): DispatchGuard {
    const accountKey = this.getAccountKey(task);

    if (this.activeCount >= this.maxConcurrent) {
      return { accountKey, skipReason: 'concurrency' };
    }
    if (this.publishingAccounts.has(accountKey)) {
      return { accountKey, skipReason: 'in_progress' };
    }
    const cooldownEnd = this.accountCooldowns.get(accountKey);
    if (cooldownEnd && cooldownEnd > now) {
      return { accountKey, skipReason: 'cooldown' };
    }
    return { accountKey, skipReason: null };
  }

  /** Mark a task as started (increment active count, add to in-progress set). */
  startDispatch(accountKey: string): void {
    this.publishingAccounts.add(accountKey);
    this.activeCount++;
  }

  /**
   * Mark a task as finished (decrement active count, remove from in-progress,
   * set cooldown for the account).
   */
  finishDispatch(accountKey: string, cooldownMs: number, now: number): void {
    this.publishingAccounts.delete(accountKey);
    this.activeCount--;
    this.accountCooldowns.set(accountKey, now + cooldownMs);
  }

  /** Get the current number of active publish tasks. */
  getActiveCount(): number {
    return this.activeCount;
  }

  /** Get the max concurrent task limit. */
  getMaxConcurrent(): number {
    return this.maxConcurrent;
  }

  /** Check if a specific account is currently publishing. */
  isPublishing(accountKey: string): boolean {
    return this.publishingAccounts.has(accountKey);
  }

  /** Get the cooldown end timestamp for an account (or undefined if not cooling). */
  getCooldownEnd(accountKey: string): number | undefined {
    return this.accountCooldowns.get(accountKey);
  }

  /** Build the account-level key used for tracking. */
  getAccountKey(task: PublishTask): string {
    const accountId = task.accountId ?? 'default';
    return `${task.platform}:${accountId}`;
  }
}
