import type { Page } from 'playwright';
import type { Article } from '@zemingengine/shared';
import type { PublishResult } from '../../../types.js';
import { BaseCsdnStrategy } from './base.js';

/**
 * Strategy 2: Old Editor + Publish Button
 *
 * Navigate to mp.csdn.net/mp_blog/creation/editor, fill title / HTML content
 * via CKEditor / tags, click "发布文章" button (NOT "保存草稿"), handle the
 * publish dialog, and capture the saveArticle response.
 */
export class OldEditorStrategy extends BaseCsdnStrategy {
  readonly name = 'Old Editor + Publish Button';

  async execute(page: Page, article: Article): Promise<PublishResult> {
    let capturedResponse: { status: number; body: string } | null = null;

    try {
      // Step 1: Navigate to the old CSDN editor
      console.log('[CSDN RPA-S2] Navigating to old editor...');
      await page.goto('https://mp.csdn.net/mp_blog/creation/editor', {
        waitUntil: 'domcontentloaded',
        timeout: this.timeouts.PAGE_NAVIGATION,
      });
      await page.waitForTimeout(this.timeouts.DEFAULT);

      const currentUrl = page.url();
      if (currentUrl.includes('login') || currentUrl.includes('passport')) {
        return { success: false, error: 'CSDN authentication failed - cookies may be expired' };
      }
      console.log('[CSDN RPA-S2] Old editor loaded at:', currentUrl);

      // Step 2: Set up response listener
      page.on('response', async (response) => {
        if (response.url().includes('saveArticle')) {
          try {
            const body = await response.text();
            capturedResponse = { status: response.status(), body };
            console.log('[CSDN RPA-S2] saveArticle response:', response.status(), body.substring(0, 300));
          } catch {
            // body already consumed
          }
        }
      });

      // Step 3: Fill title
      console.log('[CSDN RPA-S2] Filling title...');
      const titleFilled = await this.fillTitleOldEditor(page, article.title);
      if (!titleFilled) {
        return { success: false, error: 'Failed to fill title in old editor' };
      }

      // Step 4: Fill content (HTML via CKEditor)
      console.log('[CSDN RPA-S2] Filling content...');
      const contentFilled = await this.fillContentOldEditor(page, article.contentMarkdown);
      if (!contentFilled) {
        return { success: false, error: 'Failed to fill content in old editor' };
      }

      // Step 5: Add tags
      if (article.tags.length > 0) {
        console.log('[CSDN RPA-S2] Adding tags...');
        await this.addTagsOldEditor(page, article.tags);
      }

      // Step 6: Click "发布文章" button (NOT "保存草稿")
      console.log('[CSDN RPA-S2] Clicking "发布文章" button...');
      await page.waitForTimeout(this.timeouts.MEDIUM);
      const publishClicked = await this.clickPublishButton(page);
      if (!publishClicked) {
        // Fallback: try Ctrl+Enter (CSDN keyboard shortcut for publish)
        console.log('[CSDN RPA-S2] Publish button not found, trying Ctrl+Enter...');
        await page.keyboard.press('Control+Enter');
      }

      // Step 7: Handle publish dialog
      console.log('[CSDN RPA-S2] Handling publish dialog...');
      await this.handlePublishDialog(page);

      // Step 8: Wait for response
      console.log('[CSDN RPA-S2] Waiting for saveArticle response...');
      let waitCount = 0;
      while (!capturedResponse && waitCount < 30) {
        await page.waitForTimeout(this.timeouts.SHORT);
        waitCount++;
      }

      if (capturedResponse) {
        return this.parseSaveArticleResponse(capturedResponse, page.url());
      }

      // Check URL change
      const finalUrl = page.url();
      if (finalUrl.includes('blog.csdn.net') && finalUrl.includes('/article/details/')) {
        return {
          success: true,
          postUrl: finalUrl,
          postId: this.extractArticleIdFromUrl(finalUrl),
          verificationStatus: 'verified',
          verificationMessage: 'Article published via old editor (URL navigation confirmed)',
        };
      }

      return { success: false, error: 'No saveArticle response captured in old editor strategy' };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error in old editor strategy',
      };
    }
  }
}
