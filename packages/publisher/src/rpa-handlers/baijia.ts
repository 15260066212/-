import { SimpleRpaHandler } from './base.js';

/**
 * Baijiahao (百家号) RPA handler - publishes articles via browser automation.
 * Requires cookie-based authentication (BDUSS, STOKEN, etc.)
 *
 * Publishing flow:
 * 1. Navigate to https://baijiahao.baidu.com/builder/rc/edit?type=news
 * 2. Fill in title
 * 3. Fill in content (rich text editor / UEditor)
 * 4. Add tags if available
 * 5. Click publish button
 * 6. Handle confirmation dialog
 * 7. Extract the published article URL
 */
export class BaijiaRpaHandler extends SimpleRpaHandler {
  protected readonly cookieDomain = '.baijiahao.baidu.com';
  protected readonly loginUrlKeywords = ['login', 'passport', 'ucenter'];
  protected readonly platformDisplayName = 'Baijiahao';

  protected readonly titleSelectors = [
    'input.editor-title',
    'input[placeholder*="请输入标题"]',
    'input[placeholder*="输入文章标题"]',
    'input[placeholder*="标题"]',
    'textarea[placeholder*="请输入标题"]',
    '.article-title input',
    '.title-input input',
    '.title-wrap input',
    '[class*="title"] input',
  ];

  protected readonly contentEditorSelectors = [
    '.editor-content',
    '.ueditor',
    '.article-content',
    '.content-editor',
    '[class*="editor-content"]',
  ];

  protected readonly enableTags = true;
  protected readonly maxTags = 5;

  protected readonly publishButtonSelectors = [
    'button:has-text("发布")',
    '.publish-btn',
    '.btn-publish',
    'button[class*="publish"]',
  ];

  protected readonly hasConfirmDialog = true;

  protected readonly confirmButtonSelectors = [
    'button:has-text("确认发布")',
    'button:has-text("确认")',
    '.btn-confirm',
    '.confirm-btn',
    '.dialog-footer button.primary',
  ];

  protected readonly postIdPatterns = [
    /baijiahao\.baidu\.com\/s\?id=(\d+)/,
    /id=(\d{15,})/,
  ];

  constructor() {
    super('baijia');
  }

  /**
   * Hook: Enter the editor. For Baijiahao, we may need to close
   * welcome popups or switch to the correct tab.
   */
  protected async enterEditor(page: import('playwright').Page): Promise<boolean> {
    // Wait for editor to load
    try {
      await page.waitForSelector(this.titleSelectors.join(', '), {
        timeout: this.timeouts.EXTRA_LONG,
      });
    } catch {
      // Title input might have different selectors, continue anyway
    }

    // Close any potential popups (新手引导, 活动弹窗, etc.)
    try {
      await page.evaluate(() => {
        const closeButtons = document.querySelectorAll('.close-btn, .close, [class*="close"]');
        Array.from(closeButtons).forEach((btn) => {
          const rect = (btn as HTMLElement).getBoundingClientRect();
          if (rect.width > 0 && rect.width < 50 && rect.height > 0) {
            const text = (btn as HTMLElement).textContent?.trim() || '';
            if (text === '×' || text === '关闭' || text === '跳过') {
              (btn as HTMLElement).click();
            }
          }
        });
      });
      await page.waitForTimeout(500);
    } catch {
      // Popup closing is optional
    }

    return true;
  }
}
