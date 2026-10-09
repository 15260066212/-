import { describe, it, expect } from 'vitest';
import { computeSessionValidityScore } from '../../lib/session-scoring.js';

describe('session-scoring', () => {
  describe('computeSessionValidityScore', () => {
    it('all valid: high positive score when logged-in element present and no bad signals', () => {
      const result = computeSessionValidityScore({
        isLoginUrl: false,
        hasAuthCookie: true,
        hasLoginText: false,
        hasLoggedInElement: true,
      });
      expect(result.valid).toBe(true);
      expect(result.score).toBeGreaterThan(0);
      expect(result.score).toBe(3);
      expect(result.reason).toContain('logged-in element');
    });

    it('all invalid: low score when all bad signals present', () => {
      const result = computeSessionValidityScore({
        isLoginUrl: true,
        hasAuthCookie: false,
        hasLoginText: true,
        hasLoggedInElement: false,
      });
      expect(result.valid).toBe(false);
      expect(result.score).toBeLessThan(0);
      expect(result.score).toBe(-6);
      expect(result.reason).toContain('login page');
      expect(result.reason).toContain('No auth cookies');
      expect(result.reason).toContain('login indicators');
    });

    it('URL redirect but has logged-in element: zero score (boundary)', () => {
      const result = computeSessionValidityScore({
        isLoginUrl: true,
        hasAuthCookie: true,
        hasLoginText: false,
        hasLoggedInElement: true,
      });
      expect(result.valid).toBe(false);
      expect(result.score).toBe(0);
    });

    it('no auth cookie but has logged-in element: net positive', () => {
      const result = computeSessionValidityScore({
        isLoginUrl: false,
        hasAuthCookie: false,
        hasLoginText: false,
        hasLoggedInElement: true,
      });
      expect(result.valid).toBe(true);
      expect(result.score).toBe(1);
    });

    it('no auth cookie + login text + element: zero score (boundary)', () => {
      const result = computeSessionValidityScore({
        isLoginUrl: false,
        hasAuthCookie: false,
        hasLoginText: true,
        hasLoggedInElement: true,
      });
      expect(result.valid).toBe(false);
      expect(result.score).toBe(0);
    });

    it('login URL + no auth: strong negative', () => {
      const result = computeSessionValidityScore({
        isLoginUrl: true,
        hasAuthCookie: false,
        hasLoginText: false,
        hasLoggedInElement: false,
      });
      expect(result.valid).toBe(false);
      expect(result.score).toBe(-5);
    });

    it('only login text: mild negative', () => {
      const result = computeSessionValidityScore({
        isLoginUrl: false,
        hasAuthCookie: true,
        hasLoginText: true,
        hasLoggedInElement: false,
      });
      expect(result.valid).toBe(false);
      expect(result.score).toBe(-1);
    });

    it('login text + element: element outweighs text', () => {
      const result = computeSessionValidityScore({
        isLoginUrl: false,
        hasAuthCookie: true,
        hasLoginText: true,
        hasLoggedInElement: true,
      });
      expect(result.valid).toBe(true);
      expect(result.score).toBe(2);
    });

    it('empty checks object defaults to all false (score -2)', () => {
      const result = computeSessionValidityScore({});
      expect(result.valid).toBe(false);
      expect(result.score).toBe(-2);
    });

    it('null/undefined checks handled gracefully', () => {
      const result = computeSessionValidityScore(null);
      expect(result.valid).toBe(false);
      expect(typeof result.score).toBe('number');
      expect(typeof result.reason).toBe('string');
    });

    it('includes matchedSelector in reason when provided', () => {
      const result = computeSessionValidityScore({
        isLoginUrl: false,
        hasAuthCookie: true,
        hasLoginText: false,
        hasLoggedInElement: true,
        matchedSelector: '.user-avatar',
      });
      expect(result.reason).toContain('.user-avatar');
    });
  });
});
