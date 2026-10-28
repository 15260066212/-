import { describe, it, expect } from 'vitest';
import {
  SELECTOR_REGISTRY,
  getPlatformSelectors,
} from './selector-registry.js';

describe('SelectorRegistry', () => {
  describe('SELECTOR_REGISTRY 结构', () => {
    it('注册表非空', () => {
      expect(SELECTOR_REGISTRY.length).toBeGreaterThan(0);
    });

    it('包含 zhihu 平台', () => {
      const zhihu = SELECTOR_REGISTRY.find((s) => s.platform === 'zhihu');
      expect(zhihu).toBeDefined();
      expect(zhihu!.validateUrl).toContain('zhihu');
    });

    it('包含 toutiao 平台', () => {
      const toutiao = SELECTOR_REGISTRY.find((s) => s.platform === 'toutiao');
      expect(toutiao).toBeDefined();
      expect(toutiao!.selectors.length).toBeGreaterThan(0);
    });

    it('每个平台至少有 1 个选择器', () => {
      for (const set of SELECTOR_REGISTRY) {
        expect(set.selectors.length).toBeGreaterThan(0);
      }
    });

    it('每个平台都有 validateUrl', () => {
      for (const set of SELECTOR_REGISTRY) {
        expect(set.validateUrl.length).toBeGreaterThan(0);
      }
    });

    it('选择器都有 selector 和 purpose', () => {
      for (const set of SELECTOR_REGISTRY) {
        for (const entry of set.selectors) {
          expect(entry.selector).not.toBe('');
          expect(entry.purpose).not.toBe('');
        }
      }
    });

    it('purpose 值在合法范围内', () => {
      const validPurposes = new Set([
        'login_username', 'login_password', 'login_submit',
        'login_switch_mode', 'login_captcha',
        'session_check_element',
        'publish_title_input', 'publish_content_editor',
        'publish_button', 'publish_confirm_button',
        'publish_tag_input', 'publish_category_select',
      ]);
      for (const set of SELECTOR_REGISTRY) {
        for (const entry of set.selectors) {
          expect(validPurposes.has(entry.purpose)).toBe(true);
        }
      }
    });
  });

  describe('getPlatformSelectors', () => {
    it('按名称查找 zhihu', () => {
      const result = getPlatformSelectors('zhihu');
      expect(result).toBeDefined();
      expect(result!.platform).toBe('zhihu');
    });

    it('按名称查找 toutiao', () => {
      const result = getPlatformSelectors('toutiao');
      expect(result).toBeDefined();
      expect(result!.platform).toBe('toutiao');
    });

    it('查找未知平台返回 undefined', () => {
      expect(getPlatformSelectors('nonexistent')).toBeUndefined();
    });

    it('返回的选择器包含 session_check_element', () => {
      const zhihu = getPlatformSelectors('zhihu');
      const sessionCheckSelectors = zhihu!.selectors.filter(
        (s) => s.purpose === 'session_check_element',
      );
      expect(sessionCheckSelectors.length).toBeGreaterThan(0);
    });

    it('zhihu 有 publish_button 选择器', () => {
      const zhihu = getPlatformSelectors('zhihu');
      const publishBtn = zhihu!.selectors.filter(
        (s) => s.purpose === 'publish_button',
      );
      expect(publishBtn.length).toBeGreaterThan(0);
    });

    it('zhihu 有 publish_title_input 选择器', () => {
      const zhihu = getPlatformSelectors('zhihu');
      const titleInput = zhihu!.selectors.filter(
        (s) => s.purpose === 'publish_title_input',
      );
      expect(titleInput.length).toBeGreaterThan(0);
    });

    it('zhihu 有 publish_content_editor 选择器', () => {
      const zhihu = getPlatformSelectors('zhihu');
      const editor = zhihu!.selectors.filter(
        (s) => s.purpose === 'publish_content_editor',
      );
      expect(editor.length).toBeGreaterThan(0);
    });

    it('空字符串返回 undefined', () => {
      expect(getPlatformSelectors('')).toBeUndefined();
    });
  });
});
