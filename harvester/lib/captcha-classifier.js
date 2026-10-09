'use strict';

/**
 * Classify captcha type from a CSS selector string.
 *
 * Classification rules (checked in order):
 *   - slider: geetest, slider, nc_ (netease captcha)
 *   - image: img, canvas, image, or generic fallback
 *   - behavioral: verify-modal, iframe-based captcha
 *
 * @param {string} selector - CSS selector string
 * @returns {'slider'|'image'|'behavioral'|'unknown'}
 */
function classifyCaptchaType(selector) {
  if (!selector || typeof selector !== 'string') {
    return 'unknown';
  }

  const lower = selector.toLowerCase();

  if (lower.includes('geetest') || lower.includes('slider')) {
    return 'slider';
  }
  if (lower.includes('nc_')) {
    return 'slider';
  }
  if (lower.includes('img') || lower.includes('canvas') || lower.includes('image')) {
    return 'image';
  }
  if (lower.includes('verify') && lower.includes('modal')) {
    return 'behavioral';
  }
  if (lower.includes('iframe')) {
    return 'behavioral';
  }

  // Default fallback
  return 'image';
}

module.exports = {
  classifyCaptchaType,
};
