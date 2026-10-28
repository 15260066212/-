import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DB } from '../db.js';
import { DatabaseAccess } from '../db.js';
import {
  createTestDatabase,
  createMockPublishTask,
  createMockPublishLog,
  resetMockCounters,
} from '../test-helpers.js';
import type { PublishLog } from '@zemingengine/shared';

describe('DatabaseAccess - Publish Tasks', () => {
  let db: DB;
  let dbAccess: DatabaseAccess;

  beforeEach(() => {
    ({ db, dbAccess } = createTestDatabase());
    resetMockCounters();
  });

  afterEach(() => {
    db.close();
  });

  it('should insert and retrieve a publish task by id', () => {
    const task = createMockPublishTask({ id: 'task-1', articleId: 'art-1', method: 'api', maxRetries: 2 });
    dbAccess.publish.insertPublishTask(task);

    const retrieved = dbAccess.publish.getPublishTask('task-1');
    expect(retrieved).toBeDefined();
    expect(retrieved!.method).toBe('api');
    expect(retrieved!.maxRetries).toBe(2, 'maxRetries should be preserved after insert');
  });

  it('should update task status and platformPostId', () => {
    const task = createMockPublishTask({ id: 'task-2', articleId: 'art-2', platform: 'zhihu', method: 'rpa' });
    dbAccess.publish.insertPublishTask(task);
    dbAccess.publish.updatePublishTask('task-2', { status: 'published', platformPostId: 'post123' });

    const updated = dbAccess.publish.getPublishTask('task-2');
    expect(updated!.status).toBe('published', 'status should be updated to published');
    expect(updated!.platformPostId).toBe('post123', 'platformPostId should be set after update');
  });

  it('should return only pending and retrying tasks as pending', () => {
    dbAccess.publish.insertPublishTask(createMockPublishTask({ id: 't1', articleId: 'a1', platform: 'weixin', status: 'pending', method: 'api' }));
    dbAccess.publish.insertPublishTask(createMockPublishTask({ id: 't2', articleId: 'a2', platform: 'zhihu', status: 'retrying', method: 'rpa', retryCount: 1 }));
    dbAccess.publish.insertPublishTask(createMockPublishTask({ id: 't3', articleId: 'a3', platform: 'csdn', status: 'published', method: 'rpa' }));

    const pending = dbAccess.publish.getPendingPublishTasks();
    expect(pending.length).toBe(2, 'only pending and retrying tasks should be returned');
  });
});

describe('DatabaseAccess - Publish Logs', () => {
  let db: DB;
  let dbAccess: DatabaseAccess;

  beforeEach(() => {
    ({ db, dbAccess } = createTestDatabase());
    resetMockCounters();
  });

  afterEach(() => {
    db.close();
  });

  it('should insert and retrieve logs by task id', () => {
    const log1: PublishLog = {
      id: 'log1', taskId: 'task1', level: 'info', message: 'Starting publish',
      createdAt: new Date().toISOString(),
    };
    const log2: PublishLog = {
      id: 'log2', taskId: 'task1', level: 'warn', message: 'Retrying',
      createdAt: new Date().toISOString(),
    };
    dbAccess.publish.insertPublishLog(log1);
    dbAccess.publish.insertPublishLog(log2);

    const logs = dbAccess.publish.getLogsByTask('task1');
    expect(logs.length).toBe(2, 'all logs for the given task should be returned');
  });
});

describe('DatabaseAccess - Publish Tasks Advanced', () => {
  let db: DB;
  let dbAccess: DatabaseAccess;

  beforeEach(() => {
    ({ db, dbAccess } = createTestDatabase());
    resetMockCounters();
  });

  afterEach(() => {
    db.close();
  });

  it('should get tasks filtered by multiple statuses', () => {
    const task1 = createMockPublishTask({ status: 'pending' });
    const task2 = createMockPublishTask({ status: 'publishing' });
    const task3 = createMockPublishTask({ status: 'published' });
    const task4 = createMockPublishTask({ status: 'failed' });
    dbAccess.publish.insertPublishTask(task1);
    dbAccess.publish.insertPublishTask(task2);
    dbAccess.publish.insertPublishTask(task3);
    dbAccess.publish.insertPublishTask(task4);

    const active = dbAccess.publish.getPublishTasksByStatuses(['pending', 'publishing']);
    expect(active.length).toBe(2);
    expect(active.map((t) => t.status).sort()).toEqual(['pending', 'publishing']);

    const done = dbAccess.publish.getPublishTasksByStatuses(['published', 'failed']);
    expect(done.length).toBe(2, 'tasks should be filtered by each status in the list');
  });

  it('should return empty array when given an empty status list', () => {
    const result = dbAccess.publish.getPublishTasksByStatuses([]);
    expect(result).toEqual([], 'empty status list should return empty result');
  });

  it('should get scheduled tasks with pending status and scheduledAt set', () => {
    const now = new Date();
    const future = new Date(now.getTime() + 3600000);
    const past = new Date(now.getTime() - 3600000);

    // Scheduled tasks are 'pending' status with a scheduled_at date
    const task1 = createMockPublishTask({ status: 'pending', scheduledAt: future.toISOString() });
    const task2 = createMockPublishTask({ status: 'pending', scheduledAt: past.toISOString() });
    const task3 = createMockPublishTask({ status: 'pending' }); // no scheduledAt
    dbAccess.publish.insertPublishTask(task1);
    dbAccess.publish.insertPublishTask(task2);
    dbAccess.publish.insertPublishTask(task3);

    const scheduled = dbAccess.publish.getScheduledPublishTasks();
    // Should return tasks that have scheduled_at set and status is pending
    expect(scheduled.length).toBe(2);
    for (const t of scheduled) {
      expect(t.status).toBe('pending');
      expect(t.scheduledAt).toBeDefined('scheduled tasks should have scheduledAt set');
    }
  });

  it('should get queue status with counts grouped per status', () => {
    dbAccess.publish.insertPublishTask(createMockPublishTask({ status: 'pending' }));
    dbAccess.publish.insertPublishTask(createMockPublishTask({ status: 'pending' }));
    dbAccess.publish.insertPublishTask(createMockPublishTask({ status: 'publishing' }));
    dbAccess.publish.insertPublishTask(createMockPublishTask({ status: 'published' }));
    dbAccess.publish.insertPublishTask(createMockPublishTask({ status: 'failed' }));
    dbAccess.publish.insertPublishTask(createMockPublishTask({ status: 'retrying' }));

    const status = dbAccess.publish.getQueueStatus();
    expect(status.total).toBe(6);
    expect(status.pending).toBe(2);
    expect(status.publishing).toBe(1);
    expect(status.published).toBe(1);
    expect(status.failed).toBe(1);
    expect(status.retrying).toBe(1, 'all task statuses should be counted in queue stats');
  });
});
