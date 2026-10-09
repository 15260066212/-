import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Article, PublishTask, PlatformCredentials } from '@zemingengine/shared';
import { executePublishWithHandling } from './publish-utils.js';

function createMockArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: 'article-1',
    sessionId: 'session-1',
    platform: 'weixin',
    contentType: 'tutorial',
    title: '测试文章',
    contentMarkdown: '# 测试',
    tags: ['test'],
    wordCount: 100,
    status: 'draft',
    generationRound: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function createMockTask(overrides: Partial<PublishTask> = {}): PublishTask {
  return {
    id: 'task-1',
    articleId: 'article-1',
    platform: 'weixin',
    status: 'pending',
    method: 'api',
    retryCount: 0,
    maxRetries: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function createMockCredentials(): PlatformCredentials {
  return {
    platform: 'weixin',
    accountId: 'acc1',
    type: 'cookie',
    data: { cookie: 'test' },
    status: 'active',
  };
}

function createMockDb() {
  return {
    publish: {
      updatePublishTask: vi.fn(),
    },
    articles: {
      updateArticle: vi.fn(),
    },
  };
}

function createMockPublisher(publishResult: { success: boolean; postId?: string; postUrl?: string; error?: string }) {
  return {
    publishWithRetry: vi.fn().mockResolvedValue(publishResult),
  };
}

describe('executePublishWithHandling', () => {
  let article: Article;
  let task: PublishTask;
  let credentials: PlatformCredentials;

  beforeEach(() => {
    article = createMockArticle();
    task = createMockTask();
    credentials = createMockCredentials();
  });

  it('发布成功时更新任务为 published 状态', async () => {
    const db = createMockDb();
    const publisher = createMockPublisher({
      success: true,
      postId: 'post_123',
      postUrl: 'https://example.com/post/123',
    });

    await executePublishWithHandling(db as any, publisher as any, task, article, credentials);

    expect(db.publish.updatePublishTask).toHaveBeenCalledWith('task-1', expect.objectContaining({
      status: 'published',
      platformPostId: 'post_123',
      platformPostUrl: 'https://example.com/post/123',
    }));
    expect(db.articles.updateArticle).toHaveBeenCalledWith('article-1', expect.objectContaining({
      status: 'published',
      publishUrl: 'https://example.com/post/123',
    }));
  });

  it('发布失败时更新任务为 failed 状态并设置 failureType', async () => {
    const db = createMockDb();
    const publisher = createMockPublisher({
      success: false,
      error: 'Network timeout: connection refused',
    });

    await executePublishWithHandling(db as any, publisher as any, task, article, credentials);

    expect(db.publish.updatePublishTask).toHaveBeenCalledWith('task-1', expect.objectContaining({
      status: 'failed',
      errorMessage: 'Network timeout: connection refused',
      failureType: 'network',
    }));
    expect(db.articles.updateArticle).toHaveBeenCalledWith('article-1', expect.objectContaining({
      status: 'failed',
    }));
  });

  it('发布抛出异常时捕获并标记为 failed', async () => {
    const db = createMockDb();
    const publisher = {
      publishWithRetry: vi.fn().mockRejectedValue(new Error('Unexpected crash')),
    };

    await executePublishWithHandling(db as any, publisher as any, task, article, credentials);

    expect(db.publish.updatePublishTask).toHaveBeenCalledWith('task-1', expect.objectContaining({
      status: 'failed',
      errorMessage: 'Unexpected crash',
    }));
    expect(db.articles.updateArticle).toHaveBeenCalledWith('article-1', expect.objectContaining({
      status: 'failed',
    }));
  });

  it('成功但无 postUrl 时不设置 article.publishUrl', async () => {
    const db = createMockDb();
    const publisher = createMockPublisher({
      success: true,
      postId: 'post_123',
    });

    await executePublishWithHandling(db as any, publisher as any, task, article, credentials);

    expect(db.articles.updateArticle).toHaveBeenCalledWith('article-1', expect.objectContaining({
      status: 'published',
    }));
    const updateArg = db.articles.updateArticle.mock.calls[0][1];
    expect(updateArg.publishUrl).toBeUndefined();
  });

  it('使用 logPrefix 时输出日志前缀', async () => {
    const db = createMockDb();
    const publisher = createMockPublisher({ success: true, postId: '1' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await executePublishWithHandling(db as any, publisher as any, task, article, credentials, '[Test]');

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[Test]'));
    logSpy.mockRestore();
  });

  it('无 logPrefix 时不输出日志', async () => {
    const db = createMockDb();
    const publisher = createMockPublisher({ success: true, postId: '1' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await executePublishWithHandling(db as any, publisher as any, task, article, credentials);

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
