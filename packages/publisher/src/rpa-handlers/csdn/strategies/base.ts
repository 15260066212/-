import type { Page } from 'playwright';
import type { Article } from '@zemingengine/shared';
import { markdownToHtml } from '../../../utils/markdown.js';
import type { PublishResult } from '../../../types.js';
import { RpaTimeout } from '../../base.js';
import type { CsdnPublishStrategy } from './types.js';
import type { CsdnRpaHandler } from '../../csdn.js';

/**
 * Base class for CSDN publish strategies.
 *
 * Contains shared utility methods used across all three strategies:
 * - Response parsing (saveArticle API)
 * - URL / article ID extraction
 * - Publish button clicking and dialog handling
 * - Visibility enforcement
 * - Screenshot capture (delegates to handler)
 * - Old-editor content filling (shared by S2 and S3)
 * - Draft management helpers (used by S3)
 */
export abstract class BaseCsdnStrategy implements CsdnPublishStrategy {
  abstract readonly name: string;
  abstract execute(page: Page, article: Article): Promise<PublishResult>;

  /** Standard timeout values, mirrored from RpaHandler. */
  protected readonly timeouts = RpaTimeout;

  constructor(protected readonly handler: CsdnRpaHandler) {}

  // ===========================================================================
  // Helper: Parse saveArticle API response
  // ===========================================================================

  protected parseSaveArticleResponse(
    captured: { status: number; body: string },
    currentUrl: string,
  ): PublishResult {
    try {
      const data = JSON.parse(captured.body);

      if (data.code === 200 || data.code === 0) {
        let articleUrl = '';
        let articleId = '';

        if (data.data && typeof data.data === 'object') {
          articleUrl = data.data.url || data.data.article_url || '';
          articleId = String(data.data.article_id || data.data.id || '');
        } else if (typeof data.data === 'string') {
          // data is a string like "成功" — try to extract from other fields
          articleUrl = data.url || data.article_url || '';
          articleId = String(data.article_id || data.id || '');
        }

        // If we have an article ID but no URL, construct the URL
        if (articleId && !articleUrl) {
          // Try to find username from current page or use default pattern
          articleUrl = `https://blog.csdn.net/article/details/${articleId}`;
        }

        if (articleUrl || articleId) {
          console.log(`[CSDN RPA] Publish confirmed! URL: ${articleUrl}, ID: ${articleId}`);
          return {
            success: true,
            postId: articleId,
            postUrl: articleUrl,
            verificationStatus: 'api_confirmed',
            verificationMessage: 'CSDN saveArticle API returned success with article URL',
          };
        }

        // API returned success code but no URL — verify via URL change
        if (currentUrl.includes('blog.csdn.net') && currentUrl.includes('/article/details/')) {
          return {
            success: true,
            postUrl: currentUrl,
            postId: this.extractArticleIdFromUrl(currentUrl),
            verificationStatus: 'verified',
            verificationMessage: 'Article published (URL navigation confirmed after API success)',
          };
        }

        // API returned success but no article URL/ID — this means the article
        // was likely saved as a DRAFT, not actually published.
        // Return as draft_saved so the caller can distinguish from real publication.
        console.warn('[CSDN RPA] API returned success but no article URL — likely saved as draft only');
        return {
          success: false,
          draftSaved: true,
          verificationStatus: 'draft_saved',
          verificationMessage: `CSDN saveArticle API returned success (code=${data.code}, msg="${data.msg || data.data}") but no article URL was returned. The article was likely saved as a draft, not published.`,
          error: 'Article saved as draft only, not published. No article URL returned by API.',
        };
      }

      // Handle rate limiting specifically
      if (data.msg && data.msg.includes('频繁')) {
        return {
          success: false,
          error: `Rate limited: ${data.msg}`,
          retryable: true,
          retryAfterMs: 60000, // Retry after 60 seconds
        } as PublishResult & { retryable: boolean; retryAfterMs: number };
      }

      return {
        success: false,
        error: `API error: code=${data.code}, msg=${data.msg}`,
      };
    } catch {
      return {
        success: false,
        error: `Non-JSON response: ${captured.body.substring(0, 300)}`,
      };
    }
  }

  // ===========================================================================
  // Helper: Extract article ID from CSDN blog URL
  // ===========================================================================

  protected extractArticleIdFromUrl(url: string): string {
    const match = url.match(/\/article\/details\/(\d+)/);
    return match ? match[1] : '';
  }

  // ===========================================================================
  // Helper: Check if a saveArticle response body contains a real article URL
  // ===========================================================================

  protected responseHasArticleUrl(body: string): boolean {
    try {
      const data = JSON.parse(body);
      if (data.data && typeof data.data === 'object') {
        const url = data.data.url || data.data.article_url || '';
        return url.includes('/article/details/') || url.includes('blog.csdn.net');
      }
      return false;
    } catch {
      return false;
    }
  }

  // ===========================================================================
  // Helper: Click the "发布文章" publish button
  // ===========================================================================

  protected async clickPublishButton(page: Page): Promise<boolean> {
    const publishSelectors = [
      // New editor (editor.csdn.net/md/) - primary publish button
      'button:has-text("发布文章")',
      'button:has-text("发布")',
      'a:has-text("发布文章")',
      '.btn-publish',
      'button.btn-publish',
      'button.publish-btn',
      '.toolbar-item:has-text("发布文章")',
      'button:has-text("发表文章")',
      'button:has-text("发表")',
      // New CSDN editor - sidebar / top bar publish buttons
      '.editor-header button:has-text("发布")',
      '.toolbar-right button:has-text("发布")',
      '.publish-bar button:has-text("发布")',
      '.article-bar button:has-text("发布")',
      'div[class*="publish"] button:has-text("发布")',
      'div[class*="Publish"] button:has-text("发布")',
      // Icon + text buttons
      'button:has(span:has-text("发布"))',
      '.el-button--primary:has-text("发布")',
      '.ant-btn-primary:has-text("发布")',
      // Fallback: primary-colored button with publish icon
      'button.primary-btn',
      '.editor-footer .btn-primary',
    ];

    for (const sel of publishSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: this.timeouts.LONG })) {
          await btn.click();
          console.log(`[CSDN RPA] Publish button clicked via: ${sel}`);
          return true;
        }
      } catch {
        // try next
      }
    }

    // Last resort: find any clickable element with "发布" text near top/right of page
    try {
      const clicked = await page.evaluate(() => {
        const candidates = Array.from(document.querySelectorAll('button, a, div[role="button"], span'));
        for (const el of candidates) {
          const text = (el.textContent || '').trim();
          if ((text === '发布文章' || text === '发布') && el.getBoundingClientRect().width > 30) {
            const rect = el.getBoundingClientRect();
            // Prefer buttons in the top-right area (publish buttons are usually there)
            if (rect.top < window.innerHeight * 0.4 && rect.left > window.innerWidth * 0.5) {
              (el as HTMLElement).click();
              return true;
            }
          }
        }
        // If no top-right match, try any visible publish button
        for (const el of candidates) {
          const text = (el.textContent || '').trim();
          if (text === '发布文章' || text === '发布') {
            const rect = el.getBoundingClientRect();
            if (rect.width > 30 && rect.height > 20) {
              (el as HTMLElement).click();
              return true;
            }
          }
        }
        return false;
      });
      if (clicked) {
        console.log('[CSDN RPA] Publish button clicked via DOM fallback search');
        return true;
      }
    } catch {
      // continue
    }

    return false;
  }

  // ===========================================================================
  // Helper: Handle the publish dialog that appears after clicking "发布文章"
  // ===========================================================================

  protected async handlePublishDialog(page: Page): Promise<void> {
    // Wait for dialog to appear
    await page.waitForTimeout(this.timeouts.LONG);

    // The publish dialog may contain:
    // 1. Column selection (专栏) — usually has a default, can skip
    // 2. Visibility toggle (公开/私密) — ensure "公开" is selected
    // 3. Tags confirmation
    // 4. A final "发布" or "确认发布" button

    // Try to find and click "确认发布" / "发布" in the dialog
    const dialogConfirmSelectors = [
      '.el-dialog button:has-text("发布")',
      '.modal button:has-text("发布")',
      '.dialog button:has-text("发布")',
      '.el-dialog button:has-text("确认发布")',
      '.modal button:has-text("确认发布")',
      'button:has-text("确认发布")',
      '.publish-dialog button:has-text("发布")',
      '.el-dialog__footer button:has-text("发布")',
    ];

    for (const sel of dialogConfirmSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: this.timeouts.LONG })) {
          // First, try to ensure visibility is set to "公开" (public)
          await this.ensurePublicVisibility(page);

          await btn.click();
          console.log(`[CSDN RPA] Dialog confirm clicked via: ${sel}`);
          await page.waitForTimeout(this.timeouts.EXTRA_LONG);
          return;
        }
      } catch {
        // try next
      }
    }

    // If no dialog appeared, the article might have been published directly
    console.log('[CSDN RPA] No publish dialog detected — article may have been published directly');
  }

  // ===========================================================================
  // Helper: Ensure "公开" (public) visibility is selected in dialog
  // ===========================================================================

  protected async ensurePublicVisibility(page: Page): Promise<void> {
    const visibilitySelectors = [
      'label:has-text("公开") input',
      '.radio:has-text("公开") input',
      'input[value="public"]',
      '.visibility-option:has-text("公开")',
    ];

    for (const sel of visibilitySelectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: this.timeouts.MEDIUM })) {
          const isChecked = await el.isChecked().catch(() => false);
          if (!isChecked) {
            await el.click();
            console.log('[CSDN RPA] Set visibility to "公开" (public)');
          }
          return;
        }
      } catch {
        // try next
      }
    }
  }

  // ===========================================================================
  // Helper: Capture screenshot (delegates to RpaHandler base)
  // ===========================================================================

  protected async captureScreenshot(page: Page, label: string): Promise<string> {
    // Access the protected captureScreenshot method via the handler reference.
    // Using type assertion since all strategies are internal implementation
    // details of CsdnRpaHandler and live in the same module.
    return (this.handler as unknown as {
      captureScreenshot(page: Page, label: string): Promise<string>;
    }).captureScreenshot(page, label);
  }

  // ===========================================================================
  // Old-editor content fillers (shared by Strategy 2 and Strategy 3)
  // ===========================================================================

  protected async fillTitleOldEditor(page: Page, title: string): Promise<boolean> {
    // Wait for title input to appear
    try {
      await page.waitForSelector('#txtTitle, input[placeholder*="标题"]', {
        timeout: this.timeouts.EXTRA_LONG,
      });
    } catch {
      // continue
    }

    try {
      const titleInput = page.locator('#txtTitle').first();
      if (await titleInput.isVisible({ timeout: this.timeouts.DEFAULT })) {
        await titleInput.click();
        await page.waitForTimeout(100);
        await titleInput.fill(title);
        const value = await titleInput.inputValue().catch(() => '');
        if (value && value.length > 0) {
          console.log('[CSDN RPA-S2] Title filled via #txtTitle (verified)');
          return true;
        }
        // Native setter fallback
        const filled = await page.evaluate((t: string) => {
          const el = document.querySelector('#txtTitle') as HTMLInputElement | null;
          if (el) {
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
            if (nativeSetter) nativeSetter.call(el, t);
            else el.value = t;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
          return false;
        }, title);
        if (filled) {
          console.log('[CSDN RPA-S2] Title filled via #txtTitle (native setter)');
          return true;
        }
      }
    } catch {
      // try next
    }

    const titleSelectors = [
      'input[placeholder*="请输入标题"]',
      'input[placeholder*="输入文章标题"]',
      'textarea[placeholder*="请输入标题"]',
      'input[placeholder*="标题"]',
      'textarea[placeholder*="标题"]',
      'input.article-title',
      '#article-title',
      'input[name="title"]',
      '.title-input input',
      '.title-container input',
      '[class*="title"] input',
    ];
    for (const sel of titleSelectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: this.timeouts.LONG })) {
          const id = await el.getAttribute('id') ?? '';
          const cls = await el.getAttribute('class') ?? '';
          const type = await el.getAttribute('type') ?? '';
          if (id.includes('search') || cls.includes('search') || type === 'search') continue;
          await el.click();
          await page.waitForTimeout(100);
          await el.fill(title);
          const value = await el.inputValue().catch(() => '');
          if (value && value.length > 0) {
            console.log(`[CSDN RPA-S2] Title filled via selector: ${sel}`);
            return true;
          }
        }
      } catch {
        // try next
      }
    }

    // Last resort: DOM search
    try {
      const filled = await page.evaluate((t: string) => {
        const inputs = Array.from(document.querySelectorAll('input, textarea'));
        for (const input of inputs) {
          const placeholder = (input as HTMLInputElement).getAttribute('placeholder') || '';
          const id = (input as HTMLInputElement).id || '';
          const cls = (input as HTMLInputElement).className || '';
          if (
            placeholder.includes('标题') ||
            placeholder.includes('title') ||
            id.includes('title') ||
            (typeof cls === 'string' && cls.includes('title'))
          ) {
            const nativeSetter = Object.getOwnPropertyDescriptor(
              (input.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement : window.HTMLInputElement).prototype,
              'value'
            )?.set;
            if (nativeSetter) nativeSetter.call(input, t);
            else (input as HTMLInputElement).value = t;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
        }
        return false;
      }, title);
      if (filled) {
        console.log('[CSDN RPA-S2] Title filled via DOM search fallback');
        return true;
      }
    } catch {
      // continue
    }

    return false;
  }

  protected async fillContentOldEditor(page: Page, markdownContent: string): Promise<boolean> {
    const htmlContent = markdownToHtml(markdownContent);

    // Approach 1: CKEditor JavaScript API
    try {
      const filled = await page.evaluate((html: string) => {
        const ckeditor = (window as any).CKEDITOR;
        if (ckeditor && ckeditor.instances) {
          for (const inst of Object.values(ckeditor.instances)) {
            const editor = inst as any;
            if (editor.setData) {
              editor.setData(html);
              return true;
            }
          }
        }
        return false;
      }, htmlContent);
      if (filled) {
        console.log('[CSDN RPA-S2] Content filled via CKEditor API');
        await page.waitForTimeout(this.timeouts.SHORT);
        return true;
      }
    } catch {
      // continue
    }

    // Approach 2: CKEditor iframe body
    try {
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        const frameUrl = frame.url();
        if (frameUrl.includes('cke') || frameUrl.includes('editor')) {
          try {
            const body = frame.locator('body').first();
            if (await body.isVisible({ timeout: this.timeouts.EXTRA_LONG })) {
              await frame.evaluate((html: string) => {
                document.body.innerHTML = html;
              }, htmlContent);
              console.log('[CSDN RPA-S2] Content filled via CKEditor iframe');
              return true;
            }
          } catch {
            // try next frame
          }
        }
      }
    } catch {
      // continue
    }

    // Approach 3: All iframes for contenteditable body
    try {
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        try {
          const body = frame.locator('body[contenteditable], body').first();
          if (await body.isVisible({ timeout: this.timeouts.LONG })) {
            const designMode = await frame.evaluate(() => document.designMode);
            if (designMode === 'on' || (await body.getAttribute('contenteditable'))) {
              await frame.evaluate((html: string) => {
                document.body.innerHTML = html;
              }, htmlContent);
              console.log('[CSDN RPA-S2] Content filled via iframe body');
              return true;
            }
          }
        } catch {
          // try next
        }
      }
    } catch {
      // continue
    }

    // Approach 4: Textarea fallback
    const textareaSelectors = [
      'textarea#content',
      'textarea[name="content"]',
      'textarea[name="markdowncontent"]',
      'textarea.editor-content',
    ];
    for (const sel of textareaSelectors) {
      try {
        const textarea = page.locator(sel).first();
        if (await textarea.isVisible({ timeout: this.timeouts.LONG })) {
          await textarea.fill(markdownContent);
          console.log(`[CSDN RPA-S2] Content filled via textarea: ${sel}`);
          return true;
        }
      } catch {
        // continue
      }
    }

    return false;
  }

  protected async addTagsOldEditor(page: Page, tags: string[]): Promise<void> {
    // Delegate to RpaHandler base addTags with CSDN old-editor defaults
    // (no extra selectors, max 5 tags)
    await (this.handler as unknown as {
      addTags(page: Page, tags: string[], extraSelectors?: string[], maxTags?: number): Promise<void>;
    }).addTags(page, tags, [], 5);
  }

  // ===========================================================================
  // Draft management helpers (used by Strategy 3)
  // ===========================================================================

  protected async clickSaveDraftButton(page: Page): Promise<boolean> {
    const draftSelectors = [
      'button:has-text("保存草稿")',
      'button:has-text("存为草稿")',
      '.btn-edit:has-text("保存草稿")',
      'button.btn:has-text("保存草稿")',
      'button:has-text("保存")',
    ];

    for (const sel of draftSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: this.timeouts.EXTRA_LONG })) {
          await btn.click();
          console.log(`[CSDN RPA-S3] Draft button clicked via: ${sel}`);
          return true;
        }
      } catch {
        // try next
      }
    }

    return false;
  }

  protected async findAndPublishDraft(
    page: Page,
    articleId: string,
    articleTitle: string,
  ): Promise<{ success: boolean; url?: string; error?: string }> {
    try {
      // Wait for the article list to load
      await page.waitForSelector('.article-list, .blog-list, table.article-table, .my-list', {
        timeout: this.timeouts.EXTENDED,
      });
      await page.waitForTimeout(this.timeouts.LONG);

      // Strategy A: Look for the article by ID in the page content
      const foundById = await this.findAndClickPublishInList(page, articleId);
      if (foundById) {
        return { success: true };
      }

      // Strategy B: Look for the article by title
      const foundByTitle = await this.findAndClickPublishByTitle(page, articleTitle);
      if (foundByTitle) {
        return { success: true };
      }

      // Strategy C: Publish the first draft in the list
      const foundFirst = await this.findAndClickFirstDraft(page);
      if (foundFirst) {
        return { success: true };
      }

      return { success: false, error: 'Could not find draft article in management page list' };
    } catch (e) {
      return {
        success: false,
        error: `Management page error: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  private async findAndClickPublishInList(page: Page, articleId: string): Promise<boolean> {
    try {
      // Look for elements containing the article ID
      const selectors = [
        `a[href*="${articleId}"]`,
        `[data-id="${articleId}"]`,
        `tr:has-text("${articleId}")`,
        `.article-item:has-text("${articleId}")`,
        `.blog-list-item:has-text("${articleId}")`,
      ];

      for (const sel of selectors) {
        try {
          const item = page.locator(sel).first();
          if (await item.isVisible({ timeout: this.timeouts.LONG })) {
            // Find the "发布" button within this item
            const publishBtn = item.locator('button:has-text("发布"), a:has-text("发布"), .btn:has-text("发布")').first();
            if (await publishBtn.isVisible({ timeout: this.timeouts.LONG })) {
              await publishBtn.click();
              console.log(`[CSDN RPA-S3] Clicked "发布" for article ID: ${articleId}`);
              await page.waitForTimeout(this.timeouts.EXTRA_LONG);
              return true;
            }
          }
        } catch {
          // try next
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  private async findAndClickPublishByTitle(page: Page, title: string): Promise<boolean> {
    try {
      // Use a substring of the title (first 20 chars) to avoid matching issues
      const titleSnippet = title.substring(0, 20);
      const item = page.locator(`tr:has-text("${titleSnippet}"), .article-item:has-text("${titleSnippet}"), .blog-list-item:has-text("${titleSnippet}")`).first();

      if (await item.isVisible({ timeout: this.timeouts.EXTRA_LONG })) {
        const publishBtn = item.locator('button:has-text("发布"), a:has-text("发布"), .btn:has-text("发布")').first();
        if (await publishBtn.isVisible({ timeout: this.timeouts.LONG })) {
          await publishBtn.click();
          console.log(`[CSDN RPA-S3] Clicked "发布" for article: ${titleSnippet}`);
          await page.waitForTimeout(this.timeouts.EXTRA_LONG);
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  private async findAndClickFirstDraft(page: Page): Promise<boolean> {
    try {
      const publishBtn = page.locator('button:has-text("发布"), a:has-text("发布"), .btn:has-text("发布")').first();
      if (await publishBtn.isVisible({ timeout: this.timeouts.EXTRA_LONG })) {
        await publishBtn.click();
        console.log('[CSDN RPA-S3] Clicked "发布" on first draft in list');
        await page.waitForTimeout(this.timeouts.EXTRA_LONG);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}
