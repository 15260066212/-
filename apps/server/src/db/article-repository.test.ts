import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DB } from '../db.js';
import { DatabaseAccess } from '../db.js';
import { createTestDatabase, createMockArticle, resetMockCounters } from '../test-helpers.js';

describe('DatabaseAccess - Articles', () => {
  let db: DB;
  let dbAccess: DatabaseAccess;

  beforeEach(() => {
    ({ db, dbAccess } = createTestDatabase());
    resetMockCounters();
  });

  afterEach(() => {
    db.close();
  });

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
