import { type Article, type PlatformCredentials, type PlatformId, getPlatformEditorUrl } from '@zemingengine/shared';
import type { Page } from 'playwright';
import type { PublishResult } from '../types.js';

/**
 * Parse cookie string from credentials into Playwright cookie format.
 * Expects credentials.data.cookie or credentials.data.cookies to contain
 * a cookie string in "name=value; name2=value2" format.
 */
export function parseCookies(credentials: PlatformCredentials, domain: string): Array<{
  name: string;
  value: string;
  domain: string;
  path: string;
}> {
  const cookieStr = credentials.data.cookie || credentials.data.cookies || '';
  if (!cookieStr) return [];

  return cookieStr
    .split(';')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const idx = pair.indexOf('=');
      const name = idx > 0 ? pair.slice(0, idx) : pair;
      const value = idx > 0 ? pair.slice(idx + 1) : '';
      return { name, value, domain, path: '/' };
    });
}

/**
 * Standard timeout constants used across RPA handlers.
 */
export const RpaTimeout = {
  SHORT: 500,
  MEDIUM: 1000,
  LONG: 2000,
  EXTRA_LONG: 3000,
  DEFAULT: 5000,
  EXTENDED: 10000,
  PAGE_NAVIGATION: 30000,
} as const;

/**
 * Abstract RPA handler for platform-specific publishing via browser automation.
 * Each platform implements its own navigation, content filling, and submission logic.
 */
export abstract class RpaHandler {
  readonly platform: PlatformId;

  /** Standard timeout values — subclasses may override for platform-specific tuning. */
  protected readonly timeouts = RpaTimeout;

  constructor(platform: PlatformId) {
    this.platform = platform;
  }

  /**
   * Execute the publishing flow for this platform.
   * @param page - Playwright Page with cookies already injected
   * @param article - Article to publish
   * @param credentials - Platform credentials (cookies, tokens, etc.)
   */
  abstract publish(page: Page, article: Article, credentials: PlatformCredentials): Promise<PublishResult>;

  /**
   * Parse cookie string from credentials into Playwright cookie format.
   * @deprecated Use the standalone `parseCookies` function instead.
   */
  protected parseCookies(credentials: PlatformCredentials, domain: string): Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
  }> {
    return parseCookies(credentials, domain);
  }

  /**
   * Take a screenshot for debugging purposes.
   */
  protected async captureScreenshot(page: Page, label: string): Promise<string> {
    const timestamp = Date.now();
    const filename = `rpa_${this.platform}_${label}_${timestamp}.png`;
    try {
      await page.screenshot({ path: filename, fullPage: false });
      return filename;
    } catch {
      return '';
    }
  }

  /**
   * Wait for a selector and click it, with error handling.
   */
  protected async clickElement(page: Page, selector: string, timeout: number = RpaTimeout.EXTENDED): Promise<boolean> {
    try {
      await page.waitForSelector(selector, { state: 'visible', timeout });
      await page.click(selector);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Fill an input field with text.
   */
  protected async fillInput(page: Page, selector: string, text: string, timeout: number = RpaTimeout.EXTENDED): Promise<boolean> {
    try {
      await page.waitForSelector(selector, { state: 'visible', timeout });
      await page.fill(selector, text);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Fill a rich text editor with content.
   *
   * Tries common editor types in order:
   * 1. Platform-specific primary selectors (via extraSelectors param)
   * 2. ProseMirror
   * 3. Quill (.ql-editor)
   * 4. Contenteditable div
   * 5. Textarea fallback
   *
   * Subclasses may override this method for platform-specific behavior,
   * or call `super.fillRichTextEditor(page, content, extraSelectors)`
   * to add platform-specific primary selectors before the generic chain.
   *
   * @param page - Playwright Page
   * @param content - Text content to fill
   * @param extraSelectors - Optional additional selectors to try first (platform-specific primary editor)
   * @returns true if content was filled successfully
   */
  protected async fillRichTextEditor(
    page: Page,
    content: string,
    extraSelectors: string[] = [],
  ): Promise<boolean> {
    // Build the full selector list: platform-specific first, then generic fallbacks
    const editorSelectors = [
      ...extraSelectors,
      '.ProseMirror',
      '.ql-editor',
      '[contenteditable="true"]',
    ];

    // Try click-and-type on each editor selector
    for (const sel of editorSelectors) {
      try {
        const editor = page.locator(sel).first();
        if (await editor.isVisible({ timeout: this.timeouts.DEFAULT })) {
          await editor.click();
          await page.keyboard.type(content, { delay: 0 });
          return true;
        }
      } catch {
        // continue to next selector
      }
    }

    // Try textarea fallback
    const textareaSelectors = [
      'textarea.editor-content',
      'textarea.editor',
      'textarea#content',
    ];
    for (const sel of textareaSelectors) {
      try {
        const textarea = page.locator(sel).first();
        if (await textarea.isVisible({ timeout: this.timeouts.DEFAULT })) {
          await textarea.fill(content);
          return true;
        }
      } catch {
        // continue
      }
    }

    return false;
  }

  /**
   * Add tags to a platform's tag input field.
   *
   * Iterates through tags and fills them one by one via the tag input,
   * pressing Enter after each tag. Tags are optional — failures are silent.
   *
   * Subclasses may override this method for platform-specific behavior,
   * or call `super.addTags(page, tags, extraInputSelectors, maxTags)`
   * to add platform-specific input selectors.
   *
   * @param page - Playwright Page
   * @param tags - Array of tag strings
   * @param extraInputSelectors - Optional additional tag input selectors to try first
   * @param maxTags - Maximum number of tags to add (default: 5)
   */
  protected async addTags(
    page: Page,
    tags: string[],
    extraInputSelectors: string[] = [],
    maxTags = 5,
  ): Promise<void> {
    const tagInputSelectors = [
      ...extraInputSelectors,
      'input[placeholder*="标签"]',
      'input.tag-input',
      '.tag-input input',
      'input[placeholder*="tag"]',
    ];

    for (const tag of tags.slice(0, maxTags)) {
      let added = false;
      for (const sel of tagInputSelectors) {
        try {
          const tagInput = page.locator(sel).first();
          if (await tagInput.isVisible({ timeout: this.timeouts.DEFAULT })) {
            await tagInput.fill(tag);
            await page.keyboard.press('Enter');
            await page.waitForTimeout(this.timeouts.SHORT);
            added = true;
            break;
          }
        } catch {
          // try next selector
        }
      }
      if (!added) {
        console.log(`[${this.platform} RPA] Could not add tag: ${tag}`);
      }
    }
  }
}

/**
 * A simplified RPA handler base class using the Template Method pattern.
 *
 * Platforms with a straightforward "navigate → fill title → fill content →
 * add tags → select category → publish" flow can extend this class and
 * customize behavior via protected properties and optional hook overrides,
 * instead of rewriting the entire publish() method.
 *
 * Complex platforms (CSDN, Zhihu, Juejin, etc.) should continue extending
 * the base `RpaHandler` class directly.
 *
 * The publish() method defines the fixed skeleton of the publishing flow;
 * subclasses customize individual steps by overriding protected properties
 * and hook methods.
 */
export abstract class SimpleRpaHandler extends RpaHandler {
  // ─── Configuration properties (override in subclass) ──────────────────────

  /** Cookie domain for this platform (e.g. ".example.com"). */
  protected abstract readonly cookieDomain: string;

  /** URL path segments that indicate a login redirect (auth failure). */
  protected readonly loginUrlKeywords: string[] = ['login', 'passport'];

  /** Title input selectors, tried in order until one succeeds. */
  protected abstract readonly titleSelectors: string[];

  /**
   * Primary rich-text editor selectors, tried before generic fallbacks.
   * Passed as `extraSelectors` to `fillRichTextEditor`.
   */
  protected readonly contentEditorSelectors: string[] = [];

  /** Whether the platform supports adding tags. */
  protected readonly enableTags: boolean = true;

  /** Maximum number of tags (only relevant when enableTags is true). */
  protected readonly maxTags: number = 5;

  /** Publish button selectors, tried in order. */
  protected readonly publishButtonSelectors: string[] = [
    'button:has-text("发布")',
    '.publish-btn',
  ];

  /** Whether a confirmation dialog appears after clicking publish. */
  protected readonly hasConfirmDialog: boolean = true;

  /** Confirm button selectors in the confirmation dialog, tried in order. */
  protected readonly confirmButtonSelectors: string[] = [
    'button:has-text("确认发布")',
    '.btn-confirm',
  ];

  /** Regex patterns to extract a post ID from the published URL, tried in order. */
  protected readonly postIdPatterns: RegExp[] = [
    /\/(\d{10,})/,
    /id=([0-9a-f]+)/,
  ];

  /** Human-readable platform name used in error messages. */
  protected abstract readonly platformDisplayName: string;

  constructor(platform: PlatformId) {
    super(platform);
  }

  // ─── Template method ──────────────────────────────────────────────────────

  /**
   * Template method — defines the skeleton of the publishing flow.
   * Subclasses customize individual steps via properties and hook methods.
   */
  async publish(page: Page, article: Article, credentials: PlatformCredentials): Promise<PublishResult> {
    const cookies = this.parseCookies(credentials, this.cookieDomain);

    if (cookies.length === 0) {
      return { success: false, error: `No cookies found in credentials for ${this.platformDisplayName}` };
    }

    try {
      // Step 1: Navigate to the editor page
      await page.goto(getPlatformEditorUrl(this.platform)!, {
        waitUntil: 'domcontentloaded',
        timeout: this.timeouts.PAGE_NAVIGATION,
      });

      // Verify authentication by checking for login redirect
      const currentUrl = page.url();
      if (this.loginUrlKeywords.some((kw) => currentUrl.includes(kw))) {
        await this.captureScreenshot(page, 'auth_failed');
        return {
          success: false,
          error: `${this.platformDisplayName} authentication failed - cookies may be expired`,
        };
      }

      // Step 2 (hook): Enter the editor (no-op by default)
      const editorReady = await this.enterEditor(page);
      if (!editorReady) {
        await this.captureScreenshot(page, 'editor_failed');
        return { success: false, error: `Failed to enter editor on ${this.platformDisplayName}` };
      }

      // Step 3: Fill in the title
      let titleFilled = false;
      for (const sel of this.titleSelectors) {
        if (await this.fillInput(page, sel, article.title)) {
          titleFilled = true;
          break;
        }
      }

      if (!titleFilled) {
        await this.captureScreenshot(page, 'title_failed');
        return { success: false, error: `Failed to fill article title on ${this.platformDisplayName}` };
      }

      // Step 4: Fill in the content using the rich text editor
      const contentFilled = await this.fillRichTextEditor(
        page,
        article.contentMarkdown,
        this.contentEditorSelectors,
      );
      if (!contentFilled) {
        await this.captureScreenshot(page, 'content_failed');
        return { success: false, error: `Failed to fill article content on ${this.platformDisplayName}` };
      }

      // Step 5: Add tags if enabled and available
      if (this.enableTags && article.tags.length > 0) {
        await this.addTags(page, article.tags, [], this.maxTags);
      }

      // Step 6 (hook): Select category/channel (no-op by default)
      await this.selectCategory(page);

      // Step 7: Click publish button
      await page.waitForTimeout(1500); // Wait for content to settle

      let publishClicked = false;
      for (const sel of this.publishButtonSelectors) {
        if (await this.clickElement(page, sel, this.timeouts.EXTENDED)) {
          publishClicked = true;
          break;
        }
      }

      if (!publishClicked) {
        await this.captureScreenshot(page, 'publish_failed');
        return { success: false, error: `Failed to click publish button on ${this.platformDisplayName}` };
      }

      // Step 8: Handle confirmation dialog if it appears
      if (this.hasConfirmDialog) {
        await page.waitForTimeout(this.timeouts.LONG);
        for (const sel of this.confirmButtonSelectors) {
          if (await this.clickElement(page, sel, this.timeouts.DEFAULT)) {
            break;
          }
        }
      }

      // Step 9: Wait for navigation and extract published URL
      await page.waitForTimeout(this.timeouts.EXTRA_LONG);
      const publishedUrl = page.url();

      // Try to extract post ID from the URL
      let postId: string | undefined;
      for (const pattern of this.postIdPatterns) {
        const match = publishedUrl.match(pattern);
        if (match) {
          postId = match[1];
          break;
        }
      }
      if (!postId) {
        postId = `${this.platform}_${Date.now()}`;
      }

      return {
        success: true,
        postId,
        postUrl: publishedUrl,
      };
    } catch (err) {
      await this.captureScreenshot(page, 'error');
      return {
        success: false,
        error: err instanceof Error ? err.message : `Unknown ${this.platformDisplayName} RPA error`,
      };
    }
  }

  // ─── Hook methods (override in subclass when needed) ──────────────────────

  /**
   * Hook: navigate into the editor after landing on the platform page.
   * Returns true if the editor is ready, false to abort the publish flow.
   * Default: no-op, returns true immediately.
   *
   * Override this for platforms where you first land on a dashboard and
   * need to click through to reach the editor.
   */
  protected async enterEditor(page: Page): Promise<boolean> {
    return true;
  }

  /**
   * Hook: select a category/channel for the article.
   * Default: no-op. Override for platforms that require category selection.
   */
  protected async selectCategory(page: Page): Promise<void> {
    // no-op by default
  }
}
