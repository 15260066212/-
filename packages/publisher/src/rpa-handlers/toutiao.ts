import { SimpleRpaHandler } from './base.js';

/**
 * Toutiao (头条号) RPA handler - publishes articles via browser automation.
 * Requires cookie-based authentication (sessionid, ttwid, etc.)
 *
 * Publishing flow:
 * 1. Navigate to https://mp.toutiao.com/profile_v4/graphic/publish
 * 2. Fill in title
 * 3. Fill in content (ProseMirror editor)
 * 4. Set cover image (optional)
 * 5. Click publish button
 * 6. Handle confirmation dialog
 * 7. Extract the published article URL
 */
export class ToutiaoRpaHandler extends SimpleRpaHandler {
  protected readonly cookieDomain = '.toutiao.com';
  protected readonly loginUrlKeywords = ['login', 'sso', 'passport'];
  protected readonly platformDisplayName = 'Toutiao';

  protected readonly titleSelectors = [
    'input[placeholder*="请输入标题"]',
    'input[placeholder*="输入文章标题"]',
    'input[placeholder*="文章标题"]',
    'input[placeholder*="标题"]',
    'textarea[placeholder*="请输入标题"]',
    '.article-title input',
    '.title-input input',
    '.title-editor input',
    '[class*="title"] input',
    '[class*="title"] textarea',
  ];

  protected readonly contentEditorSelectors = [
    '.ProseMirror',
    '.prose-editor',
    '.editor-content',
    '.content-editor',
    '.article-editor',
    '[class*="prose"]',
  ];

  protected readonly enableTags = false; // Toutiao uses topics/categories differently

  protected readonly publishButtonSelectors = [
    'button:has-text("发布")',
    '.publish-btn',
    '.btn-publish',
    'button[class*="publish"]',
    '.byte-btn--primary',
  ];

  protected readonly hasConfirmDialog = true;

  protected readonly confirmButtonSelectors = [
    'button:has-text("确认发布")',
    'button:has-text("确认")',
    '.btn-confirm',
    '.confirm-btn',
    '.dialog-footer .byte-btn--primary',
  ];

  protected readonly postIdPatterns = [
    /toutiao\.com\/article\/(\d+)/,
    /toutiao\.com\/group\/(\d+)/,
    /article\/(\d{15,})/,
  ];

  constructor() {
    super('toutiao');
  }

  /**
   * Hook: Enter the editor. For Toutiao, we may need to:
   * - Close onboarding popups
   * - Wait for the ProseMirror editor to initialize
   */
  protected async enterEditor(page: import('playwright').Page): Promise<boolean> {
    // Wait for editor frame to load
    try {
      await page.waitForSelector([
        ...this.titleSelectors,
        ...this.contentEditorSelectors,
      ].join(', '), {
        timeout: this.timeouts.EXTRA_LONG,
      });
    } catch {
      // Continue even if wait fails
    }

    // Close popups (welcome, guide, etc.)
    try {
      await page.evaluate(() => {
        const closeButtons = document.querySelectorAll(
          '.close-btn, .close-icon, [class*="close"], .byte-drawer__close'
        );
        Array.from(closeButtons).forEach((btn) => {
          const rect = (btn as HTMLElement).getBoundingClientRect();
          if (rect.width > 0 && rect.width < 60 && rect.height > 0) {
            const text = (btn as HTMLElement).textContent?.trim() || '';
            if (
              text === '×' ||
              text === '关闭' ||
              text === '跳过' ||
              text === '我知道了'
            ) {
              (btn as HTMLElement).click();
            }
          }
        });
      });
      await page.waitForTimeout(800);
    } catch {
      // Optional
    }

    return true;
  }
}
