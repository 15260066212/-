'use strict';

/**
 * Error patterns for classifying login failures from page text.
 * Ordered by priority — first match wins.
 */
const LOGIN_ERROR_PATTERNS = [
  { pattern: /密码错误|账号或密码|密码不正确|incorrect/i, type: 'invalid_credentials' },
  { pattern: /账号不存在|用户不存在|未注册/i, type: 'invalid_credentials' },
  { pattern: /验证码|captcha|geetest/i, type: 'captcha' },
  { pattern: /频率|稍后|frequent|too many/i, type: 'rate_limited' },
  { pattern: /网络错误|network error|net::ERR|connection|timeout/i, type: 'network' },
];

/**
 * Classify a login error type from page text content.
 *
 * @param {string} pageText - Text content of the page after failed login
 * @returns {'invalid_credentials'|'captcha'|'rate_limited'|'network'|'unknown'}
 */
function classifyLoginError(pageText) {
  if (!pageText || typeof pageText !== 'string') {
    return 'unknown';
  }

  for (const { pattern, type } of LOGIN_ERROR_PATTERNS) {
    if (pattern.test(pageText)) {
      return type;
    }
  }

  return 'unknown';
}

module.exports = {
  classifyLoginError,
  LOGIN_ERROR_PATTERNS,
};
