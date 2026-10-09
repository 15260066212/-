import { type Article, type PlatformCredentials, getPlatformEditorUrl } from '@zemingengine/shared';
import type { Page } from 'playwright';
import type { PublishResult } from '../types.js';
import { RpaHandler } from './base.js';

/**
 * Zhihu RPA handler - publishes articles via browser automation.
 * Requires cookie-based authentication (z_c0, q_c1, or unlock_ticket cookie)
 *
 * Publishing flow:
 * 1. Navigate to https://zhuanlan.zhihu.com/write
 * 2. Fill in title
 * 3. Fill in content (rich text editor)
 * 4. Click publish button
 * 5. Extract the published article URL
 */
export class ZhihuRpaHandler extends RpaHandler {
  constructor() {
    super('zhihu');
  }

  async publish(page: Page, article: Article, credentials: PlatformCredentials): Promise<PublishResult> {
    const domain = '.zhihu.com';
    const cookies = this.parseCookies(credentials, domain);

    if (cookies.length === 0) {
      return { success: false, error: 'No cookies found in credentials for Zhihu' };
    }

    // Check for any valid auth cookie (z_c0 legacy, q_c1 new, or unlock_ticket)
    const hasAuthCookie = cookies.some((c) =>
      c.name === 'z_c0' || c.name === 'q_c1' || c.name === 'unlock_ticket'
    );
    if (!hasAuthCookie) {
      return { success: false, error: 'Missing auth cookie (z_c0/q_c1/unlock_ticket) - Zhihu authentication required' };
    }

    try {
      // Step 1: Two-step navigation — zhihu's SPA may abort direct editor URL navigation
      // First navigate to the main page to establish session, then to the editor
      try {
        await page.goto('https://www.zhihu.com/', {
          waitUntil: 'commit',
          timeout: this.timeouts.PAGE_NAVIGATION,
        });
        await page.waitForTimeout(3000);
      } catch {
        // Main page navigation might fail, but cookies are set — try editor directly
      }

      // Now navigate to the editor page
      try {
        await page.goto(getPlatformEditorUrl(this.platform)!, {
          waitUntil: 'commit',
          timeout: this.timeouts.PAGE_NAVIGATION,
        });
        await page.waitForTimeout(5000);
      } catch (navErr) {
        const fallbackUrl = page.url();
        if (fallbackUrl.includes('sign') || fallbackUrl.includes('login')) {
          await this.captureScreenshot(page, 'auth_failed');
          return { success: false, error: 'Zhihu authentication failed - cookies may be expired' };
        }
        console.log('[Zhihu RPA] Navigation warning:', navErr instanceof Error ? navErr.message : 'unknown');
      }

      // Wait for the title input to appear (zhihu SPA takes time to render)
      try {
        await page.waitForSelector(
          'textarea.ColumnWriteEditor-titleInput, input[placeholder*="标题"], textarea[placeholder*="标题"]',
          { timeout: 15000 }
        );
      } catch {
        // Title input not found — might be a different editor version
        await this.captureScreenshot(page, 'title_not_found');
        return { success: false, error: 'Zhihu editor did not load — cookies may be expired or page redirected' };
      }

      // Verify authentication
      const currentUrl = page.url();
      if (currentUrl.includes('sign') || currentUrl.includes('login')) {
        await this.captureScreenshot(page, 'auth_failed');
        return { success: false, error: 'Zhihu authentication failed - cookies may be expired' };
      }

      // Step 2: Fill in the title
      const titleFilled = await this.fillInput(page, 'textarea.ColumnWriteEditor-titleInput', article.title)
        || await this.fillInput(page, 'input[placeholder*="标题"]', article.title);

      if (!titleFilled) {
        await this.captureScreenshot(page, 'title_failed');
        return { success: false, error: 'Failed to fill article title on Zhihu' };
      }

      // Step 3: Fill in the content using the rich text editor
      const contentFilled = await this.fillRichTextEditor(page, article.contentMarkdown, ['.public-DraftEditor-content']);
      if (!contentFilled) {
        await this.captureScreenshot(page, 'content_failed');
        return { success: false, error: 'Failed to fill article content on Zhihu' };
      }

      // Step 4: Add tags if supported
      if (article.tags.length > 0) {
        await this.addTopics(page, article.tags);
      }

      // Step 5: Click publish button
      await page.waitForTimeout(this.timeouts.MEDIUM);
      const publishClicked = await this.clickElement(page, 'button:has-text("发布")', this.timeouts.EXTENDED)
        || await this.clickElement(page, 'button.PublishPanel-triggerButton', this.timeouts.DEFAULT);

      if (!publishClicked) {
        await this.captureScreenshot(page, 'publish_failed');
        return { success: false, error: 'Failed to click publish button on Zhihu' };
      }

      // Step 6: Handle publish dialog if it appears
      await page.waitForTimeout(this.timeouts.LONG);
      await this.clickElement(page, 'button:has-text("确认并发布")', this.timeouts.DEFAULT)
        || await this.clickElement(page, 'button.Button--primary', this.timeouts.DEFAULT);

      // Step 7: Wait for navigation to published article
      await page.waitForTimeout(this.timeouts.EXTRA_LONG);
      const publishedUrl = page.url();

      // Extract article ID from URL (format: https://zhuanlan.zhihu.com/p/XXXXX)
      const postIdMatch = publishedUrl.match(/\/p\/(\d+)/);
      const postId = postIdMatch ? postIdMatch[1] : `zhihu_${Date.now()}`;

      return {
        success: true,
        postId,
        postUrl: publishedUrl,
      };
    } catch (err) {
      await this.captureScreenshot(page, 'error');
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown Zhihu RPA error',
      };
    }
  }

  private async addTopics(page: Page, tags: string[]): Promise<void> {
    try {
      // Click the "添加话题" button
      const topicButton = page.locator('button:has-text("话题"), .TopicSelector-button').first();
      if (await topicButton.isVisible({ timeout: this.timeouts.EXTRA_LONG })) {
        await topicButton.click();
        await page.waitForTimeout(this.timeouts.SHORT);

        for (const tag of tags.slice(0, 5)) {
          try {
            const topicInput = page.locator('input[placeholder*="话题"], input.TopicInput').first();
            if (await topicInput.isVisible({ timeout: this.timeouts.LONG })) {
              await topicInput.fill(tag);
              await page.waitForTimeout(this.timeouts.MEDIUM);
              await page.keyboard.press('Enter');
              await page.waitForTimeout(this.timeouts.SHORT);
            }
          } catch {
            // Skip this topic
          }
        }
      }
    } catch {
      // Topics are optional, don't fail the publish
    }
  }
}
