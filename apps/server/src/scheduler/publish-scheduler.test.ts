import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PublishTask } from '@zemingengine/shared';
import {
  filterDueTasks,
  checkDispatchGuard,
  recoverStaleTasks,
} from './publish-scheduler.js';

function createMockTask(overrides: Partial<PublishTask> = {}): PublishTask {
  const now = new Date();
  return {
    id: 'task-1',
    articleId: 'article-1',
    platform: 'weixin',
    status: 'pending',
    method: 'api',
    retryCount: 0,
    maxRetries: 2,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...overrides,
  };
}

describe('filterDueTasks', () => {
  const now = Date.now();

  it('只返回 scheduledAt 已到的 pending/retrying 任务', () => {
    const tasks: PublishTask[] = [
      createMockTask({ id: 't1', status: 'pending', scheduledAt: new Date(now - 1000).toISOString() }),
      createMockTask({ id: 't2', status: 'pending', scheduledAt: new Date(now + 1000).toISOString() }),
      createMockTask({ id: 't3', status: 'retrying', scheduledAt: new Date(now - 1000).toISOString() }),
      createMockTask({ id: 't4', status: 'published', scheduledAt: new Date(now - 1000).toISOString() }),
      createMockTask({ id: 't5', status: 'pending' }), // no scheduledAt
    ];

    const due = filterDueTasks(tasks, now);
    expect(due.map((t) => t.id)).toEqual(['t1', 't3']);
  });

  it('空任务列表返回空数组', () => {
    expect(filterDueTasks([], now)).toEqual([]);
  });

  it('没有 scheduledAt 的任务不被视为到期', () => {
    const tasks = [createMockTask({ status: 'pending' })];
    expect(filterDueTasks(tasks, now)).toEqual([]);
  });
});

describe('checkDispatchGuard', () => {
  const task = createMockTask({ platform: 'weixin', accountId: 'acc1' });
  const now = Date.now();

  it('并发数达到上限时返回 concurrency', () => {
    const result = checkDispatchGuard(task, 5, new Set(), new Map(), now);
    expect(result.skipReason).toBe('concurrency');
    expect(result.accountKey).toBe('weixin:acc1');
  });

  it('账号已在发布中时返回 in_progress', () => {
    const publishing = new Set(['weixin:acc1']);
    const result = checkDispatchGuard(task, 0, publishing, new Map(), now);
    expect(result.skipReason).toBe('in_progress');
  });

  it('账号在冷却期内时返回 cooldown', () => {
    const cooldowns = new Map([['weixin:acc1', now + 10000]]);
    const result = checkDispatchGuard(task, 0, new Set(), cooldowns, now);
    expect(result.skipReason).toBe('cooldown');
  });

  it('冷却期已过时不阻止调度', () => {
    const cooldowns = new Map([['weixin:acc1', now - 1000]]);
    const result = checkDispatchGuard(task, 0, new Set(), cooldowns, now);
    expect(result.skipReason).toBeNull();
  });

  it('无任何限制时返回 null（可以调度）', () => {
    const result = checkDispatchGuard(task, 0, new Set(), new Map(), now);
    expect(result.skipReason).toBeNull();
  });

  it('accountId 为 undefined 时使用 default', () => {
    const taskNoAccount = createMockTask({ platform: 'zhihu', accountId: undefined });
    const result = checkDispatchGuard(taskNoAccount, 0, new Set(), new Map(), now);
    expect(result.accountKey).toBe('zhihu:default');
  });
});

describe('recoverStaleTasks', () => {
  function createMockDb(staleTasks: PublishTask[] = [], retryingTasks: PublishTask[] = []) {
    const pendingTasks = [...staleTasks, ...retryingTasks];
    const updatedTasks: Array<{ id: string; updates: Partial<PublishTask> }> = [];
    return {
      publish: {
        getStalePublishingTasks: vi.fn().mockReturnValue(staleTasks),
        getPendingPublishTasks: vi.fn().mockReturnValue(pendingTasks),
        updatePublishTask: vi.fn((id: string, updates: Partial<PublishTask>) => {
          updatedTasks.push({ id, updates });
        }),
      },
      _updatedTasks: updatedTasks,
    };
  }

  it('将超过 5 分钟的 publishing 任务标记为 failed', () => {
    const staleTask = createMockTask({ id: 'stale-1', status: 'publishing' as const, updatedAt: new Date(Date.now() - 6 * 60 * 1000).toISOString() });
    const db = createMockDb([staleTask]);

    recoverStaleTasks(db as any);

    expect(db.publish.getStalePublishingTasks).toHaveBeenCalled();
    expect(db.publish.updatePublishTask).toHaveBeenCalledWith('stale-1', {
      status: 'failed',
      errorMessage: 'Task interrupted by server restart',
      failureType: 'unknown',
    });
  });

  it('将 retrying 任务重置为 pending', () => {
    const retryingTask = createMockTask({ id: 'retry-1', status: 'retrying' as const });
    const db = createMockDb([], [retryingTask]);

    recoverStaleTasks(db as any);

    expect(db._updatedTasks.find((t) => t.id === 'retry-1')?.updates.status).toBe('pending');
  });

  it('无 stale 或 retrying 任务时不执行任何更新', () => {
    const db = createMockDb();
    recoverStaleTasks(db as any);
    expect(db._updatedTasks.length).toBe(0);
  });
});
