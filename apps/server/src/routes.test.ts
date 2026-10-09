import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DB } from './db.js';
import { DatabaseAccess } from './db.js';
import { createTestDatabase } from './test-helpers.js';
import { createEmptySession } from '@zemingengine/shared';
import type {
  Article,
  ReviewResult,
  PlatformCredentials,
  PipelineRun,
  PublishTask,
} from '@zemingengine/shared';
import { createArticleRoutes } from './routes/article.js';
import { createReviewRoutes } from './routes/review.js';
import { createCredentialRoutes } from './routes/credentials.js';
import { createSessionRoutes } from './routes/session.js';
import { createPipelineRoutes } from './routes/pipeline.js';

let db: DB;
let dbAccess: DatabaseAccess;

beforeEach(() => {
  ({ db, dbAccess } = createTestDatabase());
});

afterEach(() => {
  db.close();
});

// === Helpers ===

function createMockArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: `art_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    sessionId: 'test-session',
    platform: 'weixin',
    contentType: 'tutorial',
    title: '测试文章标题',
    contentMarkdown: '# 测试\n\n这是测试内容。',
    contentHtml: '<h1>测试</h1>',
    contentPlain: '测试内容',
    tags: ['测试', '教程'],
    summary: '测试摘要',
    wordCount: 500,
    status: 'draft',
    generationRound: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function createMockReview(articleId: string, round = 1): ReviewResult {
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
    },
    issues: [
      { dimension: 'quality', severity: 'low', description: '字数偏少', suggestion: '增加内容' },
    ],
    suggestions: ['增加内容深度', '优化段落结构'],
    reviewedAt: new Date().toISOString(),
  };
}

/** Build a RequestInit with a JSON body for Hono's app.request(). */
function jsonReq(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

// === Session Routes ===

describe('Session Routes', () => {
  let app: ReturnType<typeof createSessionRoutes>;

  beforeEach(() => {
    app = createSessionRoutes(dbAccess);
  });

  it('POST / - should create a new session and return sessionId, sessionData, introMessage', async () => {
    const res = await app.request('/', { method: 'POST' });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.sessionId).toEqual(expect.any(String));
    expect(json.data.sessionData).toBeDefined();
    expect(json.data.sessionData.id).toBe(json.data.sessionId);
    expect(json.data.introMessage).toBeDefined();
    expect(json.data.introMessage.role).toEqual(expect.any(String));
    expect(json.data.introMessage.content).toEqual(expect.any(String), 'introMessage should contain text content');
  });

  it('GET /:id - should return 200 for an existing session', async () => {
    // Insert a session directly into the DB (tests the db-restore path of getSession)
    const id = `test-session-get-${Date.now()}`;
    dbAccess.sessions.upsertSession(id, createEmptySession(id));

    const res = await app.request('/' + id);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.sessionData).toBeDefined();
    expect(json.data.sessionData.id).toBe(id);
    expect(json.data.progress).toBeDefined('progress data should be included in session response');
  });

  it('GET /:id - should return 404 for a non-existent session', async () => {
    const res = await app.request('/definitely-nonexistent-session-' + Date.now());
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.success).toBe(false);
    expect(json.error).toBeDefined('error message should be provided for 404 responses');
  });

  it('GET / - should list all sessions', async () => {
    // Create a session via the endpoint so it lands in the in-memory store
    const createRes = await app.request('/', { method: 'POST' });
    const createJson = await createRes.json();
    const sessionId = createJson.data.sessionId;

    const res = await app.request('/');
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
    const found = json.data.find((s: { id: string }) => s.id === sessionId);
    expect(found).toBeDefined();
    expect(found.id).toBe(sessionId);
    expect(found.stage).toBeDefined();
    expect(found.createdAt).toBeDefined();
    expect(found.updatedAt).toBeDefined('createdAt and updatedAt timestamps should be present');
  });

  it('DELETE /:id - should return 200 and make session unretrievable', async () => {
    const createRes = await app.request('/', { method: 'POST' });
    const createJson = await createRes.json();
    const sessionId = createJson.data.sessionId;

    const res = await app.request('/' + sessionId, { method: 'DELETE' });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);

    // Session should no longer be retrievable
    const getRes = await app.request('/' + sessionId);
    expect(getRes.status).toBe(404, 'deleted session should return 404 on subsequent GET');
  });

  it('DELETE /:id - should return 404 for a non-existent session', async () => {
    const res = await app.request('/definitely-nonexistent-session-' + Date.now(), { method: 'DELETE' });
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.success).toBe(false, 'deleting a non-existent session should fail');
  });
});

// === Article Routes ===

describe('Article Routes', () => {
  let app: ReturnType<typeof createArticleRoutes>;

  beforeEach(() => {
    app = createArticleRoutes(dbAccess);
  });

  it('GET / - should return an empty list when no articles exist', async () => {
    const res = await app.request('/');
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data).toHaveLength(0, 'empty database should return zero articles');
  });

  it('GET /?sessionId= - should return articles filtered by sessionId', async () => {
    dbAccess.articles.insertArticle(createMockArticle({ id: 'art_s1_a', sessionId: 'session-filter' }));
    dbAccess.articles.insertArticle(createMockArticle({ id: 'art_s1_b', sessionId: 'session-filter' }));
    dbAccess.articles.insertArticle(createMockArticle({ id: 'art_s2_a', sessionId: 'session-other' }));

    const res = await app.request('/?sessionId=session-filter');
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(2);
    expect(json.data.every((a: Article) => a.sessionId === 'session-filter')).toBe(true, 'all returned articles should match the session filter');
  });

  it('GET /?status= - should return articles filtered by status', async () => {
    dbAccess.articles.insertArticle(createMockArticle({ id: 'art_st_1', status: 'draft' }));
    dbAccess.articles.insertArticle(createMockArticle({ id: 'art_st_2', status: 'approved' }));
    dbAccess.articles.insertArticle(createMockArticle({ id: 'art_st_3', status: 'approved' }));

    const res = await app.request('/?status=approved');
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(2);
    expect(json.data.every((a: Article) => a.status === 'approved')).toBe(true, 'all returned articles should match the status filter');
  });

  it('GET / - should return all articles when no filter is provided', async () => {
    dbAccess.articles.insertArticle(createMockArticle({ id: 'art_all_1', status: 'draft' }));
    dbAccess.articles.insertArticle(createMockArticle({ id: 'art_all_2', status: 'approved' }));
    dbAccess.articles.insertArticle(createMockArticle({ id: 'art_all_3', status: 'published' }));

    const res = await app.request('/');
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(3, 'all inserted articles should be returned');
  });

  it('GET /:id - should return 200 with full article data for an existing article', async () => {
    const article = createMockArticle({ id: 'art_get_one' });
    dbAccess.articles.insertArticle(article);

    const res = await app.request('/' + article.id);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.id).toBe(article.id);
    expect(json.data.title).toBe(article.title);
    expect(json.data.platform).toBe('weixin');
    expect(json.data.tags).toEqual(['测试', '教程'], 'article tags should be preserved in response');
  });

  it('GET /:id - should return 404 for a non-existent article', async () => {
    const res = await app.request('/non-existent-article-' + Date.now());
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.success).toBe(false);
    expect(json.error).toBeDefined('error message should be provided for 404 responses');
  });

  it('PUT /:id - should update an existing article and return 200', async () => {
    const article = createMockArticle({ id: 'art_put_one' });
    dbAccess.articles.insertArticle(article);

    const res = await app.request('/' + article.id, jsonReq('PUT', { title: '更新后的标题', status: 'approved' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.id).toBe(article.id);
    expect(json.data.title).toBe('更新后的标题');
    expect(json.data.status).toBe('approved', 'article status should be updated via PUT');
  });

  it('PUT /:id - should return 404 for a non-existent article', async () => {
    const res = await app.request('/non-existent-article-' + Date.now(), jsonReq('PUT', { title: 'x' }));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.success).toBe(false, 'updating a non-existent article should fail');
  });

  it('DELETE /:id - should soft-delete (status -> failed) an existing article and return 200', async () => {
    const article = createMockArticle({ id: 'art_del_one', status: 'draft' });
    dbAccess.articles.insertArticle(article);

    const res = await app.request('/' + article.id, { method: 'DELETE' });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);

    // Verify the article status was changed to 'failed' (soft delete)
    const updated = dbAccess.articles.getArticle(article.id);
    expect(updated).toBeDefined();
    expect(updated!.status).toBe('failed', 'DELETE should soft-delete by setting status to failed');
  });

  it('DELETE /:id - should return 404 for a non-existent article', async () => {
    const res = await app.request('/non-existent-article-' + Date.now(), { method: 'DELETE' });
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.success).toBe(false, 'deleting a non-existent article should fail');
  });
});

// === Review Routes ===

describe('Review Routes', () => {
  let app: ReturnType<typeof createReviewRoutes>;

  beforeEach(() => {
    app = createReviewRoutes(dbAccess);
  });

  it('GET /:articleId/latest - should return 200 with review data for an article with a review', async () => {
    const article = createMockArticle({ id: 'art_review_latest' });
    dbAccess.articles.insertArticle(article);
    dbAccess.reviews.insertReview(createMockReview(article.id, 1));

    const res = await app.request('/' + article.id + '/latest');
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.articleId).toBe(article.id);
    expect(json.data.overallScore).toBe(85);
    expect(json.data.passed).toBe(true);
    expect(json.data.dimensions).toBeDefined();
    expect(json.data.dimensions.compliance.score).toBe(100);
    expect(json.data.dimensions.quality.score).toBe(90, 'dimension scores should be included in review response');
  });

  it('GET /:articleId/latest - should return 404 when no review exists', async () => {
    const article = createMockArticle({ id: 'art_no_review' });
    dbAccess.articles.insertArticle(article);

    const res = await app.request('/' + article.id + '/latest');
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.success).toBe(false);
    expect(json.error).toBeDefined('error message should be provided when no review exists');
  });

  it('GET /:articleId - should return all reviews for an article', async () => {
    const article = createMockArticle({ id: 'art_multi_review' });
    dbAccess.articles.insertArticle(article);
    dbAccess.reviews.insertReview(createMockReview(article.id, 1));
    dbAccess.reviews.insertReview({ ...createMockReview(article.id, 2), overallScore: 92 });

    const res = await app.request('/' + article.id);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data).toHaveLength(2);
    expect(json.data[0].articleId).toBe(article.id);
    expect(json.data[1].articleId).toBe(article.id, 'all reviews should belong to the requested article');
  });

  it('GET /:articleId - should return an empty list for an article without reviews', async () => {
    const article = createMockArticle({ id: 'art_empty_review' });
    dbAccess.articles.insertArticle(article);

    const res = await app.request('/' + article.id);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data).toHaveLength(0, 'article with no reviews should return empty list');
  });
});

// === Credential Routes ===

describe('Credential Routes', () => {
  let app: ReturnType<typeof createCredentialRoutes>;

  beforeEach(() => {
    app = createCredentialRoutes(dbAccess);
  });

  it('PUT /:platform - should save credentials and return masked data', async () => {
    const cred: PlatformCredentials = {
      platform: 'weixin',
      type: 'api_key',
      data: { apiKey: 'test-key-12345', appId: 'wx1234567890' },
      status: 'active',
    };

    const res = await app.request('/weixin', jsonReq('PUT', cred));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.platform).toBe('weixin');
    expect(json.data.type).toBe('api_key');
    expect(json.data.status).toBe('active');
    // Masking: 'test-key-12345' (len 14) -> 'te' + 10 asterisks + '45'
    expect(json.data.data.apiKey).toBe('te**********45');
    // Masking: 'wx1234567890' (len 12) -> 'wx' + 8 asterisks + '90'
    expect(json.data.data.appId).toBe('wx********90', 'appId should be masked with first2 + asterisks + last2');
  });

  it('PUT /:platform - should mask short values (<=4 chars) as ****', async () => {
    const cred: PlatformCredentials = {
      platform: 'zhihu',
      type: 'cookie',
      data: { code: 'ab', session: 'very-long-session-value-123' },
      status: 'active',
    };

    const res = await app.request('/zhihu', jsonReq('PUT', cred));
    const json = await res.json();

    expect(res.status).toBe(200);
    // Short value -> fully masked
    expect(json.data.data.code).toBe('****');
    // Long value (len 27) -> masked with first 2 + 20 asterisks + last 2 ('23')
    expect(json.data.data.session).toMatch(/^ve\*{20}23$/);
    expect(json.data.data.session.endsWith('23')).toBe(true, 'long values should preserve last 2 characters after masking');
  });

  it('GET / - should return all credentials with masked data', async () => {
    dbAccess.credentials.upsertCredential('weixin', {
      platform: 'weixin', accountId: 'default', type: 'api_key', data: { apiKey: 'test-key-12345' }, status: 'active',
    });
    dbAccess.credentials.upsertCredential('zhihu', {
      platform: 'zhihu', accountId: 'default', type: 'cookie', data: { session: 'abcdef123456' }, status: 'active',
    });

    const res = await app.request('/');
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(2);
    // Every credential value should be masked (never equal to the raw secret)
    for (const cred of json.data) {
      for (const value of Object.values(cred.data)) {
        expect(value).not.toBe('test-key-12345');
        expect(value).not.toBe('abcdef123456', 'raw credential values should never be exposed in the response');
      }
    }
  });

  it('GET /:platform - should return 200 with masked data for an existing credential', async () => {
    dbAccess.credentials.upsertCredential('csdn', {
      platform: 'csdn', accountId: 'default', type: 'cookie', data: { session: 'csdn-secret-token-999' }, status: 'active',
    });

    const res = await app.request('/csdn?accountId=default');
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.platform).toBe('csdn');
    expect(json.data.data.session).not.toBe('csdn-secret-token-999');
    // 'csdn-secret-token-999' (len 21) -> 'cs' + 17 asterisks + '99'
    expect(json.data.data.session).toBe('cs' + '*'.repeat(17) + '99', 'session token should be properly masked');
  });

  it('GET /:platform - should return 404 for a non-existent credential', async () => {
    const res = await app.request('/nonexistent-platform');
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.success).toBe(false);
    expect(json.error).toBeDefined('error message should be provided for missing credentials');
  });

  it('POST /:platform/validate - should validate existing credentials successfully', async () => {
    dbAccess.credentials.upsertCredential('juejin', {
      platform: 'juejin', accountId: 'default', type: 'token', data: { token: 'some-token-value' }, status: 'active',
    });

    const res = await app.request('/juejin/validate', { method: 'POST' });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.valid).toBe(true);
    expect(json.data.status).toBe('active');
    expect(json.data.lastValidatedAt).toBeDefined('validation timestamp should be recorded');
  });

  it('POST /:platform/validate - should return 404 for a non-existent credential', async () => {
    const res = await app.request('/nonexistent-platform/validate', { method: 'POST' });
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.success).toBe(false, 'validating a non-existent credential should fail');
  });

  it('DELETE /:platform - should delete credentials and confirm deletion', async () => {
    dbAccess.credentials.upsertCredential('bilibili', {
      platform: 'bilibili', accountId: 'default', type: 'cookie', data: { session: 'bili-session' }, status: 'active',
    });

    const res = await app.request('/bilibili', { method: 'DELETE' });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.deleted).toBe(true);

    // Credential should no longer be retrievable
    const getRes = await app.request('/bilibili');
    expect(getRes.status).toBe(404, 'deleted credential should return 404 on subsequent GET');
  });
});

// === Pipeline Routes ===

describe('Pipeline Routes', () => {
  let app: ReturnType<typeof createPipelineRoutes>;

  beforeEach(() => {
    app = createPipelineRoutes(dbAccess);
  });

  it('GET /status/:sessionId - should return article counts and summaries', async () => {
    const sessionId = 'pipe-session-status';

    // Insert mock articles with different statuses
    dbAccess.articles.insertArticle(createMockArticle({
      id: 'art_pipe_draft', sessionId, status: 'draft', platform: 'weixin',
    }));
    dbAccess.articles.insertArticle(createMockArticle({
      id: 'art_pipe_approved', sessionId, status: 'approved', platform: 'zhihu',
    }));

    // Insert a review and a published publish task for the approved article
    dbAccess.reviews.insertReview({ ...createMockReview('art_pipe_approved', 1), overallScore: 88 });
    const task: PublishTask = {
      id: 'task_pipe_1',
      articleId: 'art_pipe_approved',
      platform: 'zhihu',
      status: 'published',
      method: 'rpa',
      platformPostId: 'post-123',
      platformPostUrl: 'https://zhihu.com/post/123',
      retryCount: 0,
      maxRetries: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    dbAccess.publish.insertPublishTask(task);

    const res = await app.request('/status/' + sessionId);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.sessionId).toBe(sessionId);
    expect(json.data.totalArticles).toBe(2);
    expect(json.data.draft).toBe(1);
    expect(json.data.approved).toBe(1);
    expect(json.data.reviewing).toBe(0);
    expect(json.data.publishing).toBe(0);
    expect(json.data.published).toBe(0);
    expect(json.data.failed).toBe(0);
    expect(json.data.articles).toHaveLength(2);

    // Verify summaries include review score and publish url where applicable
    const approvedSummary = json.data.articles.find((a: { id: string }) => a.id === 'art_pipe_approved');
    expect(approvedSummary).toBeDefined();
    expect(approvedSummary.reviewScore).toBe(88);
    expect(approvedSummary.publishUrl).toBe('https://zhihu.com/post/123');

    const draftSummary = json.data.articles.find((a: { id: string }) => a.id === 'art_pipe_draft');
    expect(draftSummary).toBeDefined();
    expect(draftSummary.reviewScore).toBeUndefined();
    expect(draftSummary.publishUrl).toBeUndefined('draft articles should not have review or publish data');
  });

  it('GET /status/:sessionId - should include the latest pipeline run when one exists', async () => {
    const sessionId = 'pipe-session-run';

    const run: PipelineRun = {
      id: 'run_status_1',
      sessionId,
      status: 'completed',
      totalArticles: 2,
      completedArticles: 2,
      startedAt: '2026-08-01T00:00:00Z',
      completedAt: '2026-08-01T01:00:00Z',
    };
    dbAccess.pipeline.insertPipelineRun(run);

    const res = await app.request('/status/' + sessionId);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.run).toBeDefined();
    expect(json.data.run.id).toBe('run_status_1');
    expect(json.data.run.status).toBe('completed', 'latest pipeline run should be included in status response');
  });

  it('GET /status/:sessionId - should return zero counts for a session with no articles', async () => {
    const res = await app.request('/status/empty-session-' + Date.now());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.totalArticles).toBe(0);
    expect(json.data.draft).toBe(0);
    expect(json.data.articles).toHaveLength(0);
    expect(json.data.run).toBeUndefined('empty session should have no pipeline run data');
  });

  it('GET /run/:runId - should return 200 with full data for an existing pipeline run', async () => {
    const run: PipelineRun = {
      id: 'run_get_1',
      sessionId: 'session-run-get',
      status: 'running',
      totalArticles: 3,
      completedArticles: 1,
      currentPlatform: 'zhihu',
      currentRound: 1,
      startedAt: new Date().toISOString(),
    };
    dbAccess.pipeline.insertPipelineRun(run);

    const res = await app.request('/run/' + run.id);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.id).toBe('run_get_1');
    expect(json.data.sessionId).toBe('session-run-get');
    expect(json.data.status).toBe('running');
    expect(json.data.totalArticles).toBe(3);
    expect(json.data.completedArticles).toBe(1);
    expect(json.data.currentPlatform).toBe('zhihu', 'current platform should be included in run details');
  });

  it('GET /run/:runId - should return 404 for a non-existent pipeline run', async () => {
    const res = await app.request('/run/non-existent-run-' + Date.now());
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.success).toBe(false);
    expect(json.error).toBeDefined('error message should be provided for missing pipeline runs');
  });
});
