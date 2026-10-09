/**
 * CachedDatabaseAccess — wraps DatabaseAccess with an LRU cache layer.
 *
 * Read operations check the cache first; on miss, they delegate to the
 * underlying DatabaseAccess and store the result. Write operations
 * invalidate related cache entries after successfully writing to the DB.
 *
 * Cache TTLs:
 *   - getArticle:           60s   (article:{id})
 *   - getArticlesBySession: 30s   (articles:session:{sessionId})
 *   - getPublishTask:       30s   (task:{id})
 *   - getCredential:       120s   (cred:{platform})
 *   - getSession:           30s   (session:{id})
 *   - healthCheck:          10s   (health)
 *   - getQueueStatus:       10s   (queue:status)
 */

import type {
  Article,
  ReviewResult,
  PublishTask,
  PublishLog,
  PlatformCredentials,
  SessionData,
} from '@zemingengine/shared';
import { DatabaseAccess, createDatabase, type DB } from './db.js';
import { LRUCache } from './cache.js';

type SqliteDatabase = DB;

// TTL constants (ms)
const TTL_ARTICLE = 60_000;
const TTL_ARTICLES_SESSION = 30_000;
const TTL_TASK = 30_000;
const TTL_CREDENTIAL = 120_000;
const TTL_SESSION = 30_000;
const TTL_HEALTH = 10_000;
const TTL_QUEUE = 10_000;

export class CachedDatabaseAccess extends DatabaseAccess {
  private cache: LRUCache;

  constructor(db: SqliteDatabase) {
    super(db);
    this.cache = new LRUCache({
      maxEntries: 200,
      defaultTtlMs: 60_000,
    });
  }

  /** Create a CachedDatabaseAccess with a fresh database connection. */
  static create(): CachedDatabaseAccess {
    return new CachedDatabaseAccess(createDatabase());
  }

  /** Expose the underlying cache for stats and management. */
  getCache(): LRUCache {
    return this.cache;
  }

  // === Cached read methods ===

  getArticle(id: string): Article | undefined {
    const cacheKey = `article:${id}`;
    const cached = this.cache.get<Article>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    const result = this.articles.getArticle(id);
    if (result) {
      this.cache.set(cacheKey, result, TTL_ARTICLE);
    }
    return result;
  }

  getArticlesBySession(sessionId: string): Article[] {
    const cacheKey = `articles:session:${sessionId}`;
    const cached = this.cache.get<Article[]>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    const result = this.articles.getArticlesBySession(sessionId);
    this.cache.set(cacheKey, result, TTL_ARTICLES_SESSION);
    return result;
  }

  getPublishTask(id: string): PublishTask | undefined {
    const cacheKey = `task:${id}`;
    const cached = this.cache.get<PublishTask>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    const result = this.publish.getPublishTask(id);
    if (result) {
      this.cache.set(cacheKey, result, TTL_TASK);
    }
    return result;
  }

  getCredential(platform: string, userId: string = 'user_default', accountId: string = 'default'): PlatformCredentials | undefined {
    const cacheKey = `cred:${userId}:${platform}:${accountId}`;
    const cached = this.cache.get<PlatformCredentials>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    const result = this.credentials.getCredential(platform, userId, accountId);
    if (result) {
      this.cache.set(cacheKey, result, TTL_CREDENTIAL);
    }
    return result;
  }

  getSession(id: string): SessionData | undefined {
    const cacheKey = `session:${id}`;
    const cached = this.cache.get<SessionData>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    const result = this.sessions.getSession(id);
    if (result) {
      this.cache.set(cacheKey, result, TTL_SESSION);
    }
    return result;
  }

  healthCheck(): { healthy: boolean; details: Record<string, unknown> } {
    const cacheKey = 'health';
    const cached = this.cache.get<{ healthy: boolean; details: Record<string, unknown> }>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    const result = super.healthCheck();
    this.cache.set(cacheKey, result, TTL_HEALTH);
    return result;
  }

  getQueueStatus(): {
    pending: number;
    publishing: number;
    published: number;
    failed: number;
    retrying: number;
    total: number;
  } {
    const cacheKey = 'queue:status';
    const cached = this.cache.get<{
      pending: number;
      publishing: number;
      published: number;
      failed: number;
      retrying: number;
      total: number;
    }>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    const result = this.publish.getQueueStatus();
    this.cache.set(cacheKey, result, TTL_QUEUE);
    return result;
  }

  getLatestReview(articleId: string): ReviewResult | undefined {
    const cacheKey = `review:latest:${articleId}`;
    const cached = this.cache.get<ReviewResult>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    const result = this.reviews.getLatestReview(articleId);
    if (result) {
      this.cache.set(cacheKey, result, 30_000);
    }
    return result;
  }

  getReviewsByArticle(articleId: string): ReviewResult[] {
    const cacheKey = `reviews:${articleId}`;
    const cached = this.cache.get<ReviewResult[]>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    const result = this.reviews.getReviewsByArticle(articleId);
    this.cache.set(cacheKey, result, 30_000);
    return result;
  }

  // === Write methods with cache invalidation ===

  insertArticle(article: Article): void {
    this.articles.insertArticle(article);
    this.cache.invalidatePattern(`articles:session:${article.sessionId}`);
  }

  updateArticle(id: string, updates: Partial<Article>): void {
    this.articles.updateArticle(id, updates);
    this.cache.delete(`article:${id}`);
    // Invalidate session article list if we can determine the session
    const article = this.articles.getArticle(id);
    if (article) {
      this.cache.invalidatePattern(`articles:session:${article.sessionId}`);
    }
    this.cache.delete(`review:latest:${id}`);
    this.cache.delete(`reviews:${id}`);
  }

  insertPublishTask(task: PublishTask): void {
    this.publish.insertPublishTask(task);
    this.cache.delete('queue:status');
  }

  updatePublishTask(id: string, updates: Partial<PublishTask>): void {
    this.publish.updatePublishTask(id, updates);
    this.cache.delete(`task:${id}`);
    this.cache.delete('queue:status');
    this.cache.delete('health');
  }

  upsertCredential(platform: string, cred: PlatformCredentials, userId: string = 'user_default'): void {
    this.credentials.upsertCredential(platform, cred, userId);
    const accountId = cred.accountId || 'default';
    this.cache.delete(`cred:${userId}:${platform}:${accountId}`);
    this.cache.delete('cred:all');
    this.cache.delete('health');
  }

  deleteCredential(platform: string, userId: string = 'user_default', accountId: string = 'default'): void {
    this.credentials.deleteCredential(platform, userId, accountId);
    this.cache.delete(`cred:${userId}:${platform}:${accountId}`);
    this.cache.delete('cred:all');
    this.cache.delete('health');
  }

  upsertSession(id: string, data: SessionData, userId?: string): void {
    this.sessions.upsertSession(id, data, userId);
    this.cache.delete(`session:${id}`);
  }

  deleteSessionCascade(sessionId: string): void {
    // Get article IDs before deletion to invalidate their caches
    const articles = this.articles.getArticlesBySession(sessionId);
    this.sessions.deleteSessionCascade(sessionId);
    // Invalidate all related caches
    this.cache.delete(`session:${sessionId}`);
    this.cache.invalidatePattern(`articles:session:${sessionId}`);
    for (const article of articles) {
      this.cache.delete(`article:${article.id}`);
      this.cache.delete(`review:latest:${article.id}`);
      this.cache.delete(`reviews:${article.id}`);
      // Invalidate task caches for this article
      const tasks = this.publish.getPublishTasksByArticle(article.id);
      for (const task of tasks) {
        this.cache.delete(`task:${task.id}`);
      }
    }
    this.cache.delete('queue:status');
    this.cache.delete('health');
  }

  insertReview(review: ReviewResult): string {
    const id = this.reviews.insertReview(review);
    this.cache.delete(`review:latest:${review.articleId}`);
    this.cache.delete(`reviews:${review.articleId}`);
    return id;
  }

  insertPublishLog(log: PublishLog): void {
    this.publish.insertPublishLog(log);
    // Logs don't affect cached reads, no invalidation needed
  }

  // === Transaction support ===

  runInTransaction<T>(fn: () => T): T {
    // Execute the transaction, then clear the cache to ensure consistency.
    // We can't know what was modified inside the transaction, so be safe.
    const result = super.runInTransaction(fn);
    // Don't clear everything — just invalidate health and queue which are
    // commonly affected by transactional writes.
    this.cache.delete('health');
    this.cache.delete('queue:status');
    return result;
  }

  // === Pass-through methods that don't need caching ===
  // These are inherited from DatabaseAccess automatically.
  // Only the methods above are overridden for caching/invalidation.
}
