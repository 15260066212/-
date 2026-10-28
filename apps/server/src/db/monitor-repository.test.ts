import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DB } from '../db.js';
import { DatabaseAccess } from '../db.js';
import {
  createTestDatabase,
  createMockArticle,
  createMockPublishTask,
  createMockPipelineRun,
  resetMockCounters,
} from '../test-helpers.js';
import { createEmptySession } from '@zemingengine/shared';

describe('DatabaseAccess - Monitor Stats', () => {
  let db: DB;
  let dbAccess: DatabaseAccess;

  beforeEach(() => {
    ({ db, dbAccess } = createTestDatabase());
    resetMockCounters();
  });

  afterEach(() => {
    db.close();
  });

  it('should get article stats with total count', () => {
    const sessionId = 'stat-session-1';
    dbAccess.articles.insertArticle(createMockArticle({ sessionId, status: 'draft' }));
    dbAccess.articles.insertArticle(createMockArticle({ sessionId, status: 'published' }));
    dbAccess.articles.insertArticle(createMockArticle({ sessionId, status: 'failed' }));

    const stats = dbAccess.monitor.getArticleStats();
    expect(stats.total).toBe(3, 'total article count should include all inserted articles');
  });

  it('should get session count and increment after upsert', () => {
    const initialCount = dbAccess.monitor.getSessionCount();
    const session = createEmptySession('stat-session-count');
    dbAccess.sessions.upsertSession('stat-session-count', session);

    const newCount = dbAccess.monitor.getSessionCount();
    expect(newCount).toBe(initialCount + 1, 'session count should increase by 1 after inserting a new session');
  });

  it('should get credential stats with active and expired counts', () => {
    dbAccess.credentials.upsertCredential('weixin', {
      platform: 'weixin',
      accountId: 'default',
      type: 'api_key',
      data: { key: 'val' },
      status: 'active',
    });
    dbAccess.credentials.upsertCredential('zhihu', {
      platform: 'zhihu',
      accountId: 'default',
      type: 'cookie',
      data: { c: 'v' },
      status: 'expired',
    });

    const stats = dbAccess.monitor.getCredentialStats();
    expect(stats.total).toBe(2);
    expect(stats.active).toBe(1);
    expect(stats.expired).toBe(1, 'active and expired credentials should be counted separately');
  });

  it('should get publish task stats with total count', () => {
    dbAccess.publish.insertPublishTask(createMockPublishTask({ status: 'pending' }));
    dbAccess.publish.insertPublishTask(createMockPublishTask({ status: 'published' }));
    dbAccess.publish.insertPublishTask(createMockPublishTask({ status: 'failed' }));

    const stats = dbAccess.monitor.getPublishTaskStats();
    expect(stats.total).toBe(3, 'total task count should include all statuses');
  });

  it('should get pipeline run stats with completed and running counts', () => {
    dbAccess.pipeline.insertPipelineRun({
      id: 'run-stat-1', sessionId: 'stat-sess', status: 'completed',
      totalArticles: 5, completedArticles: 5,
      startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T02:00:00Z',
    });
    dbAccess.pipeline.insertPipelineRun({
      id: 'run-stat-2', sessionId: 'stat-sess', status: 'running',
      totalArticles: 3, completedArticles: 1,
      startedAt: '2026-01-02T00:00:00Z',
    });

    const stats = dbAccess.monitor.getPipelineRunStats();
    expect(stats.total).toBe(2);
    expect(stats.completed).toBe(1);
    expect(stats.running).toBe(1, 'completed and running pipelines should be counted separately');
  });

  it('should get articles grouped by platform stats', () => {
    dbAccess.articles.insertArticle(createMockArticle({ platform: 'weixin' }));
    dbAccess.articles.insertArticle(createMockArticle({ platform: 'zhihu' }));
    dbAccess.articles.insertArticle(createMockArticle({ platform: 'csdn' }));

    const stats = dbAccess.monitor.getArticlesByPlatformStats();
    expect(Array.isArray(stats)).toBe(true);
    expect(stats.length).toBeGreaterThan(0, 'platform stats should have at least one entry');
  });
});
