import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DB } from '../db.js';
import { DatabaseAccess } from '../db.js';
import { createTestDatabase, createMockArticle, createMockReview, resetMockCounters } from '../test-helpers.js';

describe('DatabaseAccess - Reviews', () => {
  let db: DB;
  let dbAccess: DatabaseAccess;

  beforeEach(() => {
    ({ db, dbAccess } = createTestDatabase());
    resetMockCounters();
  });

  afterEach(() => {
    db.close();
  });

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

describe('DatabaseAccess - Review Advanced', () => {
  let db: DB;
  let dbAccess: DatabaseAccess;

  beforeEach(() => {
    ({ db, dbAccess } = createTestDatabase());
    resetMockCounters();
  });

  afterEach(() => {
    db.close();
  });

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
