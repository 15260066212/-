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
      expect(summary.total).toBe(2);
      expect(summary.found).toBe(2);
      expect(summary.missing).toBe(0);
      expect(summary.brokenPurposes).toEqual([]);
      expect(summary.byPurpose).toHaveLength(2);
      expect(summary.byPurpose.every((p) => p.status === 'ok')).toBe(true);
    });

    it('all missing: returns broken status for all', () => {
      const results = [
        { selector: '.title', purpose: 'title', found: false, count: 0, visible: false },
        { selector: '.content', purpose: 'content', found: false, count: 0, visible: false },
      ];
      const summary = buildSelectorValidationSummary(results);
      expect(summary.total).toBe(2);
      expect(summary.found).toBe(0);
      expect(summary.missing).toBe(2);
      expect(summary.brokenPurposes).toEqual(expect.arrayContaining(['title', 'content']));
      expect(summary.byPurpose.every((p) => p.status === 'broken')).toBe(true);
    });

    it('partially missing: some ok, some broken', () => {
      const results = [
        { selector: '.title', purpose: 'title', found: true, count: 1, visible: true },
        { selector: '.missing', purpose: 'submit', found: false, count: 0, visible: false },
      ];
      const summary = buildSelectorValidationSummary(results);
      expect(summary.total).toBe(2);
      expect(summary.found).toBe(1);
      expect(summary.missing).toBe(1);
      expect(summary.brokenPurposes).toEqual(['submit']);
    });

    it('groups by purpose correctly', () => {
      const results = [
        { selector: '.title1', purpose: 'title', found: true, count: 1, visible: true },
        { selector: '.title2', purpose: 'title', found: false, count: 0, visible: false },
        { selector: '.content1', purpose: 'content', found: true, count: 1, visible: false },
        { selector: '.content2', purpose: 'content', found: true, count: 2, visible: true },
      ];
      const summary = buildSelectorValidationSummary(results);
      expect(summary.byPurpose).toHaveLength(2);

      const titleGroup = summary.byPurpose.find((p) => p.purpose === 'title');
      expect(titleGroup.total).toBe(2);
      expect(titleGroup.found).toBe(1);
      expect(titleGroup.missing).toBe(1);
      expect(titleGroup.status).toBe('ok');

      const contentGroup = summary.byPurpose.find((p) => p.purpose === 'content');
      expect(contentGroup.total).toBe(2);
      expect(contentGroup.found).toBe(2);
      expect(contentGroup.missing).toBe(0);
      expect(contentGroup.status).toBe('ok');
    });

    it('degraded status: found but not visible', () => {
      const results = [
        { selector: '.el', purpose: 'button', found: true, count: 1, visible: false },
      ];
      const summary = buildSelectorValidationSummary(results);
      expect(summary.byPurpose[0].status).toBe('degraded');
    });

    it('ok status: at least one visible', () => {
      const results = [
        { selector: '.el1', purpose: 'button', found: true, count: 1, visible: false },
        { selector: '.el2', purpose: 'button', found: true, count: 1, visible: true },
      ];
      const summary = buildSelectorValidationSummary(results);
      expect(summary.byPurpose[0].status).toBe('ok');
    });

    it('empty results: returns zeroed summary', () => {
      const summary = buildSelectorValidationSummary([]);
      expect(summary.total).toBe(0);
      expect(summary.found).toBe(0);
      expect(summary.missing).toBe(0);
      expect(summary.byPurpose).toEqual([]);
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
