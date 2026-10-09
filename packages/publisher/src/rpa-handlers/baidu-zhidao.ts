import { type Article, type PlatformCredentials, getPlatformEditorUrl } from '@zemingengine/shared';
import type { Page } from 'playwright';
import type { PublishResult } from '../types.js';
import { RpaHandler } from './base.js';

/**
 * Baidu Zhidao (百度知道) RPA handler - publishes Q&A content via browser automation.
 * Requires cookie-based authentication (BAIDUID, BDUSS, STOKEN, etc.)
 *
 * Supports two publishing modes:
 * 1. **Ask mode** (default): Post a new question. Article.title = question text.
 * 2. **Answer mode**: Answer an existing question. Requires `questionUrl` in
 *    credentials.data or article metadata. Article.contentMarkdown = answer text.
 *
 * The mode is determined by:
 * - If `credentials.data.questionUrl` exists → answer mode
 * - Otherwise → ask mode
 *
 * Publishing flow (Ask mode):
 * 1. Navigate to https://zhidao.baidu.com/ask
 * 2. Fill in question title
 * 3. Optionally fill in supplementary details
 * 4. Select category if prompted
 * 5. Click submit button
 * 6. Extract the question URL and ID
 *
 * Publishing flow (Answer mode):
 * 1. Navigate to the question URL
 * 2. Click "我来回答" or locate the answer editor
 * 3. Fill in the answer content
 * 4. Click submit button
 * 5. Extract the answer post URL
 */
export class BaiduZhidaoRpaHandler extends RpaHandler {
  constructor() {
    super('zhidao');
  }

  async publish(page: Page, article: Article, credentials: PlatformCredentials): Promise<PublishResult> {
    const domain = '.baidu.com';
    const cookies = this.parseCookies(credentials, domain);

    if (cookies.length === 0) {
      return { success: false, error: 'No cookies found in credentials for Baidu Zhidao' };
    }

    // Verify BDUSS cookie exists (required for Baidu auth)
    const hasAuthCookie = cookies.some((c) => c.name === 'BDUSS' || c.name === 'BAIDUID');
    if (!hasAuthCookie) {
      return { success: false, error: 'Missing BDUSS/BAIDUID cookie - Baidu authentication required' };
    }

    // Determine mode: answer if questionUrl is provided, otherwise ask
    const questionUrl = credentials.data.questionUrl || article.metadata?.questionUrl as string | undefined;

    if (questionUrl) {
      return this.answerQuestion(page, article, questionUrl);
    }
    return this.askQuestion(page, article);
  }

  /**
   * Ask a new question on Baidu Zhidao.
   * Uses article.title as the question text.
   */
  private async askQuestion(page: Page, article: Article): Promise<PublishResult> {
    try {
      // Step 1: Navigate to Baidu Zhidao ask page
      await page.goto(getPlatformEditorUrl(this.platform)!, {
        waitUntil: 'domcontentloaded',
        timeout: this.timeouts.PAGE_NAVIGATION,
      });

      // Verify authentication
      const currentUrl = page.url();
      if (currentUrl.includes('login') || currentUrl.includes('passport')) {
        await this.captureScreenshot(page, 'auth_failed');
        return { success: false, error: 'Baidu Zhidao authentication failed - cookies may be expired' };
      }

      // Step 2: Fill in the question title
      const questionText = article.title;
      const titleFilled = await this.fillInput(page, '#ask-title-input', questionText)
        || await this.fillInput(page, 'input.ask-title', questionText)
        || await this.fillInput(page, 'input[placeholder*="提问"]', questionText)
        || await this.fillInput(page, 'textarea[placeholder*="问题"]', questionText);

      if (!titleFilled) {
        await this.captureScreenshot(page, 'title_failed');
        return { success: false, error: 'Failed to fill question title on Baidu Zhidao' };
      }

      // Step 3: Fill in supplementary details if content is available
      if (article.contentMarkdown && article.contentMarkdown.trim()) {
        const detailFilled = await this.fillInput(page, '#ask-content', article.contentMarkdown)
          || await this.fillInput(page, 'textarea.ask-detail', article.contentMarkdown)
          || await this.fillInput(page, 'textarea[placeholder*="补充"]', article.contentMarkdown);
        // Detail is optional, don't fail if not filled
        if (!detailFilled) {
          console.warn('[BaiduZhidao] Could not fill question detail, continuing without it');
        }
      }

      // Step 4: Handle category selection if a category dialog appears
      await page.waitForTimeout(this.timeouts.MEDIUM);
      await this.selectCategory(page, article);

      // Step 5: Click submit button
      const submitClicked = await this.clickElement(page, 'button:has-text("提交")', this.timeouts.EXTENDED)
        || await this.clickElement(page, 'button:has-text("发布")', this.timeouts.DEFAULT)
        || await this.clickElement(page, '.ask-submit', this.timeouts.DEFAULT)
        || await this.clickElement(page, 'input[type="submit"]', this.timeouts.DEFAULT);

      if (!submitClicked) {
        await this.captureScreenshot(page, 'submit_failed');
        return { success: false, error: 'Failed to click submit button on Baidu Zhidao' };
      }

      // Step 6: Wait for navigation to the published question
      await page.waitForTimeout(this.timeouts.EXTRA_LONG);
      const publishedUrl = page.url();

      // Extract question ID from URL (format: https://zhidao.baidu.com/question/XXXXX.html)
      const postIdMatch = publishedUrl.match(/\/question\/([0-9a-f]+)\.html/);
      const postId = postIdMatch ? postIdMatch[1] : `zhidao_${Date.now()}`;

      return {
        success: true,
        postId,
        postUrl: publishedUrl,
      };
    } catch (err) {
      await this.captureScreenshot(page, 'error');
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown Baidu Zhidao RPA error',
      };
    }
  }

  /**
   * Answer an existing question on Baidu Zhidao.
   * Navigates to the question URL and posts the answer.
   */
  private async answerQuestion(page: Page, article: Article, questionUrl: string): Promise<PublishResult> {
    try {
      // Step 1: Navigate to the question page
      await page.goto(questionUrl, {
        waitUntil: 'domcontentloaded',
        timeout: this.timeouts.PAGE_NAVIGATION,
      });

      // Verify authentication
      const currentUrl = page.url();
      if (currentUrl.includes('login') || currentUrl.includes('passport')) {
        await this.captureScreenshot(page, 'auth_failed');
        return { success: false, error: 'Baidu Zhidao authentication failed - cookies may be expired' };
      }

      // Verify the question page loaded correctly
      if (currentUrl.includes('error') || currentUrl.includes('404')) {
        await this.captureScreenshot(page, 'question_not_found');
        return { success: false, error: 'Question page not found or deleted' };
      }

      // Step 2: Click "我来回答" button if present to reveal the answer editor
      const answerBtnClicked = await this.clickElement(page, 'a:has-text("我来回答")', this.timeouts.DEFAULT)
        || await this.clickElement(page, 'button:has-text("我来回答")', this.timeouts.DEFAULT)
        || await this.clickElement(page, '.answer-btn', this.timeouts.EXTRA_LONG);

      if (!answerBtnClicked) {
        console.debug('[BaiduZhidao] "我来回答" button not found, editor may already be visible');
      }

      // Even if the button isn't found, the editor might already be visible
      await page.waitForTimeout(this.timeouts.MEDIUM);

      // Step 3: Fill in the answer content
      const answerText = article.contentMarkdown || article.contentPlain || '';
      if (!answerText.trim()) {
        return { success: false, error: 'No answer content available in article' };
      }

      const contentFilled = await this.fillAnswerEditor(page, answerText);
      if (!contentFilled) {
        await this.captureScreenshot(page, 'answer_content_failed');
        return { success: false, error: 'Failed to fill answer content on Baidu Zhidao' };
      }

      // Step 4: Click submit answer button
      await page.waitForTimeout(this.timeouts.SHORT);
      const submitClicked = await this.clickElement(page, 'button:has-text("提交回答")', this.timeouts.EXTENDED)
        || await this.clickElement(page, 'button:has-text("提交")', this.timeouts.DEFAULT)
        || await this.clickElement(page, '.answer-submit', this.timeouts.DEFAULT)
        || await this.clickElement(page, 'input[type="submit"][value="提交回答"]', this.timeouts.DEFAULT);

      if (!submitClicked) {
        await this.captureScreenshot(page, 'submit_failed');
        return { success: false, error: 'Failed to click submit answer button on Baidu Zhidao' };
      }

      // Step 5: Wait for the answer to be posted
      await page.waitForTimeout(this.timeouts.EXTRA_LONG);

      // Try to extract answer ID from the page
      const answerUrl = page.url();
      const postIdMatch = answerUrl.match(/\/answer\/(\d+)/)
        || answerUrl.match(/#(\d+)/);
      const postId = postIdMatch ? postIdMatch[1] : `zhidao_answer_${Date.now()}`;

      return {
        success: true,
        postId,
        postUrl: questionUrl,
      };
    } catch (err) {
      await this.captureScreenshot(page, 'error');
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown Baidu Zhidao RPA error',
      };
    }
  }

  /**
   * Fill the answer editor on Baidu Zhidao.
   * Supports multiple editor types: rich text (ProseMirror/Quill), textarea, contenteditable.
   */
  private async fillAnswerEditor(page: Page, content: string): Promise<boolean> {
    // Try rich text editor (ProseMirror)
    try {
      const editor = page.locator('.ProseMirror, .ql-editor, .editor-content').first();
      if (await editor.isVisible({ timeout: this.timeouts.DEFAULT })) {
        await editor.click();
        await page.keyboard.type(content, { delay: 0 });
        return true;
      }
    } catch {
      // Continue to try other methods
    }

    // Try contenteditable div
    try {
      const editable = page.locator('[contenteditable="true"]').first();
      if (await editable.isVisible({ timeout: this.timeouts.DEFAULT })) {
        await editable.click();
        await page.keyboard.type(content, { delay: 0 });
        return true;
      }
    } catch {
      // Continue
    }

    // Try textarea fallback
    try {
      const textarea = page.locator('textarea#answer-editor, textarea.answer-input, textarea.editor').first();
      if (await textarea.isVisible({ timeout: this.timeouts.DEFAULT })) {
        await textarea.fill(content);
        return true;
      }
    } catch {
      // Try any textarea as last resort
    }

    try {
      const anyTextarea = page.locator('textarea').first();
      if (await anyTextarea.isVisible({ timeout: this.timeouts.EXTRA_LONG })) {
        await anyTextarea.fill(content);
        return true;
      }
    } catch {
      // All methods failed
    }

    return false;
  }

  /**
   * Select a category if the category selection dialog appears.
   * Uses article.metadata.category if available, otherwise skips.
   */
  private async selectCategory(page: Page, article: Article): Promise<void> {
    try {
      const category = article.metadata?.category as string | undefined;
      if (!category) return;

      // Check if category dialog exists
      const categoryDialog = page.locator('.category-dialog, .modal:has-text("分类")').first();
      if (await categoryDialog.isVisible({ timeout: this.timeouts.LONG })) {
        // Try to click the matching category
        const categoryLink = page.locator(`a:has-text("${category}"), li:has-text("${category}")`).first();
        if (await categoryLink.isVisible({ timeout: this.timeouts.LONG })) {
          await categoryLink.click();
          await page.waitForTimeout(this.timeouts.SHORT);
        }
      }
    } catch {
      // Category selection is optional, don't fail if it doesn't work
    }
  }
}
