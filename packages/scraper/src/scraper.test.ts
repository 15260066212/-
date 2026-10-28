import { describe, it, expect } from 'vitest';
import { scrapeUrl } from './scraper.js';

describe('scrapeUrl', () => {
  // Smoke test: verifies the function is exported and callable.
  // Full integration tests require network access and are skipped by default (see below).
  it('should be exported as a function', () => {
    expect(typeof scrapeUrl).toBe('function');
  });

  // Integration test -- requires network access, skipped by default
  it.skip('should scrape a real page', async () => {
    const result = await scrapeUrl('https://example.com');
    expect(result.title).toBeTruthy();
    expect(result.method).toBe('cheerio');
    expect(result.url).toBe('https://example.com');
  });
});
