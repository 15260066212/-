import type { Page } from 'playwright';
import { SimpleRpaHandler } from './base.js';

/**
 * Bilibili (哔哩哔哩) RPA handler - publishes articles via browser automation.
 * Requires cookie-based authentication (SESSDATA, bili_jct, DedeUserID, etc.)
 *
 * Publishing flow:
 * 1. Navigate to https://member.bilibili.com/article-text/home
 * 2. Fill in title
 * 3. Fill in content (Quill editor)
 * 4. Add tags if tag input available
 * 5. Select category if dropdown available (skip if not found)
 * 6. Click publish button
 * 7. Extract the published article URL
 */
export class BilibiliRpaHandler extends SimpleRpaHandler {
  protected readonly cookieDomain = '.bilibili.com';
  protected readonly titleSelectors = ['input.title', 'input[placeholder*="标题"]'];
  protected readonly contentEditorSelectors = ['.ql-editor'];
  protected readonly maxTags = 10;
  protected readonly publishButtonSelectors = ['button:has-text("发布")', '.submit-btn'];
  protected readonly hasConfirmDialog = false;
  protected readonly postIdPatterns = [/cv(\d+)/, /read\/(\d+)/];
  protected readonly platformDisplayName = 'Bilibili';

  constructor() {
    super('bilibili');
  }

  /**
   * Select category from the dropdown if available.
   * Category selection is optional — silently skipped if not found.
   */
  protected override async selectCategory(page: Page): Promise<void> {
    try {
      const categoryDropdown = page.locator('.category-select, select.category, .dropdown.category').first();
      if (await categoryDropdown.isVisible({ timeout: this.timeouts.EXTRA_LONG })) {
        await categoryDropdown.click();
        await page.waitForTimeout(this.timeouts.SHORT);
        // Select the first available category option
        await this.clickElement(page, '.category-option, .dropdown-item', this.timeouts.EXTRA_LONG);
        await page.waitForTimeout(this.timeouts.SHORT);
      }
    } catch {
      // Category selection is optional, skip if not found
    }
  }
}
