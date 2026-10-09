import type { Page } from 'playwright';
import type { Article } from '@zemingengine/shared';
import type { PublishResult } from '../../../types.js';
import { BaseCsdnStrategy } from './base.js';

/**
 * Strategy 3: Draft + Management Page Publish
 *
 * Save the article as a draft in the old editor, then navigate to the draft
 * management page and click "发布" on the matching draft. Used as the last
 * resort when direct publish buttons don't work.
 */
export class DraftManagementStrategy extends BaseCsdnStrategy {
  readonly name = 'Draft + Management Page';

  async execute(page: Page, article: Article): Promise<PublishResult> {
    let capturedResponse: { status: number; body: string } | null = null;

    try {
      // Step 1: Navigate to old editor
      console.log('[CSDN RPA-S3] Navigating to old editor for draft save...');
      await page.goto('https://mp.csdn.net/mp_blog/creation/editor', {
        waitUntil: 'domcontentloaded',
        timeout: this.timeouts.PAGE_NAVIGATION,
      });
      await page.waitForTimeout(this.timeouts.DEFAULT);

      if (page.url().includes('login') || page.url().includes('passport')) {
        return { success: false, error: 'CSDN authentication failed' };
      }

      // Step 2: Set up response listener
      page.on('response', async (response) => {
        if (response.url().includes('saveArticle')) {
          try {
            const body = await response.text();
            capturedResponse = { status: response.status(), body };
            console.log('[CSDN RPA-S3] saveArticle response:', response.status(), body.substring(0, 300));
          } catch {
            // body already consumed
          }
        }
      });

      // Step 3: Fill title and content
      await this.fillTitleOldEditor(page, article.title);
      await this.fillContentOldEditor(page, article.contentMarkdown);
      if (article.tags.length > 0) {
        await this.addTagsOldEditor(page, article.tags);
      }

      // Step 4: Save as draft
      console.log('[CSDN RPA-S3] Saving as draft...');
      await page.waitForTimeout(this.timeouts.MEDIUM);
      const draftClicked = await this.clickSaveDraftButton(page);
      if (!draftClicked) {
        await page.keyboard.press('Control+s');
      }

      // Wait for draft save response
      let waitCount = 0;
      while (!capturedResponse && waitCount < 30) {
        await page.waitForTimeout(this.timeouts.SHORT);
        waitCount++;
      }

      if (!capturedResponse) {
        return { success: false, error: 'Draft save did not produce a saveArticle response' };
      }

      const draftResp: { status: number; body: string } = capturedResponse;
      let articleId = '';
      let articleUrl = '';

      try {
        const draftData = JSON.parse(draftResp.body);
        if (draftData.code === 200 && draftData.data && typeof draftData.data === 'object') {
          articleId = String(draftData.data.article_id || draftData.data.id || '');
          articleUrl = draftData.data.url || draftData.data.article_url || '';
          console.log(`[CSDN RPA-S3] Draft saved! ID: ${articleId}, URL: ${articleUrl}`);
        } else {
          return {
            success: false,
            error: `Draft save failed: code=${draftData.code}, msg=${draftData.msg}`,
          };
        }
      } catch {
        return { success: false, error: `Non-JSON draft response: ${draftResp.body.substring(0, 200)}` };
      }

      if (!articleId) {
        return { success: false, error: 'Could not extract article_id from draft response' };
      }

      // Step 5: Navigate to draft management page
      console.log('[CSDN RPA-S3] Navigating to draft management page...');
      await page.goto('https://mp.csdn.net/mp_blog/manage/article?type=draft', {
        waitUntil: 'domcontentloaded',
        timeout: this.timeouts.PAGE_NAVIGATION,
      });
      await page.waitForTimeout(this.timeouts.EXTRA_LONG);

      // Step 6: Find the draft article and click "发布"
      console.log('[CSDN RPA-S3] Looking for draft article to publish...');
      const published = await this.findAndPublishDraft(page, articleId, article.title);

      if (published.success) {
        return {
          success: true,
          postId: articleId,
          postUrl: published.url || articleUrl || `https://blog.csdn.net/article/details/${articleId}`,
          verificationStatus: 'verified',
          verificationMessage: 'Article published from management page draft list',
        };
      }

      return {
        success: false,
        error: `Could not publish draft from management page: ${published.error}`,
        postId: articleId,
        postUrl: articleUrl,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error in draft+management strategy',
      };
    }
  }
}
