import type { Page } from 'playwright';
import type { Article } from '@zemingengine/shared';
import { getPlatformEditorUrl } from '@zemingengine/shared';
import type { PublishResult } from '../../../types.js';
import { BaseCsdnStrategy } from './base.js';

/**
 * Strategy 1: New Markdown Editor (editor.csdn.net/md/)
 *
 * Navigate to the new Markdown editor, fill title / Markdown content / tags,
 * click "发布文章" button, handle publish dialog, and capture the saveArticle
 * API response to confirm publication.
 */
export class NewEditorStrategy extends BaseCsdnStrategy {
  readonly name = 'New Markdown Editor';

  async execute(page: Page, article: Article): Promise<PublishResult> {
    let capturedResponse: { status: number; body: string } | null = null;

    try {
      // Step 1: Navigate to the new Markdown editor
      console.log('[CSDN RPA-S1] Navigating to new Markdown editor...');
      await page.goto(getPlatformEditorUrl('csdn')!, {
        waitUntil: 'domcontentloaded',
        timeout: this.timeouts.PAGE_NAVIGATION,
      });
      await page.waitForTimeout(this.timeouts.DEFAULT);

      // Verify authentication
      const currentUrl = page.url();
      if (currentUrl.includes('login') || currentUrl.includes('passport')) {
        await this.captureScreenshot(page, 's1_auth_failed');
        return { success: false, error: 'CSDN authentication failed - cookies may be expired' };
      }
      console.log('[CSDN RPA-S1] Editor loaded at:', currentUrl);

      // Step 2: Set up response listener for saveArticle
      page.on('response', async (response) => {
        if (response.url().includes('saveArticle')) {
          try {
            const body = await response.text();
            capturedResponse = { status: response.status(), body };
            console.log('[CSDN RPA-S1] saveArticle response:', response.status(), body.substring(0, 300));
          } catch {
            // body already consumed
          }
        }
      });

      // Step 3: Fill title
      console.log('[CSDN RPA-S1] Filling title...');
      const titleFilled = await this.fillTitleNewEditor(page, article.title);
      if (!titleFilled) {
        await this.captureScreenshot(page, 's1_title_failed');
        return { success: false, error: 'Failed to fill title in new editor' };
      }

      // Step 4: Fill Markdown content
      console.log('[CSDN RPA-S1] Filling Markdown content...');
      const contentFilled = await this.fillContentNewEditor(page, article.contentMarkdown);
      if (!contentFilled) {
        await this.captureScreenshot(page, 's1_content_failed');
        return { success: false, error: 'Failed to fill content in new editor' };
      }

      // Step 5: Add tags
      if (article.tags.length > 0) {
        console.log('[CSDN RPA-S1] Adding tags...');
        await this.addTagsNewEditor(page, article.tags);
      }

      // Step 6: Click "发布文章" button
      console.log('[CSDN RPA-S1] Clicking "发布文章" button...');
      await page.waitForTimeout(this.timeouts.MEDIUM);
      const publishClicked = await this.clickPublishButton(page);
      if (!publishClicked) {
        await this.captureScreenshot(page, 's1_no_publish_btn');
        return { success: false, error: 'Could not find "发布文章" button in new editor' };
      }

      // Step 7: Handle publish dialog (column selection, confirmation)
      console.log('[CSDN RPA-S1] Handling publish dialog...');
      await this.handlePublishDialog(page);

      // Step 8: Wait for saveArticle response
      console.log('[CSDN RPA-S1] Waiting for saveArticle response...');
      let waitCount = 0;
      while (!capturedResponse && waitCount < 30) {
        await page.waitForTimeout(this.timeouts.SHORT);
        waitCount++;
        if (waitCount % 10 === 0) {
          console.log(`[CSDN RPA-S1] Still waiting... (${waitCount * 0.5}s)`);
        }
      }

      if (capturedResponse) {
        return this.parseSaveArticleResponse(capturedResponse, page.url());
      }

      // No API response captured — check if URL changed to article page
      const finalUrl = page.url();
      if (finalUrl.includes('blog.csdn.net') && finalUrl.includes('/article/details/')) {
        console.log('[CSDN RPA-S1] URL changed to article page:', finalUrl);
        return {
          success: true,
          postUrl: finalUrl,
          postId: this.extractArticleIdFromUrl(finalUrl),
          verificationStatus: 'verified',
          verificationMessage: 'Article published (URL navigation confirmed)',
        };
      }

      await this.captureScreenshot(page, 's1_no_response');
      return { success: false, error: 'No saveArticle response and URL did not change to article page' };
    } catch (err) {
      await this.captureScreenshot(page, 's1_error');
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error in new editor strategy',
      };
    }
  }

  // ===========================================================================
  // New-editor: Fill title
  // ===========================================================================

  private async fillTitleNewEditor(page: Page, title: string): Promise<boolean> {
    // Wait for editor to be ready (title input appears)
    try {
      await page.waitForSelector('.article-bar__input, #txtTitle, input[placeholder*="标题"]', {
        timeout: this.timeouts.EXTRA_LONG,
      });
    } catch {
      // Continue even if wait fails
    }

    const titleSelectors = [
      '.article-bar__input',
      '#txtTitle',
      'input[placeholder*="请输入标题"]',
      'input[placeholder*="输入文章标题"]',
      'textarea[placeholder*="请输入标题"]',
      'input[placeholder*="标题"]',
      'textarea[placeholder*="标题"]',
      'input.article-title',
      '.title-input input',
      '.title-container input',
      '[class*="title"] input',
      '[class*="title"] textarea',
    ];

    for (const sel of titleSelectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: this.timeouts.LONG })) {
          await el.click();
          await page.waitForTimeout(100);
          await el.fill(title);
          // Verify fill worked
          const value = await el.inputValue().catch(() => '');
          if (value && value.length > 0) {
            console.log(`[CSDN RPA-S1] Title filled via: ${sel} (verified: ${value.substring(0, 20)}...)`);
            return true;
          }
          // Fallback: try via evaluate
          const filled = await page.evaluate(({ selector, text }: { selector: string; text: string }) => {
            const el = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
            if (el) {
              const nativeSetter = Object.getOwnPropertyDescriptor(
                (el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement : window.HTMLInputElement).prototype,
                'value'
              )?.set;
              if (nativeSetter) nativeSetter.call(el, text);
              else el.value = text;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return true;
            }
            return false;
          }, { selector: sel, text: title });
          if (filled) {
            console.log(`[CSDN RPA-S1] Title filled via evaluate: ${sel}`);
            return true;
          }
        }
      } catch {
        // try next
      }
    }

    // Fallback: DOM search by content / placeholder / structure
    try {
      const filled = await page.evaluate((t: string) => {
        // 1. Search by placeholder containing title-related text
        const inputs = Array.from(document.querySelectorAll('input, textarea'));
        for (const input of inputs) {
          const placeholder = (input as HTMLInputElement).getAttribute('placeholder') || '';
          const id = (input as HTMLInputElement).id || '';
          const cls = (input as HTMLInputElement).className || '';
          if (
            placeholder.includes('标题') ||
            placeholder.includes('title') ||
            placeholder.includes('Title') ||
            id.includes('title') ||
            id.includes('Title') ||
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

        // 2. Search for contenteditable element with "无标题" / "Untitled" text
        const editables = Array.from(document.querySelectorAll('[contenteditable="true"]'));
        for (const ed of editables) {
          const text = (ed.textContent || '').trim();
          if (
            text.includes('无标题') ||
            text === 'Untitled' ||
            text === '' ||
            text.length < 10
          ) {
            // Check if this element looks like a title (short, top of page)
            const rect = ed.getBoundingClientRect();
            if (rect.top < window.innerHeight * 0.3 && rect.width > 200) {
              ed.textContent = t;
              ed.dispatchEvent(new Event('input', { bubbles: true }));
              return true;
            }
          }
        }

        return false;
      }, title);
      if (filled) {
        console.log('[CSDN RPA-S1] Title filled via DOM search fallback');
        return true;
      }
    } catch {
      // continue
    }

    return false;
  }

  // ===========================================================================
  // New-editor: Fill Markdown content (CodeMirror)
  // ===========================================================================

  private async fillContentNewEditor(page: Page, markdownContent: string): Promise<boolean> {
    // Approach 1: CodeMirror JavaScript API
    try {
      const filled = await page.evaluate((md: string) => {
        // Try various CodeMirror access patterns
        const cm = (window as any);
        if (cm.editor && cm.editor.setValue) {
          cm.editor.setValue(md);
          return true;
        }
        if (cm.cmEditor && cm.cmEditor.setValue) {
          cm.cmEditor.setValue(md);
          return true;
        }
        if (cm.codeEditor && cm.codeEditor.setValue) {
          cm.codeEditor.setValue(md);
          return true;
        }
        // Try DOM-based CodeMirror
        const cmEl = document.querySelector('.CodeMirror');
        if (cmEl && (cmEl as any).CodeMirror) {
          (cmEl as any).CodeMirror.setValue(md);
          return true;
        }
        // Try CodeMirror 6 (EditorView)
        const cm6El = document.querySelector('.cm-editor');
        if (cm6El && (cm6El as any).EditorView) {
          const view = (cm6El as any).EditorView;
          if (view && view.dispatch) {
            view.dispatch({
              changes: { from: 0, to: view.state.doc.length, insert: md },
            });
            return true;
          }
        }
        return false;
      }, markdownContent);
      if (filled) {
        console.log('[CSDN RPA-S1] Content filled via CodeMirror API');
        await page.waitForTimeout(this.timeouts.SHORT);
        return true;
      }
    } catch {
      // continue
    }

    // Approach 2: Textarea (if editor uses a textarea)
    const textareaSelectors = [
      'textarea[name="content"]',
      'textarea.editor-textarea',
      'textarea.markdown-editor',
      '.editor textarea',
      'textarea#content',
    ];
    for (const sel of textareaSelectors) {
      try {
        const textarea = page.locator(sel).first();
        if (await textarea.isVisible({ timeout: this.timeouts.LONG })) {
          await textarea.fill(markdownContent);
          console.log(`[CSDN RPA-S1] Content filled via textarea: ${sel}`);
          return true;
        }
      } catch {
        // try next
      }
    }

    // Approach 3: Contenteditable div
    try {
      const filled = await page.evaluate((md: string) => {
        const editable = document.querySelector('[contenteditable="true"]');
        if (editable) {
          editable.textContent = md;
          editable.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        }
        return false;
      }, markdownContent);
      if (filled) {
        console.log('[CSDN RPA-S1] Content filled via contenteditable');
        return true;
      }
    } catch {
      // continue
    }

    // Approach 4: Click editor area and type
    try {
      const editorArea = page.locator('.CodeMirror, .cm-editor, .editor-area, .markdown-editor').first();
      if (await editorArea.isVisible({ timeout: this.timeouts.LONG })) {
        await editorArea.click();
        await page.waitForTimeout(300);
        // Select all and replace
        await page.keyboard.press('Control+a');
        await page.waitForTimeout(200);
        await page.keyboard.type(markdownContent.substring(0, 5000), { delay: 0 });
        console.log('[CSDN RPA-S1] Content filled via keyboard typing (truncated to 5000 chars)');
        return true;
      }
    } catch {
      // continue
    }

    return false;
  }

  // ===========================================================================
  // New-editor: Add tags
  // ===========================================================================

  private async addTagsNewEditor(page: Page, tags: string[]): Promise<void> {
    await (this.handler as unknown as {
      addTags(page: Page, tags: string[], extraSelectors?: string[], maxTags?: number): Promise<void>;
    }).addTags(page, tags, ['.tags input'], 5);
  }
}
