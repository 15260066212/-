import { describe, it, expect } from 'vitest';
import { classifyCaptchaType } from '../../lib/captcha-classifier.js';

describe('captcha-classifier', () => {
  describe('classifyCaptchaType', () => {
    it('classifies geetest selector as slider', () => {
      expect(classifyCaptchaType('.geetest_slider_button')).toBe('slider', 'geetest_slider_button class should be classified as slider');
      expect(classifyCaptchaType('.geetest_widget')).toBe('slider', 'geetest_widget class should be classified as slider');
      expect(classifyCaptchaType('.geetest_panel')).toBe('slider', 'geetest_panel class should be classified as slider');
    });

    it('classifies slider keyword as slider', () => {
      expect(classifyCaptchaType('.captcha-slider')).toBe('slider', 'captcha-slider class should be classified as slider');
    });

    it('classifies nc_ prefix as slider (netease captcha)', () => {
      expect(classifyCaptchaType('.nc_wrapper')).toBe('slider', 'nc_wrapper class should be classified as slider');
      expect(classifyCaptchaType('.nc_container')).toBe('slider', 'nc_container class should be classified as slider');
    });

    it('classifies img selectors as image type', () => {
      expect(classifyCaptchaType('img[src*="captcha"]')).toBe('image', 'img selector with captcha in src should be classified as image');
    });

    it('classifies canvas selectors as image type', () => {
      expect(classifyCaptchaType('canvas[id*="captcha"]')).toBe('image', 'canvas selector with captcha in id should be classified as image');
    });

    it('classifies image keyword as image type', () => {
      expect(classifyCaptchaType('.image-captcha')).toBe('image', 'image-captcha class should be classified as image');
    });

    it('classifies verify-modal as behavioral', () => {
      expect(classifyCaptchaType('[class*="verify"][class*="modal"]')).toBe('behavioral', 'selector with both verify and modal should be classified as behavioral');
      expect(classifyCaptchaType('.verify-modal-container')).toBe('behavioral');
    });

    it('classifies captcha-modal as image (no verify keyword)', () => {
      expect(classifyCaptchaType('[class*="captcha"][class*="modal"]')).toBe('image');
    });

    it('classifies iframe captcha as behavioral', () => {
      expect(classifyCaptchaType('iframe[src*="captcha"]')).toBe('behavioral');
      expect(classifyCaptchaType('iframe[src*="verify"]')).toBe('behavioral');
    });

    it('returns unknown for empty/null selector', () => {
      expect(classifyCaptchaType('')).toBe('unknown');
      expect(classifyCaptchaType(null)).toBe('unknown');
      expect(classifyCaptchaType(undefined)).toBe('unknown');
    });

    it('defaults to image for generic captcha selectors', () => {
      expect(classifyCaptchaType('.captcha')).toBe('image');
      expect(classifyCaptchaType('#captcha')).toBe('image');
      expect(classifyCaptchaType('.verify-wrap')).toBe('image');
    });

    it('is case insensitive', () => {
      expect(classifyCaptchaType('.GEETEST_slider')).toBe('slider');
      expect(classifyCaptchaType('.IMG-captcha')).toBe('image');
    });
  });
});
