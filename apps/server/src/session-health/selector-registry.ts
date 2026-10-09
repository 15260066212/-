/**
 * Selector Registry — Centralized registry of all CSS selectors used in
 * RPA automation across 11 publishing platforms.
 *
 * Organized by platform and purpose (login, session check, publishing).
 * Each entry includes a fallback chain: if selector[0] fails, try selector[1], etc.
 *
 * The SelectorMonitor periodically validates these against live platform pages
 * to detect structural changes before they cause publish failures.
 */

import { PLATFORM_URLS } from '@zemingengine/shared';

export interface SelectorEntry {
  /** CSS selector string (Playwright format) */
  selector: string;
  /** What this selector targets */
  purpose: SelectorPurpose;
}

export type SelectorPurpose =
  | 'login_username'
  | 'login_password'
  | 'login_submit'
  | 'login_switch_mode'
  | 'login_captcha'
  | 'session_check_element'
  | 'publish_title_input'
  | 'publish_content_editor'
  | 'publish_button'
  | 'publish_confirm_button'
  | 'publish_tag_input'
  | 'publish_category_select';

export interface PlatformSelectorSet {
  platform: string;
  /** Page to navigate to for validation (editor or publish page URL) */
  validateUrl: string;
  /** Login page URL (for login selectors) */
  loginUrl?: string;
  /** Success URL pattern after login */
  successUrlPattern?: string;
  /** Selectors grouped by purpose */
  selectors: SelectorEntry[];
}

export const SELECTOR_REGISTRY: PlatformSelectorSet[] = [
  // === ZHIHU ===
  {
    platform: 'zhihu',
    validateUrl: PLATFORM_URLS.zhihu!,
    loginUrl: 'https://www.zhihu.com/signin',
    successUrlPattern: 'zhihu.com',
    selectors: [
      { selector: 'textarea.ColumnWriteEditor-titleInput', purpose: 'publish_title_input' },
      { selector: 'input[placeholder*="标题"]', purpose: 'publish_title_input' },
      { selector: '.ProseMirror', purpose: 'publish_content_editor' },
      { selector: '.public-DraftEditor-content', purpose: 'publish_content_editor' },
      { selector: '[contenteditable="true"]', purpose: 'publish_content_editor' },
      { selector: 'textarea.editor', purpose: 'publish_content_editor' },
      { selector: 'button:has-text("发布")', purpose: 'publish_button' },
      { selector: 'button.PublishPanel-triggerButton', purpose: 'publish_button' },
      { selector: 'button:has-text("确认并发布")', purpose: 'publish_confirm_button' },
      { selector: 'button.Button--primary', purpose: 'publish_confirm_button' },
      { selector: 'img.Avatar', purpose: 'session_check_element' },
      { selector: '.AppHeader-userInfo', purpose: 'session_check_element' },
      { selector: '.ProfileHeader-name', purpose: 'session_check_element' },
    ],
  },

  // === BAIJIA (百家号) ===
  {
    platform: 'baijia',
    validateUrl: PLATFORM_URLS.baijia!,
    loginUrl: 'https://baijiahao.baidu.com',
    successUrlPattern: 'baijiahao.baidu.com',
    selectors: [
      { selector: 'input.editor-title', purpose: 'publish_title_input' },
      { selector: 'input[placeholder*="标题"]', purpose: 'publish_title_input' },
      { selector: '.editor-content', purpose: 'publish_content_editor' },
      { selector: '.ProseMirror', purpose: 'publish_content_editor' },
      { selector: '.ql-editor', purpose: 'publish_content_editor' },
      { selector: '[contenteditable="true"]', purpose: 'publish_content_editor' },
      { selector: 'textarea.editor-content', purpose: 'publish_content_editor' },
      { selector: 'button:has-text("发布")', purpose: 'publish_button' },
      { selector: '.publish-btn', purpose: 'publish_button' },
      { selector: 'button:has-text("确认发布")', purpose: 'publish_confirm_button' },
      { selector: '.btn-confirm', purpose: 'publish_confirm_button' },
      { selector: '.builder-home', purpose: 'session_check_element' },
      { selector: '.home-index', purpose: 'session_check_element' },
      { selector: '.u-wrap-header', purpose: 'session_check_element' },
    ],
  },

  // === TOUTIAO (头条号) ===
  {
    platform: 'toutiao',
    validateUrl: PLATFORM_URLS.toutiao!,
    loginUrl: 'https://mp.toutiao.com',
    successUrlPattern: 'mp.toutiao.com',
    selectors: [
      { selector: 'input[placeholder*="标题"]', purpose: 'publish_title_input' },
      { selector: '.title-input input', purpose: 'publish_title_input' },
      { selector: '.ProseMirror', purpose: 'publish_content_editor' },
      { selector: '.ql-editor', purpose: 'publish_content_editor' },
      { selector: '[contenteditable="true"]', purpose: 'publish_content_editor' },
      { selector: 'button:has-text("发布")', purpose: 'publish_button' },
      { selector: '.publish-btn', purpose: 'publish_button' },
      { selector: 'button:has-text("确认发布")', purpose: 'publish_confirm_button' },
      { selector: '.btn-confirm', purpose: 'publish_confirm_button' },
      { selector: '.profile-v4', purpose: 'session_check_element' },
      { selector: '.index-module', purpose: 'session_check_element' },
      { selector: '.user-info', purpose: 'session_check_element' },
    ],
  },

  // === CSDN ===
  {
    platform: 'csdn',
    validateUrl: PLATFORM_URLS.csdn!,
    loginUrl: 'https://passport.csdn.net/login',
    successUrlPattern: 'csdn.net',
    selectors: [
      { selector: '.article-bar__input', purpose: 'publish_title_input' },
      { selector: '#txtTitle', purpose: 'publish_title_input' },
      { selector: 'input[placeholder*="标题"]', purpose: 'publish_title_input' },
      { selector: 'input.article-title', purpose: 'publish_title_input' },
      { selector: 'textarea[name="content"]', purpose: 'publish_content_editor' },
      { selector: 'textarea.editor-textarea', purpose: 'publish_content_editor' },
      { selector: '.CodeMirror', purpose: 'publish_content_editor' },
      { selector: '.cm-editor', purpose: 'publish_content_editor' },
      { selector: '.editor-area', purpose: 'publish_content_editor' },
      { selector: '[contenteditable="true"]', purpose: 'publish_content_editor' },
      { selector: 'button:has-text("发布文章")', purpose: 'publish_button' },
      { selector: 'button:has-text("发布")', purpose: 'publish_button' },
      { selector: '.btn-publish', purpose: 'publish_button' },
      { selector: 'button.btn-publish', purpose: 'publish_button' },
      { selector: 'button.publish-btn', purpose: 'publish_button' },
      { selector: 'input[placeholder*="标签"]', purpose: 'publish_tag_input' },
      { selector: '.tag-input input', purpose: 'publish_tag_input' },
      { selector: '.toolbar-search', purpose: 'session_check_element' },
      { selector: '#csdn-toolbar', purpose: 'session_check_element' },
      { selector: '.blog-content', purpose: 'session_check_element' },
      // Login form selectors
      { selector: 'input[type="text"], input[name="username"]', purpose: 'login_username' },
      { selector: 'input[type="password"]', purpose: 'login_password' },
      { selector: 'button[type="submit"], button:has-text("登录")', purpose: 'login_submit' },
      { selector: '.geetest, .captcha, #captcha', purpose: 'login_captcha' },
    ],
  },

  // === JUEJIN (掘金) ===
  {
    platform: 'juejin',
    validateUrl: PLATFORM_URLS.juejin!,
    loginUrl: 'https://juejin.cn/login',
    successUrlPattern: 'juejin.cn',
    selectors: [
      { selector: 'input.draft_title', purpose: 'publish_title_input' },
      { selector: 'textarea[placeholder*="标题"]', purpose: 'publish_title_input' },
      { selector: '.title-input input', purpose: 'publish_title_input' },
      { selector: '.CodeMirror', purpose: 'publish_content_editor' },
      { selector: '.mono-editor', purpose: 'publish_content_editor' },
      { selector: '[contenteditable="true"]', purpose: 'publish_content_editor' },
      { selector: 'button:has-text("发布")', purpose: 'publish_button' },
      { selector: 'input[placeholder*="标签"]', purpose: 'publish_tag_input' },
      { selector: '.drafts', purpose: 'session_check_element' },
      { selector: '.publish-panel', purpose: 'session_check_element' },
      { selector: '.entry-publish-form', purpose: 'session_check_element' },
      // Login form selectors
      { selector: 'input[placeholder*="手机"], input[type="tel"]', purpose: 'login_username' },
      { selector: 'input[type="password"]', purpose: 'login_password' },
      { selector: 'button:has-text("登录")', purpose: 'login_submit' },
    ],
  },

  // === BILIBILI (B站) ===
  {
    platform: 'bilibili',
    validateUrl: PLATFORM_URLS.bilibili!,
    loginUrl: 'https://passport.bilibili.com/login',
    successUrlPattern: 'bilibili.com',
    selectors: [
      { selector: 'input.title', purpose: 'publish_title_input' },
      { selector: 'input[placeholder*="标题"]', purpose: 'publish_title_input' },
      { selector: '.ql-editor', purpose: 'publish_content_editor' },
      { selector: '.ProseMirror', purpose: 'publish_content_editor' },
      { selector: '[contenteditable="true"]', purpose: 'publish_content_editor' },
      { selector: 'button:has-text("发布")', purpose: 'publish_button' },
      { selector: '.submit-btn', purpose: 'publish_button' },
      { selector: 'input[placeholder*="标签"]', purpose: 'publish_tag_input' },
      { selector: '.home-container', purpose: 'session_check_element' },
      { selector: '.user-avatar', purpose: 'session_check_element' },
      { selector: '.h-body', purpose: 'session_check_element' },
      // Login form selectors
      { selector: 'input[type="text"], input[name="username"]', purpose: 'login_username' },
      { selector: 'input[type="password"]', purpose: 'login_password' },
      { selector: 'button:has-text("登录"), .btn-login', purpose: 'login_submit' },
      { selector: '.geetest, .captcha, #captcha', purpose: 'login_captcha' },
    ],
  },

  // === SOHU (搜狐号) ===
  {
    platform: 'sohu',
    validateUrl: PLATFORM_URLS.sohu!,
    loginUrl: 'https://mp.sohu.com',
    successUrlPattern: 'mp.sohu.com',
    selectors: [
      { selector: 'input[placeholder*="标题"]', purpose: 'publish_title_input' },
      { selector: '.article-title input', purpose: 'publish_title_input' },
      { selector: '.editor-content', purpose: 'publish_content_editor' },
      { selector: '.ProseMirror', purpose: 'publish_content_editor' },
      { selector: '.ql-editor', purpose: 'publish_content_editor' },
      { selector: '[contenteditable="true"]', purpose: 'publish_content_editor' },
      { selector: 'button:has-text("发布")', purpose: 'publish_button' },
      { selector: '.publish-btn', purpose: 'publish_button' },
      { selector: '.mp-sohu', purpose: 'session_check_element' },
      { selector: '.home-container', purpose: 'session_check_element' },
    ],
  },

  // === NETEASE (网易号) ===
  {
    platform: 'netease',
    validateUrl: PLATFORM_URLS.netease!,
    loginUrl: 'https://mp.163.com',
    successUrlPattern: 'mp.163.com',
    selectors: [
      { selector: 'input[placeholder*="标题"]', purpose: 'publish_title_input' },
      { selector: '.title-input input', purpose: 'publish_title_input' },
      { selector: '.editor-content', purpose: 'publish_content_editor' },
      { selector: '.ProseMirror', purpose: 'publish_content_editor' },
      { selector: '.ql-editor', purpose: 'publish_content_editor' },
      { selector: '[contenteditable="true"]', purpose: 'publish_content_editor' },
      { selector: 'button:has-text("发布")', purpose: 'publish_button' },
      { selector: '.publish-btn', purpose: 'publish_button' },
      { selector: '.mp-163', purpose: 'session_check_element' },
      { selector: '.home-container', purpose: 'session_check_element' },
    ],
  },

  // === ZHIDAO (百度知道) ===
  {
    platform: 'zhidao',
    validateUrl: PLATFORM_URLS.zhidao!,
    loginUrl: 'https://passport.baidu.com/v2/?login',
    successUrlPattern: 'zhidao.baidu.com',
    selectors: [
      { selector: '#ask-title-input', purpose: 'publish_title_input' },
      { selector: 'input.ask-title', purpose: 'publish_title_input' },
      { selector: 'input[placeholder*="提问"]', purpose: 'publish_title_input' },
      { selector: '#ask-content', purpose: 'publish_content_editor' },
      { selector: 'textarea.ask-detail', purpose: 'publish_content_editor' },
      { selector: 'button:has-text("提交")', purpose: 'publish_button' },
      { selector: 'button:has-text("发布")', purpose: 'publish_button' },
      { selector: '.user-bar', purpose: 'session_check_element' },
      { selector: '.user-name', purpose: 'session_check_element' },
    ],
  },

  // === WECHAT (微信公众号) — session check only, publishing is API-based ===
  {
    platform: 'wechat',
    validateUrl: 'https://mp.weixin.qq.com/',
    loginUrl: 'https://mp.weixin.qq.com',
    successUrlPattern: 'mp.weixin.qq.com',
    selectors: [
      { selector: '.account_info', purpose: 'session_check_element' },
      { selector: '.weui-desktop-card', purpose: 'session_check_element' },
      { selector: '.card_content', purpose: 'session_check_element' },
    ],
  },
];

/** Get a platform's selector set by platform name. */
export function getPlatformSelectors(platform: string): PlatformSelectorSet | undefined {
  return SELECTOR_REGISTRY.find((s) => s.platform === platform);
}
