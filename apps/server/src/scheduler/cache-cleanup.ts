import type { DatabaseAccess } from '../db.js';
import type { CachedDatabaseAccess } from '../cached-db.js';

const CACHE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let cacheCleanupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start a periodic cache cleanup scheduler.
 *
 * Every 5 minutes, calls `cache.cleanup()` on the CachedDatabaseAccess
 * instance to remove expired entries from the LRU cache. This prevents
 * stale entries from consuming memory.
 *
 * Idempotent — calling startCacheCleanup() while already running is a no-op.
 */
export function startCacheCleanup(db: DatabaseAccess): void {
  if (cacheCleanupTimer) {
    console.warn('[CacheCleanup] Already running');
    return;
  }

  // Only run cleanup if the db instance supports caching
  const cachedDb = db as CachedDatabaseAccess;
  if (typeof cachedDb.getCache !== 'function') {
    console.log('[CacheCleanup] Skipped (db does not support caching)');
    return;
  }

  console.log('[CacheCleanup] Started (every 5 minutes)');

  const cleanup = (): void => {
    try {
      const removed = cachedDb.getCache().cleanup();
      if (removed > 0) {
        const stats = cachedDb.getCache().stats();
        console.log(
          `[CacheCleanup] ${removed} entries removed, ` +
            `${stats.entries} remaining (hit rate: ${stats.hitRate.toFixed(1)}%)`,
        );
      }
    } catch (err) {
      console.error(
        '[CacheCleanup] Error:',
        err instanceof Error ? err.message : err,
      );
    }
  };

  // Run cleanup after the first interval (not immediately)
  cacheCleanupTimer = setInterval(cleanup, CACHE_CLEANUP_INTERVAL_MS);
}

/**
 * Stop the cache cleanup scheduler.
 * Idempotent — safe to call even if not running.
 */
export function stopCacheCleanup(): void {
  if (cacheCleanupTimer) {
    clearInterval(cacheCleanupTimer);
    cacheCleanupTimer = null;
    console.log('[CacheCleanup] Stopped');
  }
}
