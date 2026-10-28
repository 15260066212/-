import { type Article, type PlatformCredentials, getPlatformEditorUrl } from '@zemingengine/shared';
import type { Page } from 'playwright';
import type { PublishResult } from '../types.js';
import { RpaHandler } from './base.js';

/**
 * Juejin RPA handler - publishes articles via browser automation.
 * Requires cookie-based authentication.
 *
 * Publishing flow:
 * 1. Navigate to https://juejin.cn/editor/drafts/new
 * 2. Fill in title
 * 3. Fill in Markdown content
 * 4. Add tags
 * 5. Click publish
 * 6. Extract published article URL
 */
export class JuejinRpaHandler extends RpaHandler {
  constructor() {
    super('juejin');
  }

  async publish(page: Page, article: Article, credentials: PlatformCredentials): Promise<PublishResult> {
    const domain = '.juejin.cn';
    const cookies = this.parseCookies(credentials, domain);

    if (cookies.length === 0) {
      return { success: false, error: 'No cookies found in credentials for Juejin' };
    }

    try {
      // Step 1: Navigate to Juejin draft editor
      await page.goto(getPlatformEditorUrl(this.platform)!, {
        waitUntil: 'domcontentloaded',
        timeout: this.timeouts.PAGE_NAVIGATION,
      });

      // Verify authentication
      if (page.url().includes('login') || page.url().includes('sign')) {
        await this.captureScreenshot(page, 'auth_failed');
        return { success: false, error: 'Juejin authentication failed - cookies may be expired' };
      }

      // Step 2: Fill in title
      const titleFilled = await this.fillInput(page, 'input.draft_title, textarea[placeholder*="标题"]', article.title)
        || await this.fillInput(page, '.title-input input', article.title);

      if (!titleFilled) {
        await this.captureScreenshot(page, 'title_failed');
        return { success: false, error: 'Failed to fill article title on Juejin' };
      }

      // Step 3: Fill content in the editor (CodeMirror-based)
      const contentFilled = await this.fillRichTextEditor(page, article.contentMarkdown, [
        '.CodeMirror',
        '.mono-editor',
      ]);
      if (!contentFilled) {
        await this.captureScreenshot(page, 'content_failed');
        return { success: false, error: 'Failed to fill article content on Juejin' };
      }

      // Step 4: Click publish button to open publish dialog
      await page.waitForTimeout(this.timeouts.MEDIUM);
      const publishClicked = await this.clickElement(page, 'button:has-text("发布")', this.timeouts.EXTENDED);
      if (!publishClicked) {
        await this.captureScreenshot(page, 'publish_failed');
        return { success: false, error: 'Failed to click publish button on Juejin' };
      }

      // Step 5: Add tags in the publish dialog
      await page.waitForTimeout(this.timeouts.MEDIUM);
      if (article.tags.length > 0) {
        await this.addTags(page, article.tags, ['input[placeholder*="搜索"]'], 3);
      }

      // Step 6: Confirm publish
      const confirmClicked = await this.clickElement(page, 'button:has-text("确认并发布")', this.timeouts.DEFAULT)
        || await this.clickElement(page, '.submit-btn', this.timeouts.DEFAULT);

      if (!confirmClicked) {
        await this.captureScreenshot(page, 'confirm_failed');
        return { success: false, error: 'Failed to confirm publish on Juejin' };
      }

      // Step 7: Wait for navigation
      await page.waitForTimeout(this.timeouts.EXTRA_LONG);
      const publishedUrl = page.url();
      const postIdMatch = publishedUrl.match(/\/post\/(\d+)/);
      const postId = postIdMatch ? postIdMatch[1] : `juejin_${Date.now()}`;

      return { success: true, postId, postUrl: publishedUrl };
    } catch (err) {
      await this.captureScreenshot(page, 'error');
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown Juejin RPA error',
      };
    }
  }

  /**
   * Save the article as a Juejin draft without publishing.
   *
   * Fills the title and Markdown content, then clicks the "存草稿" button.
   * The article remains in the Juejin draft box until the user manually
   * publishes it.
   */
  async saveDraft(page: Page, article: Article, credentials: PlatformCredentials): Promise<PublishResult> {
    const domain = '.juejin.cn';
    const cookies = this.parseCookies(credentials, domain);

    if (cookies.length === 0) {
      return { success: false, error: 'No cookies found in credentials for Juejin' };
    }

    try {
      await page.goto(getPlatformEditorUrl(this.platform)!, {
        waitUntil: 'domcontentloaded',
        timeout: this.timeouts.PAGE_NAVIGATION,
      });

      if (page.url().includes('login') || page.url().includes('sign')) {
        await this.captureScreenshot(page, 'auth_failed');
        return { success: false, error: 'Juejin authentication failed - cookies may be expired' };
      }

      // Fill title
      const titleFilled = await this.fillInput(page, 'input.draft_title, textarea[placeholder*="标题"]', article.title)
        || await this.fillInput(page, '.title-input input', article.title);
      if (!titleFilled) {
        return { success: false, error: 'Failed to fill article title on Juejin' };
      }

      // Fill content
      const contentFilled = await this.fillRichTextEditor(page, article.contentMarkdown, [
        '.CodeMirror',
        '.mono-editor',
      ]);
      if (!contentFilled) {
        return { success: false, error: 'Failed to fill article content on Juejin' };
      }

      // Click save-draft button
      await page.waitForTimeout(this.timeouts.MEDIUM);
      const draftClicked = await this.clickElement(page, 'button:has-text("存草稿")', this.timeouts.EXTENDED)
        || await this.clickElement(page, 'button:has-text("保存草稿")', this.timeouts.DEFAULT)
        || await this.clickElement(page, '.save-draft-btn', this.timeouts.DEFAULT);

      if (!draftClicked) {
        await this.captureScreenshot(page, 'draft_save_failed');
        return { success: false, error: 'Failed to click save-draft button on Juejin' };
      }

      await page.waitForTimeout(this.timeouts.EXTRA_LONG);

      return {
        success: true,
        postId: `juejin_${Date.now()}`,
        postUrl: page.url(),
        verificationStatus: 'draft_saved',
        verificationMessage: 'Article saved to Juejin draft box. Manual publication required.',
        draftSaved: true,
      };
    } catch (err) {
      await this.captureScreenshot(page, 'error');
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown Juejin RPA error',
      };
    }
  }
}
