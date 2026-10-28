import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Article, PublishTask, PlatformCredentials } from '@zemingengine/shared';
import { executePublishWithHandling } from './publish-utils.js';
import {
  createMockArticle,
  createMockPublishTask,
  createMockCredentials,
  createTestDatabase,
} from './test-helpers.js';

/**
 * Tests for executePublishWithHandling.
 *
 * Draft-first flow: executePublishWithHandling now calls saveDraftWithRetry.
 * On success the task/article status is set to 'draft_saved' (not 'published').
 */
describe('executePublishWithHandling', () => {
  let article: Article;
  let task: PublishTask;
  let credentials: PlatformCredentials;
  let dbAccess: ReturnType<typeof createTestDatabase>['dbAccess'];

  beforeEach(() => {
    const { dbAccess: dba } = createTestDatabase();
    dbAccess = dba;

    article = createMockArticle({ id: 'article-1', sessionId: 'session-1' });
    task = createMockPublishTask({ id: 'task-1', articleId: 'article-1' });
    credentials = createMockCredentials({ accountId: 'acc1', data: { cookie: 'test' } });

    // Insert test data into the real database
    dbAccess.articles.insertArticle(article);
    dbAccess.publish.insertPublishTask(task);
  });

  function createMockPublisher(saveResult: { success: boolean; postId?: string; postUrl?: string; error?: string; verificationStatus?: string; verificationMessage?: string }) {
    return {
      saveDraftWithRetry: vi.fn().mockResolvedValue(saveResult),
    };
  }

  it('保存草稿成功时任务状态变为 draft_saved 且文章状态同步为 draft_saved', async () => {
    const publisher = createMockPublisher({
      success: true,
      postId: 'draft_123',
      postUrl: 'https://example.com/draft/123',
    });

    await executePublishWithHandling(dbAccess as any, publisher as any, task, article, credentials);

    // Verify final state by reading from the database
    const updatedTask = dbAccess.publish.getPublishTask('task-1');
    const updatedArticle = dbAccess.articles.getArticle('article-1');

    expect(updatedTask?.status).toBe('draft_saved');
    expect(updatedTask?.platformPostId).toBe('draft_123');
    expect(updatedTask?.platformPostUrl).toBe('https://example.com/draft/123');
    // publishedAt should NOT be set — only confirm-published sets it
    expect(updatedTask?.publishedAt).toBeFalsy();

    expect(updatedArticle?.status).toBe('draft_saved');
    expect(updatedArticle?.publishUrl).toBe('https://example.com/draft/123');
  });

  it('保存草稿失败时任务状态变为 failed 并设置正确的 failureType', async () => {
    const publisher = createMockPublisher({
      success: false,
      error: 'Network timeout: connection refused',
    });

    await executePublishWithHandling(dbAccess as any, publisher as any, task, article, credentials);

    const updatedTask = dbAccess.publish.getPublishTask('task-1');
    const updatedArticle = dbAccess.articles.getArticle('article-1');

    expect(updatedTask?.status).toBe('failed');
    expect(updatedTask?.errorMessage).toBe('Network timeout: connection refused');
    expect(updatedTask?.failureType).toBe('network');

    expect(updatedArticle?.status).toBe('failed');
  });

  it('保存草稿抛出异常时捕获异常并标记为 failed', async () => {
    const publisher = {
      saveDraftWithRetry: vi.fn().mockRejectedValue(new Error('Unexpected crash')),
    };

    await executePublishWithHandling(dbAccess as any, publisher as any, task, article, credentials);

    const updatedTask = dbAccess.publish.getPublishTask('task-1');
    const updatedArticle = dbAccess.articles.getArticle('article-1');

    expect(updatedTask?.status).toBe('failed');
    expect(updatedTask?.errorMessage).toBe('Unexpected crash');

    expect(updatedArticle?.status).toBe('failed');
  });

  it('保存草稿成功但无 postUrl 时文章不设置 publishUrl', async () => {
    const publisher = createMockPublisher({
      success: true,
      postId: 'draft_123',
    });

    await executePublishWithHandling(dbAccess as any, publisher as any, task, article, credentials);

    const updatedArticle = dbAccess.articles.getArticle('article-1');
    expect(updatedArticle?.status).toBe('draft_saved');
    expect(updatedArticle?.publishUrl).toBeUndefined();
  });

  it('使用 logPrefix 时输出日志前缀', async () => {
    const publisher = createMockPublisher({ success: true, postId: '1' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await executePublishWithHandling(dbAccess as any, publisher as any, task, article, credentials, '[Test]');

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[Test]'));
    logSpy.mockRestore();
  });

  it('无 logPrefix 时不输出日志', async () => {
    const publisher = createMockPublisher({ success: true, postId: '1' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await executePublishWithHandling(dbAccess as any, publisher as any, task, article, credentials);

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('publisher 的 onTaskUpdate 回调会更新任务状态', async () => {
    const publisher = {
      saveDraftWithRetry: vi.fn().mockImplementation(
        (_task: unknown, _article: unknown, _creds: unknown, onTaskUpdate: (updates: Partial<PublishTask>) => void) => {
          // Simulate the publisher calling the update callback during draft saving
          onTaskUpdate({ errorMessage: 'In progress...' });
          return Promise.resolve({ success: true, postId: 'draft_final' });
        },
      ),
    };

    await executePublishWithHandling(dbAccess as any, publisher as any, task, article, credentials);

    // The final state should reflect the success (draft_saved), not the intermediate update
    const updatedTask = dbAccess.publish.getPublishTask('task-1');
    expect(updatedTask?.status).toBe('draft_saved');
    expect(updatedTask?.platformPostId).toBe('draft_final');
  });

  it('未知错误类型分类为 unknown', async () => {
    const publisher = createMockPublisher({
      success: false,
      error: 'Some completely random error message',
    });

    await executePublishWithHandling(dbAccess as any, publisher as any, task, article, credentials);

    const updatedTask = dbAccess.publish.getPublishTask('task-1');
    expect(updatedTask?.status).toBe('failed');
    expect(updatedTask?.failureType).toBe('unknown');
  });
});
