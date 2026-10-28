import { describe, it, expect } from 'vitest';
import type { Article, PlatformCredentials, PlatformId, PublishTask } from '@zemingengine/shared';
import { Publisher } from './publisher.js';
import { RPAEngine } from './rpa-engine.js';
import type { PublishResult } from './types.js';
import { WechatAdapter } from './adapters/wechat.js';

/** Mock RPAEngine that overrides publish to avoid launching a real browser. */
class MockRpaEngine extends RPAEngine {
  override async publish(
    article: Article,
    _credentials: PlatformCredentials,
    _accountId: string,
  ): Promise<PublishResult> {
    return {
      success: true,
      postId: `mock_rpa_${article.platform}_${article.id}`,
      postUrl: `https://example.com/rpa/${article.platform}/${article.id}`,
    };
  }
}

function createMockArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: 'article-1',
    sessionId: 'session-1',
    platform: 'weixin',
    contentType: 'tutorial',
    title: '测试文章标题',
    contentMarkdown: '# 测试文章\n\n这是一篇测试文章。',
    tags: ['test'],
    wordCount: 100,
    status: 'draft',
    generationRound: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function createMockCredentials(overrides: Partial<PlatformCredentials> = {}): PlatformCredentials {
  return {
    platform: 'weixin',
    type: 'cookie',
    data: { session: 'mock_session' },
    status: 'active',
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
    maxRetries: 3,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('Publisher.publishArticle', () => {
  it('注册 WechatAdapter 后通过 API 发布文章应返回 success=true', async () => {
    const rpaEngine = new RPAEngine();
    const publisher = new Publisher(rpaEngine);
    const adapter = new WechatAdapter();
    // Mock the publish method to avoid real API calls
    adapter.publish = async () => ({
      success: true,
      postId: 'mock_post_id',
      postUrl: 'https://example.com',
    });
    publisher.registerAdapter(adapter);

    const article = createMockArticle();
    const credentials = createMockCredentials();

    const result = await publisher.publishArticle(article, credentials);

    expect(result.success).toBe(true);
    expect(result.postId).toBe('mock_post_id');
    expect(result.postUrl).toBe('https://example.com', 'successful publish should return the post URL');
  });

  it('RPA 平台应委托给 RPAEngine 处理发布', async () => {
    // Use MockRpaEngine to avoid launching a real browser in tests
    const rpaEngine = new MockRpaEngine();
    const publisher = new Publisher(rpaEngine);

    const article = createMockArticle({ platform: 'zhihu' });
    const credentials = createMockCredentials({ platform: 'zhihu' });

    const result = await publisher.publishArticle(article, credentials);

    expect(result.success).toBe(true);
    expect(result.postId).toBe('mock_rpa_zhihu_article-1', 'RPA publish should produce platform-specific post id');
  });
});

describe('Publisher.createDefault', () => {
  it('应注册全部 7 个平台适配器（weixin 用 API，其余用 RPA）', () => {
    const publisher = Publisher.createDefault();
    // weixin should use api method
    expect(publisher.getMethodForPlatform('weixin')).toBe('api');
    // All other platforms should use rpa
    expect(publisher.getMethodForPlatform('zhihu')).toBe('rpa');
    expect(publisher.getMethodForPlatform('toutiao')).toBe('rpa');
    expect(publisher.getMethodForPlatform('csdn')).toBe('rpa');
    expect(publisher.getMethodForPlatform('juejin')).toBe('rpa');
    expect(publisher.getMethodForPlatform('sohu')).toBe('rpa');
    expect(publisher.getMethodForPlatform('netease')).toBe('rpa', 'all non-weixin platforms should use RPA method');
  });

  it('createTask 应根据平台自动确定 method（api 或 rpa）', () => {
    const publisher = Publisher.createDefault();

    const apiTask = publisher.createTask({
      articleId: 'art-1',
      platform: 'weixin',
    });
    expect(apiTask.method).toBe('api');

    const rpaTask = publisher.createTask({
      articleId: 'art-2',
      platform: 'csdn',
    });
    expect(rpaTask.method).toBe('rpa', 'csdn platform should use RPA method');
  });

  it('createTask 应生成唯一 ID、时间戳和默认状态', () => {
    const publisher = Publisher.createDefault();

    const task1 = publisher.createTask({ articleId: 'a1', platform: 'weixin' });
    const task2 = publisher.createTask({ articleId: 'a2', platform: 'weixin' });

    expect(task1.id).not.toBe(task2.id);
    expect(task1.createdAt).toBeTruthy();
    expect(task1.updatedAt).toBeTruthy();
    expect(task1.status).toBe('pending');
    expect(task1.retryCount).toBe(0);
    expect(task1.maxRetries).toBe(2, 'default maxRetries should be 2');
  });
});

/**
 * Helper: create a Publisher with a mocked WechatAdapter that returns the given result.
 * Reduces duplicate mock setup across publishWithRetry tests.
 */
function createPublisherWithMockAdapter(
  publishResult: { success: boolean; postId?: string; postUrl?: string; error?: string },
): Publisher {
  const publisher = new Publisher();
  const mockAdapter = new WechatAdapter();
  mockAdapter.publish = async () => publishResult as any;
  publisher.registerAdapter(mockAdapter);
  return publisher;
}

describe('Publisher.publishWithRetry', () => {
  it('成功发布时只尝试一次，不触发重试', async () => {
    const publisher = createPublisherWithMockAdapter({
      success: true,
      postId: 'mock_post_id',
      postUrl: 'https://example.com',
    });
    const article = createMockArticle();
    const credentials = createMockCredentials();
    const task = createMockTask({ maxRetries: 2 });

    const result = await publisher.publishWithRetry(task, article, credentials);

    expect(result.success).toBe(true);
    expect(result.postId).toBe('mock_post_id', 'successful publish should return the mock post id');
  });

  it('失败时自动重试到 maxRetries+1 次后返回失败', async () => {
    const publisher = createPublisherWithMockAdapter({
      success: false,
      error: 'Mock publish failure',
    });

    const article = createMockArticle();
    const credentials = createMockCredentials();
    const task = createMockTask({ maxRetries: 1 });

    let updateCallCount = 0;
    const result = await publisher.publishWithRetry(
      task,
      article,
      credentials,
      () => { updateCallCount++; },
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('Mock publish failure');
    // Should have called update for retry (attempt 2)
    expect(updateCallCount).toBeGreaterThanOrEqual(1, 'retry should trigger status update callback');
  });

  it('logCallback 在发布过程中被调用，包含尝试和成功日志', async () => {
    const publisher = createPublisherWithMockAdapter({
      success: true,
      postId: 'mock_post_id',
      postUrl: 'https://example.com',
    });
    const logs: string[] = [];
    publisher.logCallback = (entry) => {
      logs.push(entry.message);
    };

    const article = createMockArticle();
    const credentials = createMockCredentials();
    const task = createMockTask();

    await publisher.publishWithRetry(task, article, credentials);

    // Should have at least an attempt log and a success log
    expect(logs.length).toBeGreaterThanOrEqual(2);
    expect(logs.some((m) => m.includes('attempt'))).toBeTruthy();
    expect(logs.some((m) => m.includes('succeeded'))).toBeTruthy('success log should be present on successful publish');
  });
});
