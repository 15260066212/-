import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DB } from '../db.js';
import { DatabaseAccess } from '../db.js';
import { createTestDatabase, createMockArticle, createMockReview } from '../test-helpers.js';
import { createReviewRoutes } from './review.js';

let db: DB;
let dbAccess: DatabaseAccess;

beforeEach(() => {
  ({ db, dbAccess } = createTestDatabase());
});

afterEach(() => {
  db.close();
});

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
