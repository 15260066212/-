'use strict';

/**
 * Compute session validity score from multiple checks.
 *
 * Weighting:
 *   - URL redirect to login page: -3 (strongest negative signal)
 *   - No auth cookie: -2 (medium-strong negative)
 *   - Login text found on page: -1 (moderate negative)
 *   - Logged-in element found: +3 (strong positive signal)
 *
 * Session is considered valid when score > 0.
 *
 * @param {object} checks
 * @param {boolean} checks.isLoginUrl - Whether URL redirected to login page
 * @param {boolean} checks.hasAuthCookie - Whether auth cookies are present
 * @param {boolean} checks.hasLoginText - Whether page contains login text
 * @param {boolean} checks.hasLoggedInElement - Whether logged-in element is present
 * @param {string} [checks.matchedSelector] - The selector that matched (for reason)
 * @returns {{ valid: boolean, score: number, reason: string }}
 */
function computeSessionValidityScore(checks) {
  const {
    isLoginUrl = false,
    hasAuthCookie = false,
    hasLoginText = false,
    hasLoggedInElement = false,
    matchedSelector = '',
  } = checks || {};

  let score = 0;
  const reasons = [];

  if (isLoginUrl) {
    score -= 3;
    reasons.push('URL redirected to login page');
  }

  if (!hasAuthCookie) {
    score -= 2;
    reasons.push('No auth cookies found after navigation');
  }

  if (hasLoginText) {
    score -= 1;
    reasons.push('Page contains login indicators');
  }

  if (hasLoggedInElement) {
    score += 3;
    reasons.push(
      matchedSelector
        ? `Found logged-in element: ${matchedSelector}`
        : 'Found logged-in element'
    );
  }

  const valid = score > 0;
  const reason = reasons.length > 0 ? reasons.join('; ') : 'Session is valid';

  return { valid, score, reason };
}

module.exports = {
  computeSessionValidityScore,
};
