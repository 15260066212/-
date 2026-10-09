import { describe, it, expect } from 'vitest';
import { scrapeUrl } from './scraper.js';

describe('scrapeUrl', () => {
  it('should be a function', () => {
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
