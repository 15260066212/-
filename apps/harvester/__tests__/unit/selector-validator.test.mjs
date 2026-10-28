import { describe, it, expect } from 'vitest';
import { buildSelectorValidationSummary } from '../../lib/selector-validator.js';

describe('selector-validator', () => {
  describe('buildSelectorValidationSummary', () => {
    it('all found: returns ok status for all', () => {
      const results = [
        { selector: '.title', purpose: 'title', found: true, count: 1, visible: true },
        { selector: '.content', purpose: 'content', found: true, count: 1, visible: true },
      ];
      const summary = buildSelectorValidationSummary(results);
      expect(summary.total).toBe(2, 'should set total to 2 for all found: returns ok status for all');
      expect(summary.found).toBe(2, 'should set found to 2 for all found: returns ok status for all');
      expect(summary.missing).toBe(0, 'should set missing to 0 for all found: returns ok status for all');
      expect(summary.brokenPurposes).toEqual([], 'should return expected array for all found: returns ok status for all');
      expect(summary.byPurpose).toHaveLength(2, 'should have length 2 for all found: returns ok status for all');
      expect(summary.byPurpose.every((p) => p.status === 'ok')).toBe(true, 'should return true when all found: returns ok status for all');
    });

    it('all missing: returns broken status for all', () => {
      const results = [
        { selector: '.title', purpose: 'title', found: false, count: 0, visible: false },
        { selector: '.content', purpose: 'content', found: false, count: 0, visible: false },
      ];
      const summary = buildSelectorValidationSummary(results);
      expect(summary.total).toBe(2, 'should set total to 2 for all missing: returns broken status for all');
      expect(summary.found).toBe(0, 'should set found to 0 for all missing: returns broken status for all');
      expect(summary.missing).toBe(2, 'should set missing to 2 for all missing: returns broken status for all');
      expect(summary.brokenPurposes).toEqual(expect.arrayContaining(['title', 'content']), 'should equal expected brokenPurposes for all missing: returns broken status for all');
      expect(summary.byPurpose.every((p) => p.status === 'broken')).toBe(true, 'should return true when all missing: returns broken status for all');
    });

    it('partially missing: some ok, some broken', () => {
      const results = [
        { selector: '.title', purpose: 'title', found: true, count: 1, visible: true },
        { selector: '.missing', purpose: 'submit', found: false, count: 0, visible: false },
      ];
      const summary = buildSelectorValidationSummary(results);
      expect(summary.total).toBe(2, 'should set total to 2 for partially missing: some ok, some broken');
      expect(summary.found).toBe(1, 'should set found to 1 for partially missing: some ok, some broken');
      expect(summary.missing).toBe(1, 'should set missing to 1 for partially missing: some ok, some broken');
      expect(summary.brokenPurposes).toEqual(['submit'], 'should return expected array for partially missing: some ok, some broken');
    });

    it('groups by purpose correctly', () => {
      const results = [
        { selector: '.title1', purpose: 'title', found: true, count: 1, visible: true },
        { selector: '.title2', purpose: 'title', found: false, count: 0, visible: false },
        { selector: '.content1', purpose: 'content', found: true, count: 1, visible: false },
        { selector: '.content2', purpose: 'content', found: true, count: 2, visible: true },
      ];
      const summary = buildSelectorValidationSummary(results);
      expect(summary.byPurpose).toHaveLength(2, 'should have expected length for groups by purpose correctly');

      const titleGroup = summary.byPurpose.find((p) => p.purpose === 'title');
      expect(titleGroup.total).toBe(2, 'should have correct total when groups by purpose correctly');
      expect(titleGroup.found).toBe(1, 'should have correct found when groups by purpose correctly');
      expect(titleGroup.missing).toBe(1, 'should have correct missing when groups by purpose correctly');
      expect(titleGroup.status).toBe('ok', 'should have correct status code when groups by purpose correctly');

      const contentGroup = summary.byPurpose.find((p) => p.purpose === 'content');
      expect(contentGroup.total).toBe(2, 'should have correct total when groups by purpose correctly');
      expect(contentGroup.found).toBe(2, 'should have correct found when groups by purpose correctly');
      expect(contentGroup.missing).toBe(0, 'should have correct missing when groups by purpose correctly');
      expect(contentGroup.status).toBe('ok', 'should have correct status code when groups by purpose correctly');
    });

    it('degraded status: found but not visible', () => {
      const results = [
        { selector: '.el', purpose: 'button', found: true, count: 1, visible: false },
      ];
      const summary = buildSelectorValidationSummary(results);
      expect(summary.byPurpose[0].status).toBe('degraded', 'should have correct status code when degraded status: found but not visible');
    });

    it('ok status: at least one visible', () => {
      const results = [
        { selector: '.el1', purpose: 'button', found: true, count: 1, visible: false },
        { selector: '.el2', purpose: 'button', found: true, count: 1, visible: true },
      ];
      const summary = buildSelectorValidationSummary(results);
      expect(summary.byPurpose[0].status).toBe('ok', 'should have correct status code when ok status: at least one visible');
    });

    it('empty results: returns zeroed summary', () => {
      const summary = buildSelectorValidationSummary([]);
      expect(summary.total).toBe(0, 'should have correct total when empty results: returns zeroed summary');
      expect(summary.found).toBe(0, 'should have correct found when empty results: returns zeroed summary');
      expect(summary.missing).toBe(0, 'should have correct missing when empty results: returns zeroed summary');
      expect(summary.byPurpose).toEqual([], 'should match expected byPurpose for empty results: returns zeroed summary');
      expect(summary.brokenPurposes).toEqual([]);
    });

    it('null/undefined input: returns zeroed summary', () => {
      const summary = buildSelectorValidationSummary(null);
      expect(summary.total).toBe(0);
      expect(summary.byPurpose).toEqual([]);
    });

    it('handles missing purpose by defaulting to unknown', () => {
      const results = [
        { selector: '.x', purpose: undefined, found: true, count: 1, visible: true },
      ];
      const summary = buildSelectorValidationSummary(results);
      expect(summary.byPurpose[0].purpose).toBe('unknown');
    });
  });
});
