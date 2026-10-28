import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DB } from '../db.js';
import { DatabaseAccess } from '../db.js';
import { createTestDatabase, createMockArticle, jsonReq } from '../test-helpers.js';
import type { Article } from '@zemingengine/shared';
import { createArticleRoutes } from './article.js';

let db: DB;
let dbAccess: DatabaseAccess;

beforeEach(() => {
  ({ db, dbAccess } = createTestDatabase());
});

afterEach(() => {
  db.close();
});

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
