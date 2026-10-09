import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LRUCache } from './cache.js';

describe('LRUCache', () => {
  let cache: LRUCache<unknown>;

  beforeEach(() => {
    cache = new LRUCache<unknown>({ maxEntries: 5, defaultTtlMs: 1000 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('basic operations', () => {
    it('should set and get a value', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1', 'set value should be retrievable by key');
    });

    it('should return undefined for missing key', () => {
      expect(cache.get('nonexistent')).toBeUndefined('missing key should return undefined');
    });

    it('should delete a key', () => {
      cache.set('key1', 'value1');
      expect(cache.delete('key1')).toBe(true);
      expect(cache.get('key1')).toBeUndefined('deleted key should no longer be retrievable');
    });

    it('should return false when deleting non-existent key', () => {
      expect(cache.delete('nonexistent')).toBe(false, 'deleting non-existent key should return false');
    });

    it('should check existence with has()', () => {
      cache.set('key1', 'value1');
      expect(cache.has('key1')).toBe(true);
      expect(cache.has('nonexistent')).toBe(false, 'has() should return false for missing keys');
    });

    it('should clear all entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.clear();
      expect(cache.size()).toBe(0, 'clear should remove all entries');
    });

    it('should report size correctly', () => {
      expect(cache.size()).toBe(0);
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      expect(cache.size()).toBe(2, 'size should reflect total number of entries');
    });
  });

  describe('TTL expiration', () => {
    it('should expire entries after TTL', () => {
      vi.useFakeTimers();
      cache.set('key1', 'value1', 100); // 100ms TTL
      expect(cache.get('key1')).toBe('value1');

      vi.advanceTimersByTime(101);
      expect(cache.get('key1')).toBeUndefined();
    });

    it('should use default TTL when ttlMs is 0', () => {
      vi.useFakeTimers();
      cache.set('key1', 'value1'); // Uses defaultTtlMs: 1000
      expect(cache.get('key1')).toBe('value1');

      vi.advanceTimersByTime(1001);
      expect(cache.get('key1')).toBeUndefined();
    });

    it('should never expire when ttlMs is -1', () => {
      vi.useFakeTimers();
      cache.set('key1', 'value1', -1); // Never expires
      vi.advanceTimersByTime(999999999);
      expect(cache.get('key1')).toBe('value1');
    });

    it('should remove expired entry on has() check', () => {
      vi.useFakeTimers();
      cache.set('key1', 'value1', 100);
      vi.advanceTimersByTime(101);
      expect(cache.has('key1')).toBe(false);
      expect(cache.size()).toBe(0);
    });
  });

  describe('LRU eviction', () => {
    it('should evict LRU entry when maxEntries is exceeded', () => {
      cache.set('a', '1');
      cache.set('b', '2');
      cache.set('c', '3');
      cache.set('d', '4');
      cache.set('e', '5');
      // Cache is full (maxEntries=5)
      cache.set('f', '6');
      // 'a' should be evicted (it was the least recently used)
      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('f')).toBe('6');
    });

    it('should not evict when updating existing key', () => {
      cache.set('a', '1');
      cache.set('b', '2');
      cache.set('c', '3');
      cache.set('d', '4');
      cache.set('e', '5');
      // Update existing key instead of adding new
      cache.set('a', '1-updated');
      expect(cache.size()).toBe(5);
      expect(cache.get('a')).toBe('1-updated');
    });

    it('should move entry to end on get (most recently used)', () => {
      cache.set('a', '1');
      cache.set('b', '2');
      cache.set('c', '3');
      cache.set('d', '4');
      cache.set('e', '5');

      // Access 'a' to make it recently used
      cache.get('a');

      // Now 'b' should be the LRU
      cache.set('f', '6');
      expect(cache.get('a')).toBe('1'); // 'a' should survive
      expect(cache.get('b')).toBeUndefined(); // 'b' should be evicted
    });
  });

  describe('stats', () => {
    it('should track hits and misses', () => {
      cache.set('key1', 'value1');
      cache.get('key1'); // hit
      cache.get('key1'); // hit
      cache.get('missing'); // miss

      const stats = cache.stats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo((2 / 3) * 100, 1);
    });

    it('should track evictions', () => {
      cache.set('a', '1');
      cache.set('b', '2');
      cache.set('c', '3');
      cache.set('d', '4');
      cache.set('e', '5');
      cache.set('f', '6'); // evicts 'a'

      const stats = cache.stats();
      expect(stats.evictions).toBe(1);
    });

    it('should report entry count', () => {
      cache.set('a', '1');
      cache.set('b', '2');
      const stats = cache.stats();
      expect(stats.entries).toBe(2);
    });

    it('should return 0 hit rate with no operations', () => {
      const stats = cache.stats();
      expect(stats.hitRate).toBe(0);
    });
  });

  describe('cleanup', () => {
    it('should remove expired entries', () => {
      vi.useFakeTimers();
      cache.set('a', '1', 100);
      cache.set('b', '2', 200);
      cache.set('c', '3', -1); // never expires

      vi.advanceTimersByTime(150);
      const removed = cache.cleanup();
      expect(removed).toBe(1); // only 'a' expired
      expect(cache.size()).toBe(2);
      expect(cache.has('b')).toBe(true);
      expect(cache.has('c')).toBe(true);
    });

    it('should return 0 when nothing to clean', () => {
      cache.set('a', '1', -1);
      expect(cache.cleanup()).toBe(0);
    });
  });

  describe('invalidatePattern', () => {
    it('should invalidate entries matching prefix:*', () => {
      cache.set('article:1', 'a1');
      cache.set('article:2', 'a2');
      cache.set('article:3', 'a3');
      cache.set('task:1', 't1');

      const removed = cache.invalidatePattern('article:*');
      expect(removed).toBe(3);
      expect(cache.has('article:1')).toBe(false);
      expect(cache.has('task:1')).toBe(true);
    });

    it('should handle exact match (no wildcard)', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      const removed = cache.invalidatePattern('key1');
      expect(removed).toBe(1);
      expect(cache.has('key1')).toBe(false);
      expect(cache.has('key2')).toBe(true);
    });

    it('should return 0 when no match', () => {
      cache.set('a', '1');
      expect(cache.invalidatePattern('nonexistent:*')).toBe(0);
    });
  });

  describe('wrap', () => {
    it('should cache the result of async function', async () => {
      const fn = vi.fn().mockResolvedValue('result');
      const result1 = await cache.wrap('key', fn);
      const result2 = await cache.wrap('key', fn);

      expect(result1).toBe('result');
      expect(result2).toBe('result');
      expect(fn).toHaveBeenCalledTimes(1); // Function called only once
    });

    it('should execute function when cache miss', async () => {
      const fn = vi.fn().mockResolvedValue(42);
      const result = await cache.wrap('compute', fn);
      expect(result).toBe(42);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should respect TTL in wrap', async () => {
      vi.useFakeTimers();
      const fn = vi.fn().mockResolvedValue('value');
      await cache.wrap('key', fn, 100);
      vi.advanceTimersByTime(101);
      const result = await cache.wrap('key', fn, 100);
      expect(result).toBe('value');
      expect(fn).toHaveBeenCalledTimes(2); // Called again after expiry
    });
  });

  describe('complex objects', () => {
    it('should cache objects by reference', () => {
      const obj = { name: 'test', nested: { value: 42 } };
      cache.set('obj', obj);
      expect(cache.get('obj')).toBe(obj); // Same reference
    });

    it('should cache arrays', () => {
      const arr = [1, 2, 3, { a: 'b' }];
      cache.set('arr', arr);
      expect(cache.get('arr')).toEqual(arr);
    });
  });

  describe('default options', () => {
    it('should use default maxEntries of 100', () => {
      const bigCache = new LRUCache<number>({ defaultTtlMs: 60000 });
      for (let i = 0; i < 100; i++) {
        bigCache.set(`key${i}`, i);
      }
      expect(bigCache.size()).toBe(100);
      bigCache.set('key100', 100);
      expect(bigCache.size()).toBe(100); // Evicted one, still 100
    });
  });
});
