/**
 * LRU Cache with TTL support.
 *
 * Features:
 * - LRU eviction when maxEntries is exceeded
 * - TTL-based expiration (per-entry or default)
 * - Hit/miss/eviction statistics
 * - Pattern-based invalidation (prefix:* wildcard)
 * - wrap() for async function caching
 * - cleanup() for removing expired entries
 */

export interface CacheEntry<T> {
  value: T;
  expiresAt: number; // timestamp ms, 0 = never expires
  lastAccessed: number;
  hits: number;
}

export interface CacheStats {
  entries: number;
  hits: number;
  misses: number;
  hitRate: number;
  evictions: number;
}

export interface LRUCacheOptions {
  maxEntries?: number;
  defaultTtlMs?: number;
}

const NEVER_EXPIRES = 0;

export class LRUCache<T = unknown> {
  private cache = new Map<string, CacheEntry<T>>();
  private readonly maxEntries: number;
  private readonly defaultTtlMs: number;
  private statsHits = 0;
  private statsMisses = 0;
  private statsEvictions = 0;

  constructor(options: LRUCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? 100;
    this.defaultTtlMs = options.defaultTtlMs ?? 60_000; // 1 minute default
  }

  /**
   * Get a value from the cache.
   * Returns undefined if the key doesn't exist or has expired.
   * Updates lastAccessed for LRU tracking.
   *
   * The optional type parameter K allows callers to specify the expected type,
   * which is useful when the cache stores mixed types (T = unknown).
   */
  get<K = T>(key: string): K | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      this.statsMisses++;
      return undefined;
    }

    // Check TTL expiration
    if (entry.expiresAt !== NEVER_EXPIRES && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.statsMisses++;
      return undefined;
    }

    // Update access tracking
    entry.lastAccessed = Date.now();
    entry.hits++;
    this.statsHits++;

    // Move to end of Map (most recently used) by re-inserting
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value as unknown as K;
  }

  /**
   * Set a value in the cache.
   * @param ttlMs Time to live in ms. 0 = use defaultTtl, -1 = never expires.
   */
  set(key: string, value: T, ttlMs: number = 0): void {
    // Evict LRU entry if at capacity and this is a new key
    if (this.cache.size >= this.maxEntries && !this.cache.has(key)) {
      this.evictLRU();
    }

    const expiresAt =
      ttlMs === -1
        ? NEVER_EXPIRES
        : ttlMs === 0
          ? Date.now() + this.defaultTtlMs
          : Date.now() + ttlMs;

    this.cache.set(key, {
      value,
      expiresAt,
      lastAccessed: Date.now(),
      hits: 0,
    });
  }

  /** Delete a key from the cache. Returns true if the key existed. */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /** Check if a key exists and is not expired. */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (entry.expiresAt !== NEVER_EXPIRES && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  /** Clear all entries. */
  clear(): void {
    this.cache.clear();
  }

  /** Current number of entries (including potentially expired ones). */
  size(): number {
    return this.cache.size;
  }

  /** Get cache statistics. */
  stats(): CacheStats {
    const total = this.statsHits + this.statsMisses;
    return {
      entries: this.cache.size,
      hits: this.statsHits,
      misses: this.statsMisses,
      hitRate: total > 0 ? (this.statsHits / total) * 100 : 0,
      evictions: this.statsEvictions,
    };
  }

  /**
   * Remove all expired entries.
   * @returns number of entries removed
   */
  cleanup(): number {
    let removed = 0;
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt !== NEVER_EXPIRES && now > entry.expiresAt) {
        this.cache.delete(key);
        removed++;
      }
    }
    if (removed > 0) {
      console.log(`[Cache] Cleanup: removed ${removed} expired entr${removed === 1 ? 'y' : 'ies'}`);
    }
    return removed;
  }

  /**
   * Invalidate entries matching a pattern.
   * Supports prefix matching with `prefix:*` wildcard.
   * @returns number of entries invalidated
   */
  invalidatePattern(pattern: string): number {
    let removed = 0;

    if (pattern.endsWith(':*')) {
      const prefix = pattern.slice(0, -1); // Remove the '*'
      for (const [key] of this.cache) {
        if (key.startsWith(prefix)) {
          this.cache.delete(key);
          removed++;
        }
      }
    } else {
      // Exact match
      if (this.cache.delete(pattern)) {
        removed = 1;
      }
    }

    return removed;
  }

  /**
   * Wrap an async function with caching.
   * If the key exists in cache, returns cached value.
   * Otherwise, executes fn, caches the result, and returns it.
   */
  async wrap<K>(key: string, fn: () => Promise<K>, ttlMs: number = 0): Promise<K> {
    const cached = this.get<K>(key);
    if (cached !== undefined) {
      return cached;
    }

    const result = await fn();
    this.set(key, result as unknown as T, ttlMs);
    return result;
  }

  // === Private ===

  /** Evict the least recently used entry. */
  private evictLRU(): void {
    // Map preserves insertion order; first entry is oldest (least recently used)
    // because we re-insert on get()
    const firstKey = this.cache.keys().next().value;
    if (firstKey !== undefined) {
      this.cache.delete(firstKey);
      this.statsEvictions++;
    }
  }
}
