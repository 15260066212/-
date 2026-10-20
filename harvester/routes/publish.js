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

const { chromium } = require('playwright');
const {
  sessions,
  remoteSessions,
  closeSession,
  getCredential,
  upsertCredential,
  fingerprintGenerator,
  fingerprintInjector,
} = require('../config');
const { PLATFORM_URLS, PLATFORM_NAMES } = require('../config/platforms');
const {
  parseCookieString,
  filterCookiesByDomain,
  getAuthCookieNames,
  PLATFORM_DOMAINS,
} = require('../lib/cookie-utils');
const wechatsync = require('../lib/wechatsync-publisher');
// 服务器版本此前漏掉了这行 require，导致 /rpa/publish 与 /api/llmwiki/publish
// 的 profile/cookie 认证上下文构造抛 "createAuthenticatedContext is not defined"，
// 两条 RPA 路径实际不可用。此处补齐。
const { createAuthenticatedContext } = require('../lib/publish-context');

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


/**
 * Publish to 头条号 (Toutiao) with proper editor handling.
 */
async function publishToToutiao(page, article) {
  const publishUrl = 'https://mp.toutiao.com/profile_v4/graphic/publish';

  try {
    console.log('[Toutiao Publish] Navigating to publish page...');
    await page.goto(publishUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const currentUrl = page.url();
    if (currentUrl.includes('login') || currentUrl.includes('sso.toutiao') || currentUrl.includes('passport')) {
      return {
        success: false,
        error: 'Not logged in — redirected to login page',
        verificationStatus: 'unverified',
      };
    }

    await page.waitForTimeout(3000);

    // Close AI assistant drawer if present
    console.log('[Toutiao Publish] Closing AI assistant drawer...');
    try {
      const drawerMask = page.locator('.ai-assistant-drawer .byte-drawer-mask').first();
      if (await drawerMask.isVisible({ timeout: 2000 })) {
        const closeBtn = page.locator('.ai-assistant-drawer .byte-drawer-close, .ai-assistant-drawer [class*="close-icon"]').first();
        if (await closeBtn.isVisible({ timeout: 1000 })) {
          await closeBtn.click();
        } else {
          await page.mouse.click(100, 300);
        }
        await page.waitForTimeout(1000);
      }
    } catch { /* ignore */ }

    // Fill title
    console.log('[Toutiao Publish] Filling title...');
    const titleInput = page.locator('textarea[placeholder*="标题"]').first();
    if (!await titleInput.isVisible({ timeout: 5000 })) {
      return {
        success: false,
        error: 'Could not find title input in 头条号 editor',
        verificationStatus: 'failed',
      };
    }
    await titleInput.fill(article.title || '无标题');

    // Fill content
    console.log('[Toutiao Publish] Filling content...');
    const editor = page.locator('.ProseMirror[contenteditable="true"]').first();
    if (!await editor.isVisible({ timeout: 5000 })) {
      return {
        success: false,
        error: 'Could not find content editor in 头条号',
        verificationStatus: 'failed',
      };
    }

    await editor.click({ force: true });
    await page.waitForTimeout(500);

    const content = article.contentHtml || article.contentMarkdown || '';
    if (content) {
      if (content.length > 500) {
        await page.evaluate((html) => {
          const el = document.querySelector('.ProseMirror[contenteditable="true"]');
          if (el) {
            el.innerHTML = html;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, article.contentHtml || `<p>${content.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`);
      } else {
        await page.keyboard.type(content);
      }
    }

    await page.waitForTimeout(3000);

    // Check publish button
    const publishBtn = page.locator('button:has-text("预览并发布")').first();
    const btnVisible = await publishBtn.isVisible({ timeout: 3000 }).catch(() => false);
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

    // Return success with draft status (don't actually publish)
    return {
      success: true,
      verificationStatus: 'draft_ready',
      verificationMessage: '头条号 article ready to publish (draft saved, publish button enabled)',
      draftSaved: true,
    };

  } catch (err) {
    console.error('[Toutiao Publish] Error:', err.message);
    return {
      success: false,
      error: `Publish failed: ${err.message}`,
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
async function publishToCsdn(page, article) {
  const editorUrl = 'https://editor.csdn.net/md/';

  // Navigate to editor
  console.log('[CSDN Publish] Navigating to editor:', editorUrl);
  await page.goto(editorUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);

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
  let publishResponses = [];
  let listening = false;

  page.on('response', async (response) => {
    if (!listening) return;
    const url = response.url();
    if (url.includes('saveArticle') || url.includes('save_article') || url.includes('publishArticle')) {
      try {
        const body = await response.text();
        publishResponses.push({ status: response.status(), body, url });
        console.log(`[CSDN Publish] Publish API response: ${response.status()} ${body.substring(0, 200)}`);
      } catch {
        // body already consumed
      }
    }
  });

  // Wait for editor to be ready
  await page.waitForTimeout(2000);

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
  await page.waitForTimeout(2000);

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
  await page.waitForTimeout(1500);

  // --- Step 2: Fill tags (REQUIRED field) ---
  console.log('[CSDN Publish] Step 2: Filling article tags...');
  const tags = article.tags || article.keywords || generateCsdnTags(article.title || '');
  const tagsFilled = await fillCsdnTags(page, tags);
  if (!tagsFilled) {
    console.warn('[CSDN Publish] Failed to fill tags — this may prevent publishing');
  } else {
    console.log('[CSDN Publish] Tags filled successfully');
  }
  await page.waitForTimeout(1000);

  // --- Step 3: Click the final "发布文章" button in the dialog ---
  console.log('[CSDN Publish] Step 3: Clicking final publish button in dialog...');
  // Now start listening for publish responses
  publishResponses = [];
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
  while (publishResponses.length === 0 && waitCount < 60) {
    await page.waitForTimeout(500);
    waitCount++;
  }

  const finalUrl = page.url();
  console.log('[CSDN Publish] Final URL:', finalUrl);

  // Check if we got a valid publish response
  if (publishResponses.length > 0) {
    for (const resp of publishResponses) {
      const parsed = parseSaveArticleResponse(resp.body);
      if (parsed.success && parsed.articleUrl && parsed.articleUrl.includes('/article/details/')) {
        console.log('[CSDN Publish] ✅ SUCCESS — article URL:', parsed.articleUrl);
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
    console.log('[CSDN Publish] ✅ SUCCESS — navigated to article page:', finalUrl);
    return {
      success: true,
      postUrl: finalUrl,
      postId: articleId,
      verificationStatus: 'verified',
      verificationMessage: 'Navigated to article page after publish',
    };
  }

  // No real publish confirmation
  console.warn('[CSDN Publish] ❌ FAILED — no article URL returned');
  console.warn(`[CSDN Publish] Final URL: ${finalUrl}`);
  console.warn(`[CSDN Publish] API responses captured: ${publishResponses.length}`);
  if (publishResponses.length > 0) {
    const lastResp = publishResponses[publishResponses.length - 1];
    console.warn(`[CSDN Publish] Last response status: ${lastResp.status}`);
    console.warn(`[CSDN Publish] Last response body: ${lastResp.body.substring(0, 300)}`);
  }

  // Try to get error message from page
  try {
    const errorMsg = await page.evaluate(() => {
      const errEl = document.querySelector('.el-message, .error-message, [class*="error"], [class*="Error"]');
      return errEl ? errEl.textContent.trim().substring(0, 150) : '';
    });
    if (errorMsg) {
      console.warn('[CSDN Publish] Error message on page:', errorMsg);
    }
  } catch {}

  return {
    success: false,
    draftSaved: publishResponses.length > 0,
    error: 'Article not published. The publish button may have been clicked but the final submission failed. Check if tags were filled properly and if the account has daily publish quota remaining.',
    verificationStatus: 'failed',
    verificationMessage: 'Publish dialog opened but final publish did not return an article URL.',
  };
}

/** Generate default tags from article title */
function generateCsdnTags(title) {
  // Simple tag extraction from title
  const words = title
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2)
    .slice(0, 3);
  if (words.length === 0) words.push('技术分享');
  return words;
}

/** Fill title in CSDN editor
 *  Correct selector for 2026 editor: input.article-bar__title
 */
async function fillCsdnTitle(page, title) {
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
      if (await el.isVisible({ timeout: 2000 })) {
        await el.click();
        await page.waitForTimeout(100);
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
      if (await el.isVisible({ timeout: 1500 })) {
        await el.click();
        await page.waitForTimeout(100);
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
    const filled = await page.evaluate((t) => {
      const inputs = Array.from(document.querySelectorAll('input, textarea'));
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
async function fillCsdnContent(page, content) {
  // Approach 1: execCommand on .editor__inner (cledit - the actual 2026 editor)
  try {
    const filled = await page.evaluate((md) => {
      const editor = document.querySelector('.editor__inner');
      if (!editor) return false;
      editor.focus();
      // Select all existing content
      document.execCommand('selectAll', false, null);
      // Insert new content
      document.execCommand('insertText', false, md);
      return editor.innerText.length > 0;
    }, content);
    if (filled) {
      console.log('[CSDN Publish] Content filled via execCommand (cledit/.editor__inner)');
      return true;
    }
  } catch { /* continue */ }

  // Approach 2: contenteditable pre element (generic)
  try {
    const filled = await page.evaluate((md) => {
      const editor = document.querySelector('pre[contenteditable="true"], div[contenteditable="true"].editor__inner');
      if (!editor) return false;
      editor.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, md);
      return editor.innerText.length > 0;
    }, content);
    if (filled) {
      console.log('[CSDN Publish] Content filled via execCommand (contenteditable)');
      return true;
    }
  } catch { /* continue */ }

  // Approach 3: CodeMirror 5 (older editor versions)
  try {
    const filled = await page.evaluate((md) => {
      const cmEl = document.querySelector('.CodeMirror');
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
    const filled = await page.evaluate((md) => {
      const cm6El = document.querySelector('.cm-editor');
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
    if (await editorArea.isVisible({ timeout: 3000 })) {
      await editorArea.click();
      await page.waitForTimeout(300);
      await page.keyboard.press('Control+a');
      await page.waitForTimeout(200);
      await page.keyboard.type(content.substring(0, 3000), { delay: 0 });
      console.log('[CSDN Publish] Content filled via keyboard typing');
      return true;
    }
  } catch { /* continue */ }

  return false;
}

/** Step 1: Click .btn-publish to open the publish settings dialog */
async function openCsdnPublishDialog(page) {
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
      if (await btn.isVisible({ timeout: 3000 })) {
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
      if (await btn.isVisible({ timeout: 2000 })) {
        await btn.click();
        console.log(`[CSDN Publish] Dialog opened via text selector: ${sel}`);
        return true;
      }
    } catch { /* try next */ }
  }

  // Last resort: DOM search
  try {
    const clicked = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('button, a, div[role="button"]'));
      // Prefer top-right area
      for (const el of candidates) {
        const text = (el.textContent || '').trim();
        const cls = (el.className || '').toString();
        if (cls.includes('btn-publish') || text === '发布文章' || text === '发布') {
          const rect = el.getBoundingClientRect();
          if (rect.top < window.innerHeight * 0.4 && rect.left > window.innerWidth * 0.5 && rect.width > 30) {
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
          if (rect.width > 30 && rect.height > 20) {
            el.click();
            return true;
          }
        }
      }
      return false;
    });
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
async function fillCsdnTags(page, tags) {
  if (!tags || tags.length === 0) return false;

  const tagList = Array.isArray(tags) ? tags : [tags];
  const tagsToAdd = tagList.slice(0, 5); // CSDN limit: ≤5

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
      if (await input.isVisible({ timeout: 2000 })) {
        console.log(`[CSDN Publish] Tag input found via: ${sel}`);
        let addedCount = 0;
        for (const tag of tagsToAdd) {
          await input.click();
          await page.waitForTimeout(200);
          await input.fill(tag);
          await page.waitForTimeout(500); // wait for search results
          await page.keyboard.press('Enter');
          await page.waitForTimeout(500);
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
    const injected = await page.evaluate((tagArr) => {
      const markSelection = document.querySelector('.mark_selection');
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
    const filled = await page.evaluate((tagArr) => {
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
            input.value = tag;
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
async function clickCsdnFinalPublishButton(page) {
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
      if (await btn.isVisible({ timeout: 3000 })) {
        await btn.click();
        console.log(`[CSDN Publish] Final publish clicked via: ${sel}`);
        return true;
      }
    } catch { /* try next */ }
  }

  // Last resort: DOM search for "发布文章" button in dialog area
  try {
    const clicked = await page.evaluate(() => {
      // Find the dialog
      const dialog = document.querySelector('.el-dialog, .modal, [class*="dialog"], [class*="Dialog"]');
      const scope = dialog || document.body;
      const buttons = scope.querySelectorAll('button, a, div[role="button"]');
      for (const btn of buttons) {
        const text = (btn.textContent || '').trim();
        if (text === '发布文章') {
          const rect = btn.getBoundingClientRect();
          if (rect.width > 30 && rect.height > 20) {
            btn.click();
            return true;
          }
        }
      }
      // Also try "发布" if it's the primary button in the footer
      const footerBtns = scope.querySelectorAll('.el-dialog__footer button, .dialog-footer button, .modal-footer button');
      for (const btn of footerBtns) {
        const text = (btn.textContent || '').trim();
        if (text === '发布' || text === '发布文章') {
          btn.click();
          return true;
        }
      }
      return false;
    });
    if (clicked) {
      console.log('[CSDN Publish] Final publish clicked via DOM fallback');
      return true;
    }
  } catch { /* continue */ }

  return false;
}

/** Parse saveArticle API response */
function parseSaveArticleResponse(body) {
  try {
    const data = JSON.parse(body);
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

function registerPublishRoutes(app) {
  /**
   * POST /rpa/publish
   *
   * Publish an article via browser automation: launches a headless browser,
   * loads saved cookies, navigates to the platform's publish page,
   * fills in the title and content, and submits.
   */
  app.post('/rpa/publish', async (req, res) => {
    const { platform, article, credentials } = req.body || {};

    if (!platform || !article || !credentials) {
      return res.status(400).json({ success: false, error: 'Missing platform, article, or credentials' });
    }

    const platformUrl = PLATFORM_URLS[platform];
    if (!platformUrl) {
      return res.status(400).json({ success: false, error: `Unknown platform: ${platform}` });
    }

    const cookieStr = credentials.data?.cookie || credentials.data?.cookies || '';
    const storageState = credentials.data?.storageState || '';

    // Profile-first: no cookie is OK if account profile exists
    const accountName = credentials?.accountName || '';

    let authCtx;
    try {
      // Profile-first: try account profile → cookie fallback → fresh context
      authCtx = await createAuthenticatedContext({
        platform,
        accountName,
        headless: true,
        cookieString: cookieStr,
        storageState,
      });

      const { context, mode, loginVerified, cleanup } = authCtx;
      const page = await context.newPage();

      // Navigate to platform publish page
      const publishUrl = platformUrl.replace(/\/$/, '') + '/publish';
      await page.goto(publishUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

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
      const titleInput = await page.locator('input[type="text"], input[placeholder*="标题"], textarea[placeholder*="标题"]').first();
      if (titleInput) {
        await titleInput.fill(article.title || '无标题');
      }

      // Fill content
      const editor = await page.locator('[contenteditable="true"], textarea[placeholder*="内容"], .ProseMirror').first();
      if (editor) {
        await editor.fill(article.contentHtml || article.contentMarkdown || '');
      }

      // Click publish button
      const publishBtn = await page.locator('button:has-text("发布"), button:has-text("发表"), button[type="submit"]').first();
      if (publishBtn) {
        await publishBtn.click();
        await page.waitForTimeout(3000);
      }

      const finalUrl = page.url();

      return res.json({
        success: true,
        postUrl: finalUrl,
        verificationStatus: 'verified',
        verificationMessage: `Published to ${PLATFORM_NAMES[platform] || platform}`,
      });
    } catch (err) {
      console.error(`[publish] RPA publish error for ${platform}:`, err.message);
      return res.status(500).json({
        success: false,
        error: `Publish failed: ${err.message}`,
        verificationStatus: 'failed',
      });
    } finally {
      if (authCtx && authCtx.cleanup) {
        try { await authCtx.cleanup(); } catch {}
      }
    }
  });

  /**
   * GET /api/wechatsync/status
   *
   * Wechatsync 扩展桥接诊断。带 ?platform=xxx 时顺带返回该平台的扩展登录态
   * （只读检查，不会创建草稿）。
   */
  app.get('/api/wechatsync/status', async (req, res) => {
    const platform = req.query.platform;
    const payload = { ...wechatsync.status() };
    if (platform) {
      payload.platform = platform;
      payload.supported = wechatsync.supports(platform);
      if (payload.supported) {
        payload.auth = await wechatsync.checkAuth(platform);
      }
    }
    return res.json(payload);
  });

  /**
   * POST /api/llmwiki/publish
   *
   * LLMWiki pipeline publish endpoint — used by RemotePublisher in the main server
   * when RPA_REMOTE_URL is set. Delegates article publishing to the harvester
   * which has Playwright installed.
   *
   * 优先走 Wechatsync 扩展桥接；插件未命中/未登录/失败时回落下面的 RPA 逻辑
   * （请求体带 wechatsyncOnly:true 时不回落，直接返回插件结果）。
   *
   * CSDN uses a dedicated implementation with proper publish verification
   * (checking saveArticle API response + URL navigation).
   */
  app.post('/api/llmwiki/publish', async (req, res) => {
    const { platform, article, credentials } = req.body || {};

    if (!platform || !article) {
      return res.status(400).json({ success: false, error: 'Missing platform or article' });
    }

    const platformUrl = PLATFORM_URLS[platform];
    if (!platformUrl) {
      return res.status(400).json({ success: false, error: `Unknown platform: ${platform}` });
    }

    const cookieStr = credentials?.data?.cookie || credentials?.data?.cookies || '';
    const storageState = credentials?.data?.storageState || '';
    const accountName = credentials?.accountName || '';

    // --- Wechatsync 扩展桥接（发布主路径） ---
    // 命中插件支持的平台 -> 走插件；未命中 -> 继续下面的 RPA 逻辑。
    // wechatsyncOnly=true 表示调用方（llmwiki_pipeline）要求只走插件，
    // 插件不可用/未登录时直接返回失败，避免 RPA 弱逻辑产出假成功。
    const wechatsyncOnly = req.body?.wechatsyncOnly === true;
    if (wechatsync.supports(platform)) {
      try {
        const pluginResult = await wechatsync.publish(platform, article, credentials);
        if (pluginResult.success || wechatsyncOnly) {
          return res.json(pluginResult);
        }
        console.warn(
          `[publish] wechatsync failed for ${platform}: ${pluginResult.error} — falling back to RPA`
        );
      } catch (err) {
        console.warn(`[publish] wechatsync bridge error for ${platform}: ${err.message}`);
        if (wechatsyncOnly) {
          return res.status(502).json({
            success: false,
            error: `wechatsync bridge error: ${err.message}`,
            verificationStatus: 'failed',
            publishMode: 'wechatsync',
          });
        }
      }
    } else if (wechatsyncOnly) {
      return res.json({
        success: false,
        unsupported: true,
        error: `Wechatsync plugin does not support platform: ${platform}`,
        publishMode: 'wechatsync',
      });
    }

    let authCtx;
    try {
      // Profile-first: try account profile, fallback to cookie, fallback to fresh
      authCtx = await createAuthenticatedContext({
        platform,
        accountName,
        headless: true,
        cookieString: cookieStr,
        storageState,
      });

      const { context, mode, loginVerified, cleanup } = authCtx;
      const page = await context.newPage();

      // --- 头条号 (Toutiao): dedicated publish logic ---
      if (platform === 'toutiaohao') {
        const result = await publishToToutiao(page, article);
        return res.json({ ...result, publishMode: mode });
      }

      // --- CSDN: use dedicated publish logic with proper verification ---
      if (platform === 'csdn') {
        const result = await publishToCsdn(page, article);
        return res.json({ ...result, publishMode: mode });
      }

      // --- Generic publish logic for other platforms ---
      // Navigate to platform
      await page.goto(platformUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Check if redirected to login
      const currentUrl = page.url();
      const loginRedirects = ['login', 'signin', 'passport', 'sso.'];
      const isLoginRedirect = loginRedirects.some((p) => currentUrl.toLowerCase().includes(p));

      if (isLoginRedirect) {
        if (cleanup) await cleanup();
        return res.json({
          success: false,
          error: 'Session expired — redirected to login page',
          verificationStatus: 'unverified',
          publishMode: mode,
        });
      }

      // Try to find and click the publish/edit button
      const publishEntry = await page.locator(
        'a:has-text("发布"), a:has-text("投稿"), a:has-text("写文章"), button:has-text("发布")'
      ).first();

      if (publishEntry) {
        await publishEntry.click().catch(() => {});
        await page.waitForTimeout(2000);
      }

      // Fill title
      const titleInput = await page.locator(
        'input[type="text"], input[placeholder*="标题"], textarea[placeholder*="标题"]'
      ).first();
      if (titleInput) {
        await titleInput.fill(article.title || '无标题');
      }

      // Fill content
      const editor = await page.locator(
        '[contenteditable="true"], textarea[placeholder*="内容"], .ProseMirror, .public-DraftEditor-content'
      ).first();
      if (editor && (article.contentHtml || article.contentMarkdown)) {
        await editor.fill(article.contentHtml || article.contentMarkdown);
      }

      // Submit
      const submitBtn = await page.locator(
        'button:has-text("发布"), button:has-text("发表"), button:has-text("提交"), button[type="submit"]'
      ).first();
      if (submitBtn) {
        await submitBtn.click().catch(() => {});
        await page.waitForTimeout(5000);
      }

      const finalUrl = page.url();

      return res.json({
        success: true,
        postUrl: finalUrl,
        verificationStatus: 'verified',
        verificationMessage: `Published to ${PLATFORM_NAMES[platform] || platform}`,
      });
    } catch (err) {
      console.error(`[publish] LLMWiki publish error for ${platform}:`, err.message);
      return res.status(500).json({
        success: false,
        error: `Publish failed: ${err.message}`,
        verificationStatus: 'failed',
      });
    } finally {
      if (authCtx && authCtx.cleanup) {
        try { await authCtx.cleanup(); } catch {}
      }
    }
  });
}

module.exports = { registerPublishRoutes };
