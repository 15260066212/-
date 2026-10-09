import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DB } from './db.js';
import { DatabaseAccess } from './db.js';
import {
  createTestDatabase,
  createMockArticle,
  createMockReview,
  createMockPublishTask,
  createMockPublishLog,
  createMockCredentials,
  createMockPipelineRun,
  resetMockCounters,
} from './test-helpers.js';
import { createEmptySession } from '@zemingengine/shared';

let db: DB;
let dbAccess: DatabaseAccess;

beforeEach(() => {
  ({ db, dbAccess } = createTestDatabase());
  resetMockCounters();
});

afterEach(() => {
  db.close();
});

describe('DatabaseAccess - Sessions', () => {
  it('should upsert and retrieve a session with correct data', () => {
    const session = createEmptySession('test-session-1');
    session.enterprise.fullName = '测试公司';
    dbAccess.sessions.upsertSession('test-session-1', session);

    const retrieved = dbAccess.sessions.getSession('test-session-1');
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe('test-session-1');
    expect(retrieved!.enterprise.fullName).toBe('测试公司', 'session enterprise data should be persisted correctly');
  });

  it('should update existing session on upsert', () => {
    const session = createEmptySession('test-session-2');
    dbAccess.sessions.upsertSession('test-session-2', session);

    session.enterprise.fullName = '更新后的公司';
    dbAccess.sessions.upsertSession('test-session-2', session);

    const retrieved = dbAccess.sessions.getSession('test-session-2');
    expect(retrieved!.enterprise.fullName).toBe('更新后的公司', 'upsert should overwrite existing session data');
  });

  it('should return undefined for non-existent session', () => {
    const result = dbAccess.sessions.getSession('non-existent');
    expect(result).toBeUndefined('non-existent session should return undefined');
  });

  it('should delete session and make it unretrievable', () => {
    const session = createEmptySession('test-session-3');
    dbAccess.sessions.upsertSession('test-session-3', session);
    dbAccess.sessions.deleteSession('test-session-3');
    expect(dbAccess.sessions.getSession('test-session-3')).toBeUndefined('deleted session should no longer be retrievable');
  });
});

describe('DatabaseAccess - Articles', () => {
  it('should insert and retrieve an article with all fields', () => {
    const article = createMockArticle();
    dbAccess.articles.insertArticle(article);

    const retrieved = dbAccess.articles.getArticle(article.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.title).toBe(article.title);
    expect(retrieved!.platform).toBe('weixin');
    expect(retrieved!.tags).toEqual(['测试', '教程'], 'article tags should be preserved');
  });

  it('should get articles filtered by sessionId', () => {
    const art1 = createMockArticle({ id: 'art1', sessionId: 'session-x' });
    const art2 = createMockArticle({ id: 'art2', sessionId: 'session-x' });
    const art3 = createMockArticle({ id: 'art3', sessionId: 'session-y' });
    dbAccess.articles.insertArticle(art1);
    dbAccess.articles.insertArticle(art2);
    dbAccess.articles.insertArticle(art3);

    const articles = dbAccess.articles.getArticlesBySession('session-x');
    expect(articles.length).toBe(2, 'should return only articles belonging to the specified session');
  });

  it('should update article status', () => {
    const article = createMockArticle();
    dbAccess.articles.insertArticle(article);
    dbAccess.articles.updateArticle(article.id, { status: 'approved' });

    const updated = dbAccess.articles.getArticle(article.id);
    expect(updated!.status).toBe('approved', 'article status should be updated');
  });

  it('should get articles filtered by status', () => {
    dbAccess.articles.insertArticle(createMockArticle({ id: 'a1', status: 'draft' }));
    dbAccess.articles.insertArticle(createMockArticle({ id: 'a2', status: 'approved' }));
    dbAccess.articles.insertArticle(createMockArticle({ id: 'a3', status: 'approved' }));

    const approved = dbAccess.articles.getArticlesByStatus('approved');
    expect(approved.length).toBe(2, 'should return only articles with the specified status');
  });
});

describe('DatabaseAccess - Reviews', () => {
  it('should insert and retrieve reviews by article id', () => {
    const article = createMockArticle();
    dbAccess.articles.insertArticle(article);
    const review = createMockReview(article.id);
    dbAccess.reviews.insertReview(review);

    const reviews = dbAccess.reviews.getReviewsByArticle(article.id);
    expect(reviews.length).toBe(1);
    expect(reviews[0].overallScore).toBe(85);
    expect(reviews[0].passed).toBe(true, 'review passed status should be persisted');
  });

  it('should get the latest review for an article', () => {
    const article = createMockArticle();
    dbAccess.articles.insertArticle(article);
    dbAccess.reviews.insertReview(createMockReview(article.id, 1));
    dbAccess.reviews.insertReview({ ...createMockReview(article.id, 2), overallScore: 92 });

    const latest = dbAccess.reviews.getLatestReview(article.id);
    expect(latest).toBeDefined();
    expect(latest!.round).toBe(2);
    expect(latest!.overallScore).toBe(92, 'latest review should have the highest round number');
  });

  it('should properly reconstruct nested dimension issues from storage', () => {
    const article = createMockArticle();
    dbAccess.articles.insertArticle(article);
    const review = createMockReview(article.id);
    dbAccess.reviews.insertReview(review);

    const retrieved = dbAccess.reviews.getLatestReview(article.id);
    expect(retrieved!.dimensions.quality.issues.length).toBe(1);
    expect(retrieved!.dimensions.quality.issues[0].description).toBe('字数偏少');
    expect(retrieved!.dimensions.compliance.issues.length).toBe(0, 'empty issue arrays should be preserved as empty');
  });
});

describe('DatabaseAccess - Publish Tasks', () => {
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

describe('DatabaseAccess - Credentials', () => {
  it('should upsert and retrieve a credential by platform', () => {
    const cred: PlatformCredentials = {
      platform: 'weixin',
      type: 'api_key',
      data: { apiKey: 'test-key-123', appId: 'wx123' },
      status: 'active',
    };
    dbAccess.credentials.upsertCredential('weixin', cred);

    const retrieved = dbAccess.credentials.getCredential('weixin');
    expect(retrieved).toBeDefined();
    expect(retrieved!.type).toBe('api_key');
    expect(retrieved!.data.apiKey).toBe('test-key-123', 'credential data should be fully persisted');
  });

  it('should update existing credential on upsert', () => {
    dbAccess.credentials.upsertCredential('zhihu', {
      platform: 'zhihu', type: 'cookie', data: { session: 'old' }, status: 'active',
    });
    dbAccess.credentials.upsertCredential('zhihu', {
      platform: 'zhihu', type: 'cookie', data: { session: 'new' }, status: 'active',
    });

    const retrieved = dbAccess.credentials.getCredential('zhihu');
    expect(retrieved!.data.session).toBe('new', 'upsert should overwrite existing credential data');
  });

  it('should update credential status independently', () => {
    dbAccess.credentials.upsertCredential('csdn', {
      platform: 'csdn', type: 'cookie', data: { session: 'x' }, status: 'active',
    });
    dbAccess.credentials.updateCredentialStatus('csdn', 'expired');

    const retrieved = dbAccess.credentials.getCredential('csdn');
    expect(retrieved!.status).toBe('expired', 'credential status should be updated without changing data');
  });

  it('should delete a credential and make it unretrievable', () => {
    dbAccess.credentials.upsertCredential('juejin', {
      platform: 'juejin', type: 'token', data: { token: 't' }, status: 'active',
    });
    dbAccess.credentials.deleteCredential('juejin');
    expect(dbAccess.credentials.getCredential('juejin')).toBeUndefined('deleted credential should no longer exist');
  });

  it('should return all stored credentials', () => {
    dbAccess.credentials.upsertCredential('weixin', { platform: 'weixin', type: 'api_key', data: { k: 'v' }, status: 'active' });
    dbAccess.credentials.upsertCredential('zhihu', { platform: 'zhihu', type: 'cookie', data: { s: 'v' }, status: 'active' });
    const all = dbAccess.credentials.getAllCredentials();
    expect(all.length).toBe(2, 'all inserted credentials should be returned');
  });
});

describe('DatabaseAccess - Pipeline Runs', () => {
  it('should insert and retrieve a pipeline run by id', () => {
    const run: PipelineRun = {
      id: 'run-1',
      sessionId: 'session-1',
      status: 'running',
      totalArticles: 5,
      completedArticles: 0,
      startedAt: new Date().toISOString(),
    };
    dbAccess.pipeline.insertPipelineRun(run);

    const retrieved = dbAccess.pipeline.getPipelineRun('run-1');
    expect(retrieved).toBeDefined();
    expect(retrieved!.status).toBe('running');
    expect(retrieved!.totalArticles).toBe(5, 'pipeline run totalArticles should be preserved');
  });

  it('should update pipeline run progress fields', () => {
    const run: PipelineRun = {
      id: 'run-2',
      sessionId: 'session-2',
      status: 'running',
      totalArticles: 3,
      completedArticles: 0,
      startedAt: new Date().toISOString(),
    };
    dbAccess.pipeline.insertPipelineRun(run);
    dbAccess.pipeline.updatePipelineRun('run-2', {
      completedArticles: 2,
      currentPlatform: 'zhihu',
      currentRound: 1,
    });

    const updated = dbAccess.pipeline.getPipelineRun('run-2');
    expect(updated!.completedArticles).toBe(2);
    expect(updated!.currentPlatform).toBe('zhihu', 'currentPlatform should be updated during progress');
  });

  it('should mark pipeline run as completed with finished timestamp', () => {
    const run: PipelineRun = {
      id: 'run-3',
      sessionId: 'session-3',
      status: 'running',
      totalArticles: 2,
      completedArticles: 0,
      startedAt: new Date().toISOString(),
    };
    dbAccess.pipeline.insertPipelineRun(run);
    dbAccess.pipeline.updatePipelineRun('run-3', {
      status: 'completed',
      completedArticles: 2,
      completedAt: new Date().toISOString(),
    });

    const updated = dbAccess.pipeline.getPipelineRun('run-3');
    expect(updated!.status).toBe('completed');
    expect(updated!.completedAt).toBeDefined('completedAt should be set when pipeline finishes');
  });

  it('should get the latest pipeline run by session id', () => {
    dbAccess.pipeline.insertPipelineRun({
      id: 'run-old', sessionId: 'session-4', status: 'completed', totalArticles: 1, completedArticles: 1,
      startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T01:00:00Z',
    });
    dbAccess.pipeline.insertPipelineRun({
      id: 'run-new', sessionId: 'session-4', status: 'running', totalArticles: 3, completedArticles: 0,
      startedAt: '2026-08-03T00:00:00Z',
    });

    const latest = dbAccess.pipeline.getLatestPipelineRunBySession('session-4');
    expect(latest).toBeDefined();
    expect(latest!.id).toBe('run-new', 'the most recently started run should be returned');
  });
});

describe('DatabaseAccess - Publish Tasks Advanced', () => {
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

describe('DatabaseAccess - Review Advanced', () => {
  it('should return true when article has a passing review', () => {
    const article = createMockArticle();
    article.id = 'art-review-pass';
    dbAccess.articles.insertArticle(article);

    const review = createMockReview('art-review-pass', 1);
    review.passed = true;
    review.overallScore = 85;
    dbAccess.reviews.insertReview(review);

    expect(dbAccess.reviews.hasPassingReview('art-review-pass')).toBe(true, 'article with a passed review should return true');
  });

  it('should return false when article has only a failing review', () => {
    const article = createMockArticle();
    article.id = 'art-review-fail';
    dbAccess.articles.insertArticle(article);

    const review = createMockReview('art-review-fail', 1);
    review.passed = false;
    review.overallScore = 40;
    dbAccess.reviews.insertReview(review);

    expect(dbAccess.reviews.hasPassingReview('art-review-fail')).toBe(false, 'article with only failed reviews should return false');
  });

  it('should return false when article has no reviews at all', () => {
    expect(dbAccess.reviews.hasPassingReview('no-review-article')).toBe(false, 'article with no reviews should return false');
  });

  it('should get latest review status with passed and score', () => {
    const article = createMockArticle();
    article.id = 'art-latest-status';
    dbAccess.articles.insertArticle(article);

    const r1 = createMockReview('art-latest-status', 1);
    r1.passed = false;
    r1.overallScore = 50;
    dbAccess.reviews.insertReview(r1);

    const r2 = createMockReview('art-latest-status', 2);
    r2.passed = true;
    r2.overallScore = 80;
    dbAccess.reviews.insertReview(r2);

    const status = dbAccess.reviews.getLatestReviewStatus('art-latest-status');
    expect(status).not.toBeNull();
    expect(status!.passed).toBe(true);
    expect(status!.overallScore).toBe(80);
    expect(status!.round).toBe(2, 'latest review should have the highest round number');
  });

  it('should return null for latest review status when no reviews exist', () => {
    const status = dbAccess.reviews.getLatestReviewStatus('nonexistent-article');
    expect(status).toBeNull('article with no reviews should return null status');
  });
});

describe('DatabaseAccess - Credentials Advanced', () => {
  it('should get credentials filtered by platform', () => {
    dbAccess.credentials.upsertCredential('weixin', {
      platform: 'weixin',
      accountId: 'default',
      type: 'api_key',
      data: { key: 'value123' },
      status: 'active',
    });
    dbAccess.credentials.upsertCredential('zhihu', {
      platform: 'zhihu',
      accountId: 'default',
      type: 'cookie',
      data: { cookie: 'abc=123' },
      status: 'active',
    });

    const weixinCreds = dbAccess.credentials.getCredentialsByPlatform('weixin');
    expect(weixinCreds.length).toBe(1);
    expect(weixinCreds[0].platform).toBe('weixin');

    const zhihuCreds = dbAccess.credentials.getCredentialsByPlatform('zhihu');
    expect(zhihuCreds.length).toBe(1);
    expect(zhihuCreds[0].platform).toBe('zhihu', 'credentials should be filterable by platform');
  });

  it('should handle multi-account credentials on the same platform', () => {
    dbAccess.credentials.upsertCredential('csdn', {
      platform: 'csdn',
      accountId: 'account-a',
      accountName: '账号A',
      type: 'cookie',
      data: { cookie: 'a_cookie' },
      status: 'active',
    });
    dbAccess.credentials.upsertCredential('csdn', {
      platform: 'csdn',
      accountId: 'account-b',
      accountName: '账号B',
      type: 'cookie',
      data: { cookie: 'b_cookie' },
      status: 'active',
    });

    const allCsdn = dbAccess.credentials.getCredentialsByPlatform('csdn');
    expect(allCsdn.length).toBe(2);

    const accountA = dbAccess.credentials.getCredential('csdn', 'user_default', 'account-a');
    expect(accountA).toBeDefined();
    expect(accountA!.accountId).toBe('account-a');
    expect(accountA!.accountName).toBe('账号A');

    const accountB = dbAccess.credentials.getCredential('csdn', 'user_default', 'account-b');
    expect(accountB).toBeDefined();
    expect(accountB!.accountId).toBe('account-b', 'each account credential should be retrievable by accountId');
  });

  it('should return credentials due for health check', () => {
    // Insert an active credential
    dbAccess.credentials.upsertCredential('juejin', {
      platform: 'juejin',
      accountId: 'default',
      type: 'cookie',
      data: { cookie: 'test' },
      status: 'active',
    });

    const due = dbAccess.credentials.getCredentialsDueForCheck(5);
    // Newly inserted credential with no last_checked_at should be due
    expect(due.length).toBe(1, 'new credentials with no last_checked_at should be due for check');
  });

  it('should record health check and preserve active status when valid', () => {
    dbAccess.credentials.upsertCredential('sohu', {
      platform: 'sohu',
      accountId: 'default',
      type: 'cookie',
      data: { cookie: 'test' },
      status: 'active',
    });

    dbAccess.credentials.recordHealthCheck('sohu', 'user_default', 'valid', 'OK', 'default');

    const cred = dbAccess.credentials.getCredential('sohu');
    expect(cred).toBeDefined();
    expect(cred!.status).toBe('active', 'valid health check should keep credential active');
  });
});

describe('DatabaseAccess - Users', () => {
  it('should insert and find a user by username', () => {
    const user = {
      id: 'user-test-1',
      username: 'testuser',
      displayName: 'Test User',
      role: 'user' as const,
      apiKey: 'test-api-key-123',
      passwordHash: 'hash123',
      createdAt: new Date().toISOString(),
    };
    dbAccess.users.insertUser(user);

    const found = dbAccess.users.getUserByUsername('testuser');
    expect(found).toBeDefined();
    expect(found!.id).toBe('user-test-1');
    expect(found!.username).toBe('testuser');
    expect(found!.displayName).toBe('Test User', 'user displayName should be persisted');
  });

  it('should find a user by api key', () => {
    const user = {
      id: 'user-test-2',
      username: 'testuser2',
      displayName: 'Test User 2',
      role: 'admin' as const,
      apiKey: 'api-key-456',
      createdAt: new Date().toISOString(),
    };
    dbAccess.users.insertUser(user);

    const found = dbAccess.users.getUserByApiKey('api-key-456');
    expect(found).toBeDefined();
    expect(found!.username).toBe('testuser2');
    expect(found!.role).toBe('admin', 'user role should be preserved');
  });

  it('should find a user by id', () => {
    const user = {
      id: 'user-test-3',
      username: 'testuser3',
      displayName: 'Test User 3',
      role: 'user' as const,
      apiKey: 'api-key-789',
      createdAt: new Date().toISOString(),
    };
    dbAccess.users.insertUser(user);

    const found = dbAccess.users.getUserById('user-test-3');
    expect(found).toBeDefined();
    expect(found!.username).toBe('testuser3', 'user should be retrievable by id');
  });

  it('should return undefined for non-existent users', () => {
    expect(dbAccess.users.getUserByUsername('nonexistent')).toBeUndefined();
    expect(dbAccess.users.getUserByApiKey('no-such-key')).toBeUndefined();
    expect(dbAccess.users.getUserById('no-such-id')).toBeUndefined('non-existent user id should return undefined');
  });

  it('should list all users with correct count', () => {
    const initialCount = dbAccess.users.listUsers().length;
    dbAccess.users.insertUser({
      id: 'user-list-1',
      username: 'listuser1',
      displayName: 'List User 1',
      role: 'user',
      apiKey: 'list-key-1',
      createdAt: new Date().toISOString(),
    });
    dbAccess.users.insertUser({
      id: 'user-list-2',
      username: 'listuser2',
      displayName: 'List User 2',
      role: 'user',
      apiKey: 'list-key-2',
      createdAt: new Date().toISOString(),
    });

    const users = dbAccess.users.listUsers();
    expect(users.length).toBe(initialCount + 2, 'listUsers should return all users including newly inserted ones');
  });

  it('should delete a user and make them unretrievable', () => {
    dbAccess.users.insertUser({
      id: 'user-delete-1',
      username: 'deleteuser',
      displayName: 'Delete User',
      role: 'user',
      apiKey: 'delete-key',
      createdAt: new Date().toISOString(),
    });

    expect(dbAccess.users.getUserById('user-delete-1')).toBeDefined();
    dbAccess.users.deleteUser('user-delete-1');
    expect(dbAccess.users.getUserById('user-delete-1')).toBeUndefined('deleted user should no longer be retrievable');
  });

  it('should prevent deletion of the default user', () => {
    // Default user should be protected from deletion (throws error)
    expect(() => dbAccess.users.deleteUser('user_default')).toThrow();
    // Default user should still exist after the attempted deletion
    expect(dbAccess.users.getUserById('user_default')).toBeDefined('default user should survive attempted deletion');
  });

  it('should regenerate user api key with a new non-empty value', () => {
    dbAccess.users.insertUser({
      id: 'user-regen-1',
      username: 'regenuser',
      displayName: 'Regen User',
      role: 'user',
      apiKey: 'old-api-key',
      createdAt: new Date().toISOString(),
    });

    const updated = dbAccess.users.regenerateUserApiKey('user-regen-1');
    expect(updated).toBeDefined();
    expect(updated!.apiKey).not.toBe('old-api-key');
    expect(updated!.apiKey.length).toBeGreaterThan(0, 'regenerated api key should be non-empty');
  });
});

describe('DatabaseAccess - Monitor Stats', () => {
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
