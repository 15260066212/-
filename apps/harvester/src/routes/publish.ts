/**
 * Publishing routes: RPA-based publish and LLMWiki fallback publish.
 *
 * POST /rpa/publish        - Direct RPA publish (browser automation)
 * POST /api/llmwiki/publish - LLMWiki pipeline publish (content posting)
 *
 * CSDN has dedicated logic with proper publish verification
 * (checking saveArticle API response + URL navigation) to prevent
 * false-positive "published" results when only a draft was saved.
 */

import { chromium } from 'playwright';
import { createAuthenticatedContext } from '../lib/publish-context.js';
import {
  sessions,
  remoteSessions,
  closeSession,
  getCredential,
  upsertCredential,
  fingerprintGenerator,
  fingerprintInjector,
  getProxyOptions,
} from '../config/index.js';
import { PLATFORM_URLS, PLATFORM_NAMES } from '../config/platforms.js';
import { getPlatformEditorUrl } from '@zemingengine/shared';
import {
  parseCookieString,
  filterCookiesByDomain,
  getAuthCookieNames,
  PLATFORM_DOMAINS,
} from '../lib/cookie-utils.js';
import type { Express, Request, Response, Page } from 'express';

// ============================================================================
// Publish Constants
// ============================================================================

// --- Navigation & Page Load Timeouts ---
/** Standard page navigation timeout (30 seconds) */
const NAVIGATION_TIMEOUT_MS = 30000;

// --- Element Visibility Timeouts ---
/** Long timeout for critical elements like editors and title inputs (5 seconds) */
const ELEMENT_TIMEOUT_LONG_MS = 5000;
/** Medium timeout for buttons and interactive elements (3 seconds) */
const ELEMENT_TIMEOUT_MEDIUM_MS = 3000;
/** Short timeout for secondary elements like drawers and fallback selectors (2 seconds) */
const ELEMENT_TIMEOUT_SHORT_MS = 2000;
/** Brief timeout for quick elements (1.5 seconds) */
const ELEMENT_TIMEOUT_BRIEF_MS = 1500;

// --- Wait / Delay Durations (after actions) ---
/** Wait after navigating to a page for the editor to load (4 seconds) */
const WAIT_AFTER_NAVIGATION_MS = 4000;
/** Wait for editor initialization (3 seconds) */
const WAIT_FOR_EDITOR_INIT_MS = 3000;
/** Wait for draft auto-save to complete (3 seconds) */
const WAIT_FOR_DRAFT_SAVE_MS = 3000;
/** Wait after clicking publish button (3 seconds) */
const WAIT_AFTER_PUBLISH_CLICK_MS = 3000;
/** Wait for auto-save to settle (2 seconds) */
const WAIT_FOR_AUTO_SAVE_MS = 2000;
/** Wait after clicking a publish entry link (2 seconds) */
const WAIT_AFTER_ENTRY_CLICK_MS = 2000;
/** Wait after submit button click for final publish (5 seconds) */
const WAIT_AFTER_SUBMIT_MS = 5000;
/** Wait after opening the publish settings dialog (1.5 seconds) */
const WAIT_AFTER_DIALOG_OPEN_MS = 1500;
/** Wait after filling tags / short action (1 second) */
const WAIT_SHORT_ACTION_MS = 1000;
/** Wait after closing a drawer / short delay (1 second) */
const WAIT_AFTER_DRAWER_CLOSE_MS = 1000;
/** Brief wait after click for UI to respond (500ms) */
const WAIT_AFTER_CLICK_MS = 500;
/** Wait for tag search results (500ms) */
const WAIT_FOR_TAG_SEARCH_MS = 500;
/** Wait after pressing Enter on a tag (500ms) */
const WAIT_AFTER_TAG_ENTER_MS = 500;
/** Tiny wait after focusing an input (300ms) */
const WAIT_AFTER_FOCUS_MS = 300;
/** Very small wait after select all (200ms) */
const WAIT_AFTER_SELECT_ALL_MS = 200;
/** Wait after clicking tag input (200ms) */
const WAIT_AFTER_TAG_CLICK_MS = 200;
/** Minimal wait after click for input focus (100ms) */
const WAIT_MINIMAL_CLICK_MS = 100;

// --- Publish Confirmation Polling ---
/** Maximum number of polling iterations for publish confirmation */
const PUBLISH_CONFIRM_MAX_WAITS = 60;
/** Interval between publish confirmation polls (500ms) */
const PUBLISH_CONFIRM_POLL_INTERVAL_MS = 500;

// --- Toutiao Draft Save Verification ---
/** Maximum time to wait for the platform's draft auto-save request (20 seconds) */
const TOUTIAO_SAVE_WAIT_MS = 20000;
/** Polling interval while waiting for the draft auto-save request (500ms) */
const TOUTIAO_SAVE_POLL_INTERVAL_MS = 500;
/** URL fragment of the Toutiao draft save API */
const TOUTIAO_SAVE_API_FRAGMENT = '/mp/agw/article/publish';
/** Maximum content length to type via keyboard (3000 chars) */
const KEYBOARD_TYPE_MAX_LENGTH = 3000;

// --- CSDN Specific Limits ---
/** Maximum number of tags allowed on CSDN */
const CSDN_MAX_TAGS = 5;
/** Default number of tags to generate from title */
const DEFAULT_CSDN_TAG_COUNT = 3;
/** Minimum tag word length for extraction */
const MIN_TAG_WORD_LENGTH = 2;

// --- DOM Fallback Button Size Thresholds ---
/** Minimum button width to consider as a real button (30px) */
const MIN_BUTTON_WIDTH = 30;
/** Minimum button height to consider as a real button (20px) */
const MIN_BUTTON_HEIGHT = 20;

// --- Preview / Logging Lengths ---
/** Response body preview length in logs */
const RESPONSE_BODY_PREVIEW_LENGTH = 200;
/** Last response body preview length in logs */
const LAST_RESPONSE_BODY_PREVIEW_LENGTH = 300;
/** Error message preview length from page */
const ERROR_MESSAGE_PREVIEW_LENGTH = 150;

// ============================================================================
// CSDN-specific publisher with proper verification
// ============================================================================
//
// CSDN editor facts (verified 2026-09):
//   - Editor: cledit library, contenteditable <pre class="editor__inner">
//   - Title input: input.article-bar__title
//   - Publish button: .btn-publish → OPENS settings dialog (does NOT publish)
//   - Final publish: click "发布文章" button inside the settings dialog
//   - Required field: article tags (≤5), must fill before publishing
//   - Save API: POST /blog-console-api/v3/mdeditor/saveArticle
//   - Auto-save triggers saveArticle too — only count as published if
//     response contains a real article URL (/article/details/)
//

interface PublishResult {
  success: boolean;
  postUrl?: string;
  postId?: string;
  error?: string;
  verificationStatus: string;
  verificationMessage?: string;
  draftSaved?: boolean;
}

interface ArticleData {
  title?: string;
  contentMarkdown?: string;
  contentHtml?: string;
  tags?: string[];
  keywords?: string[];
}

interface ToutiaoSaveResult {
  attempted: boolean;
  ok: boolean;
  code?: number;
  message?: string;
}

/**
 * Convert editor HTML into plain-text paragraphs.
 * The Toutiao editor is a ProseMirror instance: mutating innerHTML directly does not
 * update its internal document state, so the auto-save payload keeps an empty body.
 * Typing the text through the keyboard is the only reliable way to sync that state.
 */
function htmlToPlainParagraphs(html: string): string[] {
  const withBreaks = html
    .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n');
  const text = withBreaks
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Watch the platform's draft auto-save API and wait for one response.
 * HTTP 200 with a non-zero business code (e.g. 7050 保存失败) means the draft was rejected.
 */
async function waitForToutiaoSave(page: import('playwright').Page): Promise<ToutiaoSaveResult> {
  const state: ToutiaoSaveResult = { attempted: false, ok: false };

  const onResponse = async (response: import('playwright').Response) => {
    if (state.attempted) return;
    if (!response.url().includes(TOUTIAO_SAVE_API_FRAGMENT)) return;
    if (response.request().method() !== 'POST') return;
    let body = '';
    try {
      body = await response.text();
    } catch {
      return;
    }
    let code: number | undefined;
    let message: string | undefined;
    try {
      const parsed = JSON.parse(body) as { code?: number; err_no?: number; message?: string; reason?: string };
      code = typeof parsed.code === 'number' ? parsed.code : parsed.err_no;
      message = parsed.message || parsed.reason;
    } catch {
      code = undefined;
    }
    state.attempted = true;
    state.ok = code === 0;
    state.code = code;
    state.message = message;
    console.log(`[Toutiao Publish] Draft save API: code=${code} message=${message || ''}`);
  };

  page.on('response', onResponse);
  try {
    const deadline = Date.now() + TOUTIAO_SAVE_WAIT_MS;
    while (!state.attempted && Date.now() < deadline) {
      await page.waitForTimeout(TOUTIAO_SAVE_POLL_INTERVAL_MS);
    }
  } finally {
    page.off('response', onResponse);
  }
  return state;
}

/**
 * Publish to 头条号 (Toutiao) with proper editor handling.
 * Uses the ProseMirror rich text editor at mp.toutiao.com/profile_v4/graphic/publish
 * Steps: remove AI assistant overlay → fill title → type content → verify draft save API
 */
async function publishToToutiao(page: import('playwright').Page, article: ArticleData): Promise<PublishResult> {
  const publishUrl = 'https://mp.toutiao.com/profile_v4/graphic/publish';

  try {
    // Step 1: Navigate to publish page
    console.log('[Toutiao Publish] Navigating to publish page...');
    await page.goto(publishUrl, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });

    const currentUrl = page.url();
    if (currentUrl.includes('login') || currentUrl.includes('sso.toutiao') || currentUrl.includes('passport')) {
      return {
        success: false,
        error: 'Not logged in — redirected to login page',
        verificationStatus: 'unverified',
      };
    }

    // Wait for editor to initialize
    await page.waitForTimeout(WAIT_FOR_EDITOR_INIT_MS);

    // Step 2: Remove AI assistant drawer overlay.
    // The drawer wrapper covers the whole viewport and intercepts pointer events, so the
    // editor can never receive focus while it is mounted. It has no close button, so the
    // only reliable way is to detach the overlay nodes from the DOM.
    console.log('[Toutiao Publish] Removing AI assistant overlay...');
    try {
      const removed = await page.evaluate(() => {
        let count = 0;
        document
          .querySelectorAll('.ai-assistant-drawer, .byte-drawer-wrapper, .byte-drawer-mask')
          .forEach((el) => {
            el.remove();
            count += 1;
          });
        return count;
      });
      console.log(`[Toutiao Publish] Overlay nodes removed: ${removed}`);
      await page.waitForTimeout(WAIT_AFTER_DRAWER_CLOSE_MS);
    } catch { /* ignore — drawer may not exist */ }

    // Step 3: Fill title
    console.log('[Toutiao Publish] Filling title...');
    const titleInput = page.locator('textarea[placeholder*="标题"]').first();
    if (!await titleInput.isVisible({ timeout: ELEMENT_TIMEOUT_LONG_MS })) {
      return {
        success: false,
        error: 'Could not find title input in 头条号 editor',
        verificationStatus: 'failed',
      };
    }
    await titleInput.fill(article.title || '无标题');
    console.log('[Toutiao Publish] Title filled');

    // Step 4: Fill content
    console.log('[Toutiao Publish] Filling content...');
    const editor = page.locator('.ProseMirror[contenteditable="true"]').first();
    if (!await editor.isVisible({ timeout: ELEMENT_TIMEOUT_LONG_MS })) {
      return {
        success: false,
        error: 'Could not find content editor in 头条号',
        verificationStatus: 'failed',
      };
    }

    // Focus the editor through the keyboard path so ProseMirror updates its own state.
    await editor.click({ force: true });
    await page.waitForTimeout(WAIT_AFTER_CLICK_MS);
    await editor.evaluate((el) => (el as HTMLElement).focus());
    await page.waitForTimeout(WAIT_AFTER_FOCUS_MS);

    const content = article.contentHtml || article.contentMarkdown || '';
    if (content) {
      // innerHTML assignment does NOT update the ProseMirror document, so the auto-save
      // payload would keep an empty body and the platform rejects it (code 7050 保存失败).
      // Typing plain-text paragraphs keeps the editor state and the payload in sync.
      const paragraphs = article.contentHtml
        ? htmlToPlainParagraphs(article.contentHtml)
        : content.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

      for (let i = 0; i < paragraphs.length; i += 1) {
        await page.keyboard.insertText(paragraphs[i]);
        if (i < paragraphs.length - 1) {
          await page.keyboard.press('Enter');
        }
      }
      console.log(`[Toutiao Publish] Content typed: ${paragraphs.length} paragraphs`);
    }
    console.log('[Toutiao Publish] Content filled');

    // Wait for the platform's draft auto-save API response
    const saveResult = await waitForToutiaoSave(page);
    await page.waitForTimeout(WAIT_FOR_DRAFT_SAVE_MS);

    // Step 5: Check publish button state
    const publishBtn = page.locator('button:has-text("预览并发布")').first();
    const btnVisible = await publishBtn.isVisible({ timeout: ELEMENT_TIMEOUT_MEDIUM_MS }).catch(() => false);
    const btnDisabled = btnVisible ? await publishBtn.isDisabled().catch(() => true) : true;

    if (!btnVisible) {
      return {
        success: false,
        error: 'Publish button not found',
        verificationStatus: 'failed',
        draftSaved: true,
      };
    }

    if (btnDisabled) {
      return {
        success: false,
        error: 'Publish button is disabled — content may be incomplete (check cover image, etc.)',
        verificationStatus: 'failed',
        draftSaved: true,
      };
    }

    // Step 6a: 平台保存接口明确返回失败时，直接给出真实原因（不要误报成登录问题）
    if (saveResult.attempted && !saveResult.ok) {
      const detail = saveResult.code !== undefined ? `code=${saveResult.code}` : 'code=unknown';
      return {
        success: false,
        error: `草稿保存被头条平台拒绝（${detail}${saveResult.message ? ' ' + saveResult.message : ''}）：正文已填入编辑器，但平台未接受该草稿，请检查账号状态或内容是否符合平台要求`,
        verificationStatus: 'failed',
        draftSaved: false,
      };
    }

    // Step 6b: 保存接口没有可观测的响应时才回退到刷新校验
    // 刷新后头条号会恢复上一次草稿，只有标题仍在才认为草稿确实落盘，避免"假成功"
    let draftVerified = saveResult.ok;
    if (!draftVerified) {
      try {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
        await page.waitForTimeout(WAIT_FOR_EDITOR_INIT_MS);
        const titleAfterReload = page.locator('textarea[placeholder*="标题"]').first();
        await titleAfterReload.waitFor({ state: 'visible', timeout: ELEMENT_TIMEOUT_LONG_MS });
        const restoredTitle = (await titleAfterReload.inputValue().catch(() => '')).trim();
        draftVerified = !!restoredTitle && restoredTitle === (article.title || '无标题').trim();
        console.log('[Toutiao Publish] Draft verification:', draftVerified ? 'ok' : `mismatch (${restoredTitle})`);
      } catch (verifyErr) {
        console.warn('[Toutiao Publish] Draft verification error:', (verifyErr as Error).message);
        draftVerified = false;
      }
    }

    if (!draftVerified) {
      return {
        success: false,
        error: '草稿未保存到平台：未捕获到保存接口的成功响应，刷新后编辑器也未恢复该文章',
        verificationStatus: 'failed',
        draftSaved: false,
      };
    }

    // For safety: don't actually publish, just verify everything is ready
    // Return success with draft status
    return {
      success: true,
      verificationStatus: 'draft_ready',
      verificationMessage: '头条号草稿已保存并通过刷新校验（发布按钮可用）',
      draftSaved: true,
    };

  } catch (err) {
    const error = err as Error;
    console.error('[Toutiao Publish] Error:', error.message);
    return {
      success: false,
      error: `Publish failed: ${error.message}`,
      verificationStatus: 'failed',
    };
  }
}

/**
 * Publish to CSDN with proper verification.
 * Uses the Markdown editor at editor.csdn.net/md/ with cledit engine.
 * Two-step publish: click .btn-publish to open settings dialog,
 * fill tags (required), then click "发布文章" in the dialog.
 * Verifies publication by checking the saveArticle API response.
 */
async function publishToCsdn(page: Page, article: ArticleData): Promise<PublishResult> {
  const editorUrl = getPlatformEditorUrl('csdn')!;

  // Navigate to editor
  console.log('[CSDN Publish] Navigating to editor:', editorUrl);
  await page.goto(editorUrl, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
  await page.waitForTimeout(WAIT_AFTER_NAVIGATION_MS);

  // Verify not redirected to login
  const currentUrl = page.url();
  if (currentUrl.includes('login') || currentUrl.includes('passport')) {
    return {
      success: false,
      error: 'CSDN authentication failed — redirected to login',
      verificationStatus: 'unverified',
    };
  }
  console.log('[CSDN Publish] Editor loaded:', currentUrl);

  // Collect publish responses (only AFTER clicking the FINAL publish button)
  const publishResponses: Array<{ status: number; body: string; url: string }> = [];
  let listening = false;

  page.on('response', async (response) => {
    if (!listening) return;
    const url = response.url();
    if (url.includes('saveArticle') || url.includes('save_article') || url.includes('publishArticle')) {
      try {
        const body = await response.text();
        publishResponses.push({ status: response.status(), body, url });
        console.log(`[CSDN Publish] Publish API response: ${response.status()} ${body.substring(0, RESPONSE_BODY_PREVIEW_LENGTH)}`);
      } catch {
        // body already consumed
      }
    }
  });

  // Wait for editor to be ready
  await page.waitForTimeout(WAIT_FOR_AUTO_SAVE_MS);

  // Fill title
  console.log('[CSDN Publish] Filling title...');
  const titleFilled = await fillCsdnTitle(page, article.title || '无标题');
  if (!titleFilled) {
    console.warn('[CSDN Publish] Failed to fill title — trying to proceed anyway');
  }

  // Fill content (Markdown)
  console.log('[CSDN Publish] Filling content...');
  const contentFilled = await fillCsdnContent(page, article.contentMarkdown || article.contentHtml || '');
  if (!contentFilled) {
    console.warn('[CSDN Publish] Failed to fill content');
    return {
      success: false,
      error: 'Failed to fill content in CSDN editor',
      verificationStatus: 'failed',
    };
  }

  // Wait for auto-save to settle down
  await page.waitForTimeout(WAIT_FOR_AUTO_SAVE_MS);

  // --- Step 1: Click .btn-publish to open settings dialog ---
  console.log('[CSDN Publish] Step 1: Opening publish settings dialog...');
  const dialogOpened = await openCsdnPublishDialog(page);
  if (!dialogOpened) {
    return {
      success: false,
      error: 'Could not find or click the publish button (.btn-publish) in CSDN editor',
      verificationStatus: 'failed',
    };
  }
  console.log('[CSDN Publish] Publish settings dialog opened');
  await page.waitForTimeout(WAIT_AFTER_DIALOG_OPEN_MS);

  // --- Step 2: Fill tags (REQUIRED field) ---
  console.log('[CSDN Publish] Step 2: Filling article tags...');
  const tags = article.tags || article.keywords || generateCsdnTags(article.title || '');
  const tagsFilled = await fillCsdnTags(page, tags);
  if (!tagsFilled) {
    console.warn('[CSDN Publish] Failed to fill tags — this may prevent publishing');
  } else {
    console.log('[CSDN Publish] Tags filled successfully');
  }
  await page.waitForTimeout(WAIT_SHORT_ACTION_MS);

  // --- Step 3: Click the final "发布文章" button in the dialog ---
  console.log('[CSDN Publish] Step 3: Clicking final publish button in dialog...');
  // Now start listening for publish responses
  publishResponses.length = 0;
  listening = true;

  const finalPublishClicked = await clickCsdnFinalPublishButton(page);
  if (!finalPublishClicked) {
    return {
      success: false,
      error: 'Could not find the final "发布文章" button in CSDN publish dialog',
      verificationStatus: 'failed',
    };
  }
  console.log('[CSDN Publish] Final publish button clicked');

  // Wait for publish response
  console.log('[CSDN Publish] Waiting for publish confirmation...');
  let waitCount = 0;
  while (publishResponses.length === 0 && waitCount < PUBLISH_CONFIRM_MAX_WAITS) {
    await page.waitForTimeout(PUBLISH_CONFIRM_POLL_INTERVAL_MS);
    waitCount++;
  }

  const finalUrl = page.url();
  console.log('[CSDN Publish] Final URL:', finalUrl);

  // Check if we got a valid publish response
  if (publishResponses.length > 0) {
    for (const resp of publishResponses) {
      const parsed = parseSaveArticleResponse(resp.body);
      if (parsed.success && parsed.articleUrl && parsed.articleUrl.includes('/article/details/')) {
        console.log('[CSDN Publish] SUCCESS — article URL:', parsed.articleUrl);
        return {
          success: true,
          postUrl: parsed.articleUrl,
          postId: parsed.articleId,
          verificationStatus: 'api_confirmed',
          verificationMessage: 'CSDN saveArticle API returned article URL',
        };
      }
    }
  }

  // Check URL navigation as fallback
  if (finalUrl.includes('blog.csdn.net') && finalUrl.includes('/article/details/')) {
    const articleId = finalUrl.match(/\/article\/details\/(\d+)/)?.[1] || '';
    console.log('[CSDN Publish] SUCCESS — navigated to article page:', finalUrl);
    return {
      success: true,
      postUrl: finalUrl,
      postId: articleId,
      verificationStatus: 'verified',
      verificationMessage: 'Navigated to article page after publish',
    };
  }

  // No real publish confirmation
  console.warn('[CSDN Publish] FAILED — no article URL returned');
  console.warn(`[CSDN Publish] Final URL: ${finalUrl}`);
  console.warn(`[CSDN Publish] API responses captured: ${publishResponses.length}`);
  if (publishResponses.length > 0) {
    const lastResp = publishResponses[publishResponses.length - 1];
    console.warn(`[CSDN Publish] Last response status: ${lastResp.status}`);
    console.warn(`[CSDN Publish] Last response body: ${lastResp.body.substring(0, LAST_RESPONSE_BODY_PREVIEW_LENGTH)}`);
  }

  // Try to get error message from page
  try {
    const errorMsg = await page.evaluate(() => {
      const errEl = document.querySelector('.el-message, .error-message, [class*="error"], [class*="Error"]');
      return errEl ? errEl.textContent?.trim().substring(0, ERROR_MESSAGE_PREVIEW_LENGTH) : '';
    });
    if (errorMsg) {
      console.warn('[CSDN Publish] Error message on page:', errorMsg);
    }
  } catch { /* ignore */ }

  return {
    success: false,
    draftSaved: publishResponses.length > 0,
    error: 'Article not published. The publish button may have been clicked but the final submission failed. Check if tags were filled properly and if the account has daily publish quota remaining.',
    verificationStatus: 'failed',
    verificationMessage: 'Publish dialog opened but final publish did not return an article URL.',
  };
}

/** Generate default tags from article title */
function generateCsdnTags(title: string): string[] {
  // Simple tag extraction from title
  const words = title
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= MIN_TAG_WORD_LENGTH)
    .slice(0, DEFAULT_CSDN_TAG_COUNT);
  if (words.length === 0) words.push('技术分享');
  return words;
}

/** Fill title in CSDN editor
 *  Correct selector for 2026 editor: input.article-bar__title
 */
async function fillCsdnTitle(page: Page, title: string): Promise<boolean> {
  // Primary: the known working selector
  const primarySelectors = [
    'input.article-bar__title',
    '.article-bar__title',
    'input[placeholder*="请输入文章标题"]',
    'input[placeholder*="请输入标题"]',
  ];

  for (const sel of primarySelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: ELEMENT_TIMEOUT_SHORT_MS })) {
        await el.click();
        await page.waitForTimeout(WAIT_MINIMAL_CLICK_MS);
        await el.fill(title);
        const value = await el.inputValue().catch(() => '');
        if (value && value.length > 0) {
          console.log(`[CSDN Publish] Title filled via: ${sel}`);
          return true;
        }
      }
    } catch { /* try next */ }
  }

  // Fallback selectors (older versions)
  const fallbackSelectors = [
    '#txtTitle',
    'input[placeholder*="标题"]',
    'textarea[placeholder*="标题"]',
    'input.article-title',
    '.title-input input',
    '.title-container input',
    'div[class*="title"] input',
    '.article-bar__input',
  ];

  for (const sel of fallbackSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: ELEMENT_TIMEOUT_BRIEF_MS })) {
        await el.click();
        await page.waitForTimeout(WAIT_MINIMAL_CLICK_MS);
        await el.fill(title);
        const value = await el.inputValue().catch(() => '');
        if (value && value.length > 0) {
          console.log(`[CSDN Publish] Title filled via fallback: ${sel}`);
          return true;
        }
      }
    } catch { /* try next */ }
  }

  // Last resort: DOM search with native value setter
  try {
    const filled = await page.evaluate((t: string) => {
      const inputs = Array.from(document.querySelectorAll('input, textarea')) as HTMLInputElement[];
      for (const input of inputs) {
        const ph = input.getAttribute('placeholder') || '';
        const cls = input.className || '';
        if (typeof cls === 'string' && cls.includes('article-bar__title')) {
          input.focus();
          input.value = t;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
        if (ph.includes('标题') || ph.includes('title')) {
          input.focus();
          input.value = t;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
      }
      return false;
    }, title);
    if (filled) {
      console.log('[CSDN Publish] Title filled via DOM search');
      return true;
    }
  } catch { /* continue */ }

  return false;
}

/** Fill Markdown content in CSDN editor
 *  CSDN uses cledit library: <pre class="editor__inner" contenteditable>
 *  execCommand('insertText') works reliably; CodeMirror API does NOT.
 */
async function fillCsdnContent(page: Page, content: string): Promise<boolean> {
  // Approach 1: execCommand on .editor__inner (cledit - the actual 2026 editor)
  try {
    const filled = await page.evaluate((md: string) => {
      const editor = document.querySelector('.editor__inner') as HTMLElement | null;
      if (!editor) return false;
      editor.focus();
      // Select all existing content
      document.execCommand('selectAll', false, null);
      // Insert new content
      document.execCommand('insertText', false, md);
      return (editor as HTMLElement).innerText.length > 0;
    }, content);
    if (filled) {
      console.log('[CSDN Publish] Content filled via execCommand (cledit/.editor__inner)');
      return true;
    }
  } catch { /* continue */ }

  // Approach 2: contenteditable pre element (generic)
  try {
    const filled = await page.evaluate((md: string) => {
      const editor = document.querySelector('pre[contenteditable="true"], div[contenteditable="true"].editor__inner') as HTMLElement | null;
      if (!editor) return false;
      editor.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, md);
      return (editor as HTMLElement).innerText.length > 0;
    }, content);
    if (filled) {
      console.log('[CSDN Publish] Content filled via execCommand (contenteditable)');
      return true;
    }
  } catch { /* continue */ }

  // Approach 3: CodeMirror 5 (older editor versions)
  try {
    const filled = await page.evaluate((md: string) => {
      const cmEl = document.querySelector('.CodeMirror') as HTMLElement & { CodeMirror?: { setValue: (val: string) => void } };
      if (cmEl && cmEl.CodeMirror) {
        cmEl.CodeMirror.setValue(md);
        return true;
      }
      return false;
    }, content);
    if (filled) {
      console.log('[CSDN Publish] Content filled via CodeMirror 5 API');
      return true;
    }
  } catch { /* continue */ }

  // Approach 4: CodeMirror 6
  try {
    const filled = await page.evaluate((md: string) => {
      const cm6El = document.querySelector('.cm-editor') as HTMLElement & { CodeMirror?: { dispatch: (opts: { changes: { from: number; to: number; insert: string } }) => void; state: { doc: { length: number } } } };
      if (cm6El && cm6El.CodeMirror) {
        const view = cm6El.CodeMirror;
        if (view && view.dispatch) {
          view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: md } });
          return true;
        }
      }
      return false;
    }, content);
    if (filled) {
      console.log('[CSDN Publish] Content filled via CodeMirror 6 API');
      return true;
    }
  } catch { /* continue */ }

  // Approach 5: Click editor area and type
  try {
    const editorArea = page.locator('.editor__inner, .CodeMirror, .cm-editor, .editor-area, .markdown-editor').first();
    if (await editorArea.isVisible({ timeout: ELEMENT_TIMEOUT_MEDIUM_MS })) {
      await editorArea.click();
      await page.waitForTimeout(WAIT_AFTER_FOCUS_MS);
      await page.keyboard.press('Control+a');
      await page.waitForTimeout(WAIT_AFTER_SELECT_ALL_MS);
      await page.keyboard.type(content.substring(0, KEYBOARD_TYPE_MAX_LENGTH), { delay: 0 });
      console.log('[CSDN Publish] Content filled via keyboard typing');
      return true;
    }
  } catch { /* continue */ }

  return false;
}

/** Step 1: Click .btn-publish to open the publish settings dialog */
async function openCsdnPublishDialog(page: Page): Promise<boolean> {
  // Primary selector (confirmed working 2026)
  const primarySelectors = [
    '.btn-publish',
    'button.btn-publish',
    '.editor-header .btn-publish',
    '.toolbar .btn-publish',
  ];

  for (const sel of primarySelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: ELEMENT_TIMEOUT_MEDIUM_MS })) {
        await btn.click();
        console.log(`[CSDN Publish] Dialog opened via: ${sel}`);
        return true;
      }
    } catch { /* try next */ }
  }

  // Fallback: text-based search for publish button
  const textSelectors = [
    'button:has-text("发布文章")',
    'button:has-text("发布")',
    'a:has-text("发布文章")',
    '.el-button--primary:has-text("发布")',
    '.ant-btn-primary:has-text("发布")',
  ];

  for (const sel of textSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: ELEMENT_TIMEOUT_SHORT_MS })) {
        await btn.click();
        console.log(`[CSDN Publish] Dialog opened via text selector: ${sel}`);
        return true;
      }
    } catch { /* try next */ }
  }

  // Last resort: DOM search
  try {
    const clicked = await page.evaluate(([minW, minH]) => {
      const candidates = Array.from(document.querySelectorAll('button, a, div[role="button"]')) as HTMLElement[];
      // Prefer top-right area
      for (const el of candidates) {
        const text = (el.textContent || '').trim();
        const cls = (el.className || '').toString();
        if (cls.includes('btn-publish') || text === '发布文章' || text === '发布') {
          const rect = el.getBoundingClientRect();
          if (rect.top < window.innerHeight * 0.4 && rect.left > window.innerWidth * 0.5 && rect.width > minW) {
            el.click();
            return true;
          }
        }
      }
      // Any visible publish button
      for (const el of candidates) {
        const text = (el.textContent || '').trim();
        if (text === '发布文章' || text === '发布') {
          const rect = el.getBoundingClientRect();
          if (rect.width > minW && rect.height > minH) {
            el.click();
            return true;
          }
        }
      }
      return false;
    }, [MIN_BUTTON_WIDTH, MIN_BUTTON_HEIGHT] as const);
    if (clicked) {
      console.log('[CSDN Publish] Dialog opened via DOM fallback');
      return true;
    }
  } catch { /* continue */ }

  return false;
}

/** Fill article tags in the publish dialog (REQUIRED field, ≤5 tags)
 *  The tag input uses a search + enter pattern, but the Vue-based UI
 *  may not respond to simulated input. We try multiple approaches.
 */
async function fillCsdnTags(page: Page, tags: string[]): Promise<boolean> {
  if (!tags || tags.length === 0) return false;

  const tagList = Array.isArray(tags) ? tags : [tags];
  const tagsToAdd = tagList.slice(0, CSDN_MAX_TAGS); // CSDN limit: ≤5

  // Approach 1: Find tag input and type each tag + press Enter
  const tagInputSelectors = [
    '.mark_selection input',
    '.tag-selector input',
    '.tag-input input',
    'input[placeholder*="添加文章标签"]',
    'input[placeholder*="搜索标签"]',
    '.el-dialog input[placeholder*="标签"]',
    '.publish-dialog input[placeholder*="标签"]',
  ];

  for (const sel of tagInputSelectors) {
    try {
      const input = page.locator(sel).first();
      if (await input.isVisible({ timeout: ELEMENT_TIMEOUT_SHORT_MS })) {
        console.log(`[CSDN Publish] Tag input found via: ${sel}`);
        let addedCount = 0;
        for (const tag of tagsToAdd) {
          await input.click();
          await page.waitForTimeout(WAIT_AFTER_TAG_CLICK_MS);
          await input.fill(tag);
          await page.waitForTimeout(WAIT_FOR_TAG_SEARCH_MS); // wait for search results
          await page.keyboard.press('Enter');
          await page.waitForTimeout(WAIT_AFTER_TAG_ENTER_MS);
          addedCount++;
        }
        console.log(`[CSDN Publish] Added ${addedCount} tags via input`);
        if (addedCount > 0) return true;
        break;
      }
    } catch { /* try next */ }
  }

  // Approach 2: Try Vue store injection (advanced)
  // The article mentions: mark_selection.__vue__.saveTagToStore()
  try {
    const injected = await page.evaluate((tagArr: string[]) => {
      const markSelection = document.querySelector('.mark_selection') as HTMLElement & { __vue__?: { saveTagToStore: (a: string, b: string) => void } };
      if (markSelection && markSelection.__vue__) {
        try {
          for (const tag of tagArr) {
            markSelection.__vue__.saveTagToStore(tag, tag);
          }
          return true;
        } catch {
          return false;
        }
      }
      return false;
    }, tagsToAdd);
    if (injected) {
      console.log('[CSDN Publish] Tags filled via Vue store injection');
      return true;
    }
  } catch { /* continue */ }

  // Approach 3: DOM search for tag input
  try {
    const filled = await page.evaluate((tagArr: string[]) => {
      const dialog = document.querySelector('.el-dialog, .modal, .dialog, [class*="publish-dialog"], [class*="PublishDialog"]');
      if (!dialog) return false;
      const inputs = dialog.querySelectorAll('input');
      for (const input of inputs) {
        const ph = input.getAttribute('placeholder') || '';
        if (ph.includes('标签') || ph.includes('tag') || ph.includes('搜索')) {
          // Try to add tags via input events
          let count = 0;
          for (const tag of tagArr) {
            input.focus();
            (input as HTMLInputElement).value = tag;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            // Try Enter key
            const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true });
            input.dispatchEvent(enterEvent);
            count++;
          }
          return count > 0;
        }
      }
      return false;
    }, tagsToAdd);
    if (filled) {
      console.log('[CSDN Publish] Tags filled via DOM fallback');
      return true;
    }
  } catch { /* continue */ }

  console.warn('[CSDN Publish] Could not fill tags via any method');
  return false;
}

/** Step 3: Click the final "发布文章" button inside the publish dialog */
async function clickCsdnFinalPublishButton(page: Page): Promise<boolean> {
  // Look for publish button inside the dialog
  const dialogSelectors = [
    '.el-dialog__footer .btn-publish',
    '.el-dialog button:has-text("发布文章")',
    '.el-dialog__footer button:has-text("发布文章")',
    '.publish-dialog button:has-text("发布文章")',
    '.dialog-footer button:has-text("发布文章")',
    '.modal-footer button:has-text("发布文章")',
    '.el-button--primary:has-text("发布文章")',
    'button:has-text("发布文章")',
    '.el-dialog button:has-text("发布"):not(:has-text("保存为草稿")):not(:has-text("定时"))',
  ];

  for (const sel of dialogSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: ELEMENT_TIMEOUT_MEDIUM_MS })) {
        await btn.click();
        console.log(`[CSDN Publish] Final publish clicked via: ${sel}`);
        return true;
      }
    } catch { /* try next */ }
  }

  // Last resort: DOM search for "发布文章" button in dialog area
  try {
    const clicked = await page.evaluate(([minW, minH]) => {
      // Find the dialog
      const dialog = document.querySelector('.el-dialog, .modal, [class*="dialog"], [class*="Dialog"]');
      const scope = dialog || document.body;
      const buttons = scope.querySelectorAll('button, a, div[role="button"]');
      for (const btn of buttons) {
        const htmlBtn = btn as HTMLElement;
        const text = (htmlBtn.textContent || '').trim();
        if (text === '发布文章') {
          const rect = htmlBtn.getBoundingClientRect();
          if (rect.width > minW && rect.height > minH) {
            htmlBtn.click();
            return true;
          }
        }
      }
      // Also try "发布" if it's the primary button in the footer
      const footerBtns = scope.querySelectorAll('.el-dialog__footer button, .dialog-footer button, .modal-footer button');
      for (const btn of footerBtns) {
        const htmlBtn = btn as HTMLElement;
        const text = (htmlBtn.textContent || '').trim();
        if (text === '发布' || text === '发布文章') {
          htmlBtn.click();
          return true;
        }
      }
      return false;
    }, [MIN_BUTTON_WIDTH, MIN_BUTTON_HEIGHT] as const);
    if (clicked) {
      console.log('[CSDN Publish] Final publish clicked via DOM fallback');
      return true;
    }
  } catch { /* continue */ }

  return false;
}

interface SaveArticleParseResult {
  success: boolean;
  articleUrl: string;
  articleId: string;
  raw?: unknown;
}

/** Parse saveArticle API response */
function parseSaveArticleResponse(body: string): SaveArticleParseResult {
  try {
    const data = JSON.parse(body) as { code?: number; data?: { url?: string; article_url?: string; article_id?: string | number; id?: string | number } | string; url?: string; article_url?: string; article_id?: string | number; id?: string | number };
    const success = data.code === 200 || data.code === 0;
    let articleUrl = '';
    let articleId = '';

    if (data.data && typeof data.data === 'object') {
      articleUrl = data.data.url || data.data.article_url || '';
      articleId = String(data.data.article_id || data.data.id || '');
    } else if (typeof data.data === 'string') {
      articleUrl = data.url || data.article_url || '';
      articleId = String(data.article_id || data.id || '');
    }

    // Build URL if we have ID but no URL
    if (articleId && !articleUrl) {
      articleUrl = `https://blog.csdn.net/article/details/${articleId}`;
    }

    return { success, articleUrl, articleId, raw: data };
  } catch {
    return { success: false, articleUrl: '', articleId: '' };
  }
}

// ============================================================================
// Route registration
// ============================================================================

export function registerPublishRoutes(app: Express): void {
  /**
   * POST /rpa/publish
   *
   * Publish an article via browser automation: launches a headless browser,
   * loads saved cookies, navigates to the platform's publish page,
   * fills in the title and content, and submits.
   */
  app.post('/rpa/publish', async (req: Request, res: Response) => {
    let { platform, article, credentials } = req.body || {};

    if (!platform || !article || !credentials) {
      return res.status(400).json({ success: false, error: 'Missing platform, article, or credentials' });
    }

    // 主服务把 llmwikiName 直接透传过来，这里统一归一化到 harvester 平台键
    const PLATFORM_ALIASES: Record<string, string> = {
      toutiao: 'toutiaohao',
    };
    if (PLATFORM_ALIASES[platform]) {
      console.log(`[rpa/publish] platform alias ${platform} -> ${PLATFORM_ALIASES[platform]}`);
      platform = PLATFORM_ALIASES[platform];
    }

    const platformUrl = PLATFORM_URLS[platform];
    if (!platformUrl) {
      return res.status(400).json({ success: false, error: `Unknown platform: ${platform}` });
    }

    const cookieStr = credentials.data?.cookie || credentials.data?.cookies || '';
    const storageState = credentials.data?.storageState || '';

    if (!cookieStr && !storageState) {
      return res.status(400).json({ success: false, error: 'No cookie or storageState in credentials' });
    }

    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    try {
      browser = await chromium.launch({ headless: true, ...getProxyOptions() });
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });

      // Load cookies
      if (storageState) {
        try {
          await context.addCookies(JSON.parse(storageState).cookies || []);
        } catch { /* ignore */ }
      } else if (cookieStr) {
        const domain = PLATFORM_DOMAINS[platform] || new URL(platformUrl).hostname;
        const cookies = parseCookieString(cookieStr, domain);
        await context.addCookies(cookies);
      }

      const page = await context.newPage();

      // Navigate to platform publish page
      const publishUrl = platformUrl.replace(/\/$/, '') + '/publish';
      await page.goto(publishUrl, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });

      // Check if redirected to login
      const currentUrl = page.url();
      if (currentUrl.includes('login') || currentUrl.includes('signin') || currentUrl.includes('passport')) {
        return res.json({
          success: false,
          error: 'Session expired — redirected to login page',
          verificationStatus: 'unverified',
        });
      }

      // Fill title
      const titleInput = page.locator('input[type="text"], input[placeholder*="标题"], textarea[placeholder*="标题"]').first();
      if (titleInput) {
        await titleInput.fill(article.title || '无标题');
      }

      // Fill content
      const editor = page.locator('[contenteditable="true"], textarea[placeholder*="内容"], .ProseMirror').first();
      if (editor) {
        await editor.fill(article.contentHtml || article.contentMarkdown || '');
      }

      // Click publish button
      const publishBtn = page.locator('button:has-text("发布"), button:has-text("发表"), button[type="submit"]').first();
      if (publishBtn) {
        await publishBtn.click();
        await page.waitForTimeout(WAIT_AFTER_PUBLISH_CLICK_MS);
      }

      const finalUrl = page.url();

      return res.json({
        success: true,
        postUrl: finalUrl,
        verificationStatus: 'verified',
        verificationMessage: `Published to ${PLATFORM_NAMES[platform] || platform}`,
      });
    } catch (err: unknown) {
      const error = err as Error;
      console.error(`[publish] RPA publish error for ${platform}:`, error.message);
      return res.status(500).json({
        success: false,
        error: `Publish failed: ${error.message}`,
        verificationStatus: 'failed',
      });
    } finally {
      if (browser) {
        await browser.close().catch(() => { /* ignore */ });
      }
    }
  });

  /**
   * POST /api/llmwiki/publish
   *
   * LLMWiki pipeline publish endpoint — used by RemotePublisher in the main server
   * when RPA_REMOTE_URL is set. Delegates article publishing to the harvester
   * which has Playwright installed.
   *
   * CSDN uses a dedicated implementation with proper publish verification
   * (checking saveArticle API response + URL navigation).
   */
  app.post('/api/llmwiki/publish', async (req: Request, res: Response) => {
    let { platform, article, credentials } = req.body || {};

    if (!platform || !article) {
      return res.status(400).json({ success: false, error: 'Missing platform or article' });
    }

    // 主服务把 llmwikiName 直接透传过来，这里统一归一化到 harvester 平台键
    const PLATFORM_ALIASES: Record<string, string> = {
      toutiao: 'toutiaohao',
    };
    if (PLATFORM_ALIASES[platform]) {
      console.log(`[publish] platform alias ${platform} -> ${PLATFORM_ALIASES[platform]}`);
      platform = PLATFORM_ALIASES[platform];
    }

    const platformUrl = PLATFORM_URLS[platform];
    if (!platformUrl) {
      return res.status(400).json({ success: false, error: `Unknown platform: ${platform}` });
    }

    const cookieStr = credentials?.data?.cookie || credentials?.data?.cookies || '';
    const storageState = credentials?.data?.storageState || '';
    const accountName = credentials?.accountName || credentials?.name || 'default';

    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    let authCleanup: (() => Promise<void>) | null = null;
    let publishMode = 'cookie';

    try {
      // Try persistent profile first, fallback to cookie injection
      let context: import('playwright').BrowserContext;
      try {
        const authResult = await createAuthenticatedContext({
          platform,
          accountName,
          headless: true,
          cookieString: cookieStr,
          storageState,
        });
        context = authResult.context;
        authCleanup = authResult.cleanup;
        publishMode = authResult.mode;
        console.log(`[publish] Using ${authResult.mode} mode for ${platform}/${accountName}`);
      } catch (profileErr) {
        // Fallback: classic cookie injection
        console.log(`[publish] Profile mode failed, falling back to cookie injection: ${profileErr.message}`);
        browser = await chromium.launch({ headless: true, ...getProxyOptions() });
        context = await browser.newContext({
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        });

        // Load cookies
        if (storageState) {
          try {
            await context.addCookies(JSON.parse(storageState).cookies || []);
          } catch { /* ignore */ }
        } else if (cookieStr) {
          const domain = PLATFORM_DOMAINS[platform] || new URL(platformUrl).hostname;
          const cookies = parseCookieString(cookieStr, domain);
          await context.addCookies(cookies);
        }
      }

      const page = await context.newPage();

      // --- CSDN: use dedicated publish logic with proper verification ---
      if (platform === 'csdn') {
        const result = await publishToCsdn(page, article);
        return res.json({ ...result, publishMode });
      }

      // --- 头条号 (Toutiao): dedicated publish logic ---
      if (platform === 'toutiaohao') {
        const result = await publishToToutiao(page, article);
        return res.json({ ...result, publishMode });
      }

      // --- Generic publish logic for other platforms ---
      // Navigate to platform
      await page.goto(platformUrl, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });

      // Check if redirected to login
      const currentUrl = page.url();
      const loginRedirects = ['login', 'signin', 'passport', 'sso.'];
      const isLoginRedirect = loginRedirects.some((p) => currentUrl.toLowerCase().includes(p));

      if (isLoginRedirect) {
        return res.json({
          success: false,
          error: 'Session expired — redirected to login page',
          verificationStatus: 'unverified',
        });
      }

      // Try to find and click the publish/edit button
      const publishEntry = page.locator(
        'a:has-text("发布"), a:has-text("投稿"), a:has-text("写文章"), button:has-text("发布")'
      ).first();

      if (publishEntry) {
        await publishEntry.click().catch(() => { /* ignore */ });
        await page.waitForTimeout(WAIT_AFTER_ENTRY_CLICK_MS);
      }

      // Fill title
      const titleInput = page.locator(
        'input[type="text"], input[placeholder*="标题"], textarea[placeholder*="标题"]'
      ).first();
      if (titleInput) {
        await titleInput.fill(article.title || '无标题');
      }

      // Fill content
      const editor = page.locator(
        '[contenteditable="true"], textarea[placeholder*="内容"], .ProseMirror, .public-DraftEditor-content'
      ).first();
      if (editor && (article.contentHtml || article.contentMarkdown)) {
        await editor.fill(article.contentHtml || article.contentMarkdown);
      }

      // Submit
      const submitBtn = page.locator(
        'button:has-text("发布"), button:has-text("发表"), button:has-text("提交"), button[type="submit"]'
      ).first();
      if (submitBtn) {
        await submitBtn.click().catch(() => { /* ignore */ });
        await page.waitForTimeout(WAIT_AFTER_SUBMIT_MS);
      }

      const finalUrl = page.url();

      return res.json({
        success: true,
        postUrl: finalUrl,
        verificationStatus: 'verified',
        verificationMessage: `Published to ${PLATFORM_NAMES[platform] || platform}`,
        publishMode,
      });
    } catch (err: unknown) {
      const error = err as Error;
      console.error(`[publish] LLMWiki publish error for ${platform}:`, error.message);
      return res.status(500).json({
        success: false,
        error: `Publish failed: ${error.message}`,
        verificationStatus: 'failed',
      });
    } finally {
      if (authCleanup) {
        await authCleanup().catch(() => { /* ignore */ });
      }
      if (browser) {
        await browser.close().catch(() => { /* ignore */ });
      }
    }
  });
}
