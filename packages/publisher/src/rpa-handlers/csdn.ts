import { type Article, type PlatformCredentials } from '@zemingengine/shared';
import type { Page } from 'playwright';
import type { PublishResult } from '../types.js';
import { RpaHandler } from './base.js';
import { NewEditorStrategy } from './csdn/strategies/new-editor.strategy.js';
import { OldEditorStrategy } from './csdn/strategies/old-editor.strategy.js';
import { DraftManagementStrategy } from './csdn/strategies/draft-management.strategy.js';
import type { CsdnPublishStrategy } from './csdn/strategies/types.js';

/**
 * CSDN RPA handler - publishes articles using the real "发布文章" button.
 *
 * Uses the Strategy design pattern with three fallback strategies:
 *
 * Strategy 1 (New Markdown Editor):
 *   Navigate to editor.csdn.net/md/, fill title/Markdown content/tags,
 *   click "发布文章" button, handle publish dialog, capture saveArticle
 *   response (which returns the article URL when status=1 is sent by the
 *   real button — the frontend generates a valid signature).
 *
 * Strategy 2 (Old Editor + Publish Button):
 *   Navigate to mp.csdn.net/mp_blog/creation/editor, fill title/HTML
 *   content/tags via CKEditor, click "发布文章" button (NOT "保存草稿").
 *
 * Strategy 3 (Draft + Management Page):
 *   Save as draft, navigate to management page, find the draft, click
 *   its "发布" button. Used as last resort.
 *
 * The previous capture-and-replay approach (saving as draft then replaying
 * the saveArticle request with status=1) failed because modifying the
 * request body invalidated the Alibaba Cloud API Gateway signature
 * (x-ca-signature), even though the API returned "成功". Using the real
 * publish button ensures the frontend generates a correctly signed request.
 */
export class CsdnRpaHandler extends RpaHandler {
  private readonly strategies: CsdnPublishStrategy[];

  constructor() {
    super('csdn');
    this.strategies = [
      new NewEditorStrategy(this),
      new OldEditorStrategy(this),
      new DraftManagementStrategy(this),
    ];
  }

  async publish(page: Page, article: Article, credentials: PlatformCredentials): Promise<PublishResult> {
    const domain = '.csdn.net';
    const cookies = this.parseCookies(credentials, domain);

    if (cookies.length === 0) {
      return { success: false, error: 'No cookies found in credentials for CSDN' };
    }

    // Try each strategy in order, returning on first success
    for (let i = 0; i < this.strategies.length; i++) {
      const strategy = this.strategies[i];
      const strategyNum = i + 1;

      try {
        console.log(`[CSDN RPA] === Strategy ${strategyNum}: ${strategy.name} ===`);
        const result = await strategy.execute(page, article);
        if (result.success) return result;
        console.log(`[CSDN RPA] Strategy ${strategyNum} failed: ${result.error}`);
      } catch (e) {
        console.log(`[CSDN RPA] Strategy ${strategyNum} error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return {
      success: false,
      error: 'All three CSDN publish strategies failed. See logs above.',
    };
  }

  /**
   * Save the article as a CSDN draft without publishing.
   *
   * Uses the old editor to fill title/content/tags, then clicks the
   * "保存草稿" button and captures the saveArticle response to extract
   * the draft's article_id. The article remains in the CSDN draft box
   * until the user manually publishes it.
   */
  async saveDraft(page: Page, article: Article, credentials: PlatformCredentials): Promise<PublishResult> {
    const domain = '.csdn.net';
    const cookies = this.parseCookies(credentials, domain);

    if (cookies.length === 0) {
      return { success: false, error: 'No cookies found in credentials for CSDN' };
    }

    let capturedResponse: { status: number; body: string } | null = null;

    try {
      // Step 1: Navigate to old editor
      console.log('[CSDN RPA] Navigating to old editor for draft save...');
      await page.goto('https://mp.csdn.net/mp_blog/creation/editor', {
        waitUntil: 'domcontentloaded',
        timeout: this.timeouts.PAGE_NAVIGATION,
      });
      await page.waitForTimeout(this.timeouts.DEFAULT);

      if (page.url().includes('login') || page.url().includes('passport')) {
        return { success: false, error: 'CSDN authentication failed' };
      }

      // Step 2: Set up response listener for saveArticle
      page.on('response', async (response) => {
        if (response.url().includes('saveArticle')) {
          try {
            const body = await response.text();
            capturedResponse = { status: response.status(), body };
            console.log('[CSDN RPA] saveArticle response:', response.status(), body.substring(0, 300));
          } catch {
            // body already consumed
          }
        }
      });

      // Step 3: Fill title and content (reuse base helpers)
      const titleFilled = await this.fillInput(page, '#txtTitle', article.title)
        || await this.fillInput(page, 'input[placeholder*="标题"]', article.title);
      if (!titleFilled) {
        return { success: false, error: 'Failed to fill article title on CSDN' };
      }

      const contentFilled = await this.fillRichTextEditor(page, article.contentMarkdown);
      if (!contentFilled) {
        return { success: false, error: 'Failed to fill article content on CSDN' };
      }

      if (article.tags.length > 0) {
        await this.addTags(page, article.tags, [], 5);
      }

      // Step 4: Save as draft
      console.log('[CSDN RPA] Saving as draft...');
      await page.waitForTimeout(this.timeouts.MEDIUM);

      const draftSelectors = [
        'button:has-text("保存草稿")',
        'button:has-text("存为草稿")',
        '.btn-edit:has-text("保存草稿")',
        'button.btn:has-text("保存草稿")',
        'button:has-text("保存")',
      ];
      let draftClicked = false;
      for (const sel of draftSelectors) {
        if (await this.clickElement(page, sel, this.timeouts.EXTRA_LONG)) {
          draftClicked = true;
          break;
        }
      }
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

      try {
        const draftData = JSON.parse(capturedResponse.body);
        if (draftData.code === 200 && draftData.data && typeof draftData.data === 'object') {
          const articleId = String(draftData.data.article_id || draftData.data.id || '');
          const articleUrl = draftData.data.url || draftData.data.article_url
            || (articleId ? `https://blog.csdn.net/article/details/${articleId}` : '');
          console.log(`[CSDN RPA] Draft saved! ID: ${articleId}`);

          return {
            success: true,
            postId: articleId || `csdn_${Date.now()}`,
            postUrl: articleUrl,
            verificationStatus: 'draft_saved',
            verificationMessage: 'Article saved to CSDN draft box. Manual publication required.',
            draftSaved: true,
          };
        }
        return {
          success: false,
          error: `Draft save failed: code=${draftData.code}, msg=${draftData.msg}`,
        };
      } catch {
        return { success: false, error: `Non-JSON draft response: ${capturedResponse.body.substring(0, 200)}` };
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error in CSDN draft save',
      };
    }
  }
}
