import Database from 'better-sqlite3';
import type { DB } from './db.js';
import { DatabaseAccess } from './db.js';
import { initDatabase } from './schema.js';
import type {
  Article,
  ReviewResult,
  PublishTask,
  PublishLog,
  PlatformCredentials,
  PipelineRun,
} from '@zemingengine/shared';

/** Create an in-memory database with full schema (all migrations applied). */
export function createTestDatabase(): { db: DB; dbAccess: DatabaseAccess } {
  const db = new Database(':memory:');
  initDatabase(db);
  const dbAccess = new DatabaseAccess(db);
  return { db, dbAccess };
}

let articleCounter = 0;

/** Create a mock Article with deterministic ID and all required fields. */
export function createMockArticle(overrides: Partial<Article> = {}): Article {
  articleCounter++;
  return {
    id: `art_test_${articleCounter}`,
    sessionId: 'test-session',
    platform: 'weixin',
    contentType: 'tutorial',
    title: '测试文章标题',
    contentMarkdown: '# 测试\n\n这是测试内容。',
    contentHtml: '<h1>测试</h1><p>这是测试内容。</p>',
    contentPlain: '测试内容',
    tags: ['测试', '教程'],
    summary: '测试摘要',
    wordCount: 500,
    status: 'draft',
    generationRound: 1,
    reviewRound: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Create a mock ReviewResult with all 8 dimensions. */
export function createMockReview(articleId: string, round = 1): ReviewResult {
  return {
    articleId,
    round,
    passed: true,
    overallScore: 85,
    dimensions: {
      compliance: { score: 100, issues: [] },
      quality: { score: 90, issues: [{ dimension: 'quality', severity: 'low', description: '字数偏少' }] },
      seo: { score: 80, issues: [] },
      brand: { score: 85, issues: [] },
      originality: { score: 90, issues: [] },
      platform_adaptation: { score: 80, issues: [] },
      readability: { score: 95, issues: [] },
      safety: { score: 100, issues: [] },
    },
    issues: [
      { dimension: 'quality', severity: 'low', description: '字数偏少', suggestion: '增加内容' },
    ],
    suggestions: ['增加内容深度', '优化段落结构'],
    reviewedAt: '2026-01-01T00:00:00.000Z',
  };
}

/** Create a mock PublishTask. */
export function createMockPublishTask(overrides: Partial<PublishTask> = {}): PublishTask {
  return {
    id: `task_test_${++articleCounter}`,
    articleId: 'art_test_1',
    platform: 'weixin',
    accountId: 'default',
    status: 'pending',
    method: 'api',
    retryCount: 0,
    maxRetries: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Create a mock PublishLog. */
export function createMockPublishLog(overrides: Partial<PublishLog> = {}): PublishLog {
  return {
    id: `log_test_${++articleCounter}`,
    taskId: 'task_test_1',
    level: 'info',
    message: 'Published successfully',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Create a mock PlatformCredentials. */
export function createMockCredentials(overrides: Partial<PlatformCredentials> = {}): PlatformCredentials {
  return {
    platform: 'weixin',
    accountId: 'default',
    type: 'cookie',
    data: { cookie: 'test_cookie=value' },
    status: 'active',
    lastValidatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Create a mock PipelineRun. */
export function createMockPipelineRun(overrides: Partial<PipelineRun> = {}): PipelineRun {
  return {
    id: `run_test_${++articleCounter}`,
    sessionId: 'test-session',
    status: 'running',
    totalArticles: 5,
    completedArticles: 0,
    startedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Reset the counter (useful for test isolation). */
export function resetMockCounters(): void {
  articleCounter = 0;
}
