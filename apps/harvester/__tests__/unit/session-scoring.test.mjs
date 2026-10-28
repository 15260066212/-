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
      expect(result.valid).toBe(true, 'should return true when all valid: high positive score when logged-in element present and no bad signals');
      expect(result.score).toBeGreaterThan(0, 'should be greater than 0 for all valid: high positive score when logged-in element present and no bad signals');
      expect(result.score).toBe(3, 'should set score to 3 for all valid: high positive score when logged-in element present and no bad signals');
      expect(result.reason).toContain('logged-in element', 'should contain expected value in reason for all valid: high positive score when logged-in element present and no bad signals');
    });

    it('all invalid: low score when all bad signals present', () => {
      const result = computeSessionValidityScore({
        isLoginUrl: true,
        hasAuthCookie: false,
        hasLoginText: true,
        hasLoggedInElement: false,
      });
      expect(result.valid).toBe(false, 'should return false when all invalid: low score when all bad signals present');
      expect(result.score).toBeLessThan(0, 'should be less than 0 for all invalid: low score when all bad signals present');
      expect(result.score).toBe(-6, 'should set score to expected value for all invalid: low score when all bad signals present');
      expect(result.reason).toContain('login page', 'should contain expected value in reason for all invalid: low score when all bad signals present');
      expect(result.reason).toContain('No auth cookies', 'should contain expected value in reason for all invalid: low score when all bad signals present');
      expect(result.reason).toContain('login indicators', 'should contain expected value in reason for all invalid: low score when all bad signals present');
    });

    it('URL redirect but has logged-in element: zero score (boundary)', () => {
      const result = computeSessionValidityScore({
        isLoginUrl: true,
        hasAuthCookie: true,
        hasLoginText: false,
        hasLoggedInElement: true,
      });
      expect(result.valid).toBe(false, 'should return false when URL redirect but has logged-in element: zero score (boundary)');
      expect(result.score).toBe(0, 'should set score to 0 for URL redirect but has logged-in element: zero score (boundary)');
    });

    it('no auth cookie but has logged-in element: net positive', () => {
      const result = computeSessionValidityScore({
        isLoginUrl: false,
        hasAuthCookie: false,
        hasLoginText: false,
        hasLoggedInElement: true,
      });
      expect(result.valid).toBe(true, 'should return true when no auth cookie but has logged-in element: net positive');
      expect(result.score).toBe(1, 'should set score to 1 for no auth cookie but has logged-in element: net positive');
    });

    it('no auth cookie + login text + element: zero score (boundary)', () => {
      const result = computeSessionValidityScore({
        isLoginUrl: false,
        hasAuthCookie: false,
        hasLoginText: true,
        hasLoggedInElement: true,
      });
      expect(result.valid).toBe(false, 'should return false when no auth cookie + login text + element: zero score (boundary)');
      expect(result.score).toBe(0, 'should have correct score when no auth cookie + login text + element: zero score (boundary)');
    });

    it('login URL + no auth: strong negative', () => {
      const result = computeSessionValidityScore({
        isLoginUrl: true,
        hasAuthCookie: false,
        hasLoginText: false,
        hasLoggedInElement: false,
      });
      expect(result.valid).toBe(false, 'should have correct valid flag when login URL + no auth: strong negative');
      expect(result.score).toBe(-5, 'should have correct score when login URL + no auth: strong negative');
    });

    it('only login text: mild negative', () => {
      const result = computeSessionValidityScore({
        isLoginUrl: false,
        hasAuthCookie: true,
        hasLoginText: true,
        hasLoggedInElement: false,
      });
      expect(result.valid).toBe(false, 'should have correct valid flag when only login text: mild negative');
      expect(result.score).toBe(-1, 'should have correct score when only login text: mild negative');
    });

    it('login text + element: element outweighs text', () => {
      const result = computeSessionValidityScore({
        isLoginUrl: false,
        hasAuthCookie: true,
        hasLoginText: true,
        hasLoggedInElement: true,
      });
      expect(result.valid).toBe(true, 'should have correct valid flag when login text + element: element outweighs text');
      expect(result.score).toBe(2, 'should have correct score when login text + element: element outweighs text');
    });

    it('empty checks object defaults to all false (score -2)', () => {
      const result = computeSessionValidityScore({});
      expect(result.valid).toBe(false, 'should have correct valid flag when empty checks object defaults to all false (score -2)');
      expect(result.score).toBe(-2, 'should have correct score when empty checks object defaults to all false (score -2)');
    });

    it('null/undefined checks handled gracefully', () => {
      const result = computeSessionValidityScore(null);
      expect(result.valid).toBe(false, 'should have correct valid flag when null/undefined checks handled gracefully');
      expect(typeof result.score).toBe('number', 'should have correct score when null/undefined checks handled gracefully');
      expect(typeof result.reason).toBe('string', 'should have correct reason when null/undefined checks handled gracefully');
    });

    it('includes matchedSelector in reason when provided', () => {
      const result = computeSessionValidityScore({
        isLoginUrl: false,
        hasAuthCookie: true,
        hasLoginText: false,
        hasLoggedInElement: true,
        matchedSelector: '.user-avatar',
      });
      expect(result.reason).toContain('.user-avatar', 'should contain expected value in reason for includes matchedSelector in reason when provided');
    });
  });
});
