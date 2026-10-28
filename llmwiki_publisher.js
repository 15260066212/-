// LLMWiki-Powered Publisher v6
// - RPA-derived cover image selection (wait+poll+mouse click)
// - React-safe button clicks (locator + force + mouse + evaluate)
// - iframe support
const { LLMWikiV3 } = require('./llmwiki_index.js');

class LLMWikiPublisher {
  constructor() {
    this.llmwiki = new LLMWikiV3();
    this.maxRetries = 3;
    this._currentFrame = null;
  }

  async publish(page, platform, article) {
    console.log(`[LLMWikiPublisher] Publishing to ${platform}...`);
    this._currentFrame = null;

    const platformKnowledge = this.llmwiki.knowledge[platform];
    if (!platformKnowledge) {
      return { success: false, error: `No LLMWiki knowledge for platform: ${platform}` };
    }

    const publishMethod = platformKnowledge.publishMethods?.find(m => m.method === 'browser');
    if (!publishMethod) {
      return { success: false, error: `No browser publish method in LLMWiki for ${platform}` };
    }

    const steps = publishMethod.steps;
    const fallbackSelectors = publishMethod.fallbackSelectors || {};
    console.log(`[LLMWikiPublisher] Found ${steps.length} publish steps`);

    // P0融合: 监控发布相关API响应，用于成功判定
    const apiResponses = [];
    const publishApiKeywords = ['publish', 'submit', 'save', 'create', 'publish_article'];
    const responseHandler = (response) => {
      const url = response.url();
      const isPublishApi = publishApiKeywords.some(kw => url.includes(kw)) && url.includes('http');
      if (isPublishApi) {
        response.text().then(body => {
          apiResponses.push({ url: url.substring(0, 120), status: response.status(), method: response.request().method(), body: body.substring(0, 500) });
        }).catch(() => {});
      }
    };
    page.on('response', responseHandler);

    // Debug: capture publish API request bodies
    const requestHandler = (request) => {
      const url = request.url();
      if (url.includes('article/publish') && request.method() === 'POST') {
        const postData = request.postData();
        console.log(`[LLMWikiPublisher] PUBLISH REQUEST to ${url.substring(0, 80)}`);
        console.log(`[LLMWikiPublisher] PUBLISH BODY LENGTH: ${postData ? postData.length : 0}`);
        if (postData) {
          // Save full body to file for analysis
          const fs = require('fs');
          fs.writeFileSync('/tmp/toutiao_publish_body.txt', postData);
          console.log('[LLMWikiPublisher] Full publish body saved to /tmp/toutiao_publish_body.txt');
          // Log fields (keys only)
          const params = new URLSearchParams(postData);
          const fields = [...params.keys()];
          console.log(`[LLMWikiPublisher] PUBLISH FIELDS: ${fields.join(', ')}`);
          // Log cover-related fields
          for (const key of fields) {
            if (key.includes('cover') || key.includes('pic') || key.includes('image') || key.includes('thumb')) {
              console.log(`[LLMWikiPublisher] COVER FIELD: ${key}=${params.get(key)?.substring(0, 200)}`);
            }
          }
        }
      }
    };
    page.on('request', requestHandler);

    let currentStep = 0;
    let retryCount = 0;
    const maxTotalRetries = this.maxRetries * steps.length;

    const stepResults = [];
    while (currentStep < steps.length && retryCount < maxTotalRetries) {
      const step = steps[currentStep];
      const stepLabel = step.type + (step.script ? ':' + step.script : '') + (step.selector ? ':' + step.selector.substring(0, 30) : '');
      console.log(`[LLMWikiPublisher] Step ${currentStep + 1}/${steps.length}: ${step.type}${step.selector ? ' -> ' + step.selector : ''}${step.text ? ' -> ' + step.text : ''}${step.script ? ' -> ' + step.script : ''}`);

      try {
        const success = await this.executeStep(page, step, article, fallbackSelectors, platform);
        if (success) {
          stepResults.push({ step: stepLabel, ok: true, description: step.description || '' });
          currentStep++;
          retryCount = 0;

          // 头条号: 导航后检查登录状态
          if (platform === 'toutiao' && step.type === 'navigate') {
            const loginCheck = await this.checkToutiaoLogin(page);
            if (!loginCheck.loggedIn) {
              console.log(`[LLMWikiPublisher] Toutiao login check failed: ${loginCheck.reason}`);
              return {
                success: false,
                steps: stepResults,
                stepsCompleted: currentStep,
                error: `头条号Cookie过期或未登录: ${loginCheck.reason}`,
              };
            }
            console.log('[LLMWikiPublisher] Toutiao login verified');
          }
        } else {
          retryCount++;
          console.log(`[LLMWikiPublisher] Step ${currentStep + 1} failed, retry ${retryCount}`);

          if (step.selector) {
            const healed = await this.tryFallbackSelectors(page, step, fallbackSelectors);
            if (healed) { stepResults.push({ step: stepLabel, ok: true, healed: true }); retryCount = 0; currentStep++; continue; }
            try {
              const healResult = await this.llmwiki.healSelector(page, platform, step.type, step.selector);
              if (healResult && healResult.selector && healResult.selector !== step.selector) {
                step.selector = healResult.selector;
                continue;
              }
            } catch(e) {}
          }

          if (retryCount >= this.maxRetries && step.skipOnFailure) {
            console.log(`[LLMWikiPublisher] Skipping step: ${step.type}`);
            stepResults.push({ step: stepLabel, ok: true, skipped: true });
            currentStep++;
            retryCount = 0;
            continue;
          }

          await page.waitForTimeout(2000);
        }
      } catch (e) {
        console.log(`[LLMWikiPublisher] Step error: ${e.message.substring(0, 150)}`);
        retryCount++;

        if (retryCount >= this.maxRetries && step.skipOnFailure) {
          console.log(`[LLMWikiPublisher] Skipping step: ${step.type}`);
          stepResults.push({ step: stepLabel, ok: true, skipped: true, error: e.message.substring(0, 80) });
          currentStep++;
          retryCount = 0;
          continue;
        }

        if (retryCount >= maxTotalRetries) {
          stepResults.push({ step: stepLabel, ok: false, error: e.message.substring(0, 80) });
          try {
            const diag = await this.llmwiki.diagnoseError(platform, { error: e.message });
            return {
              success: false,
              error: `Failed at step ${currentStep + 1}: ${e.message}`,
              diagnosis: typeof diag === 'string' ? diag : (diag?.description || JSON.stringify(diag).substring(0, 200)),
              url: page.url(),
              steps: stepResults,
            };
          } catch {
            return { success: false, error: `Failed at step ${currentStep + 1}: ${e.message}`, url: page.url(), steps: stepResults };
          }
        }
        await page.waitForTimeout(1000);
      }
    }

    // P0融合: 头条号等SPA平台发布后需要更长等待时间（弹窗关闭+页面跳转）
    const extraWait = publishMethod?.successWait || platformKnowledge?.successWait || 8000;
    await page.waitForTimeout(extraWait);
    const finalUrl = page.url();

    // Debug: log all captured API responses
    console.log(`[LLMWikiPublisher] Captured ${apiResponses.length} API responses:`);
    for (const resp of apiResponses) {
      console.log(`[LLMWikiPublisher]   ${resp.method} ${resp.url} status=${resp.status} body=${resp.body.substring(0, 200)}`);
    }

    // Debug: screenshot after publish
    try {
      await page.screenshot({ path: `/tmp/toutiao_after_publish_${platform}.png` });
      console.log(`[LLMWikiPublisher] Screenshot saved: /tmp/toutiao_after_publish_${platform}.png`);
    } catch(e) {}

    // Debug: check page text for error/success indicators
    try {
      const bodyText = await page.locator('body').textContent({ timeout: 5000 });
      const indicators = ['发布成功', '已发布', '审核中', '发布失败', '参数错误', '请完成封面', '请选择', '不能为空', '发布异常'];
      const found = indicators.filter(t => bodyText?.includes(t));
      console.log(`[LLMWikiPublisher] Page text indicators found: ${found.length > 0 ? found.join(', ') : 'none'}`);
    } catch(e) {}

    // P0融合: API响应检查（优先级最高）
    let apiSuccess = false;
    let apiDetails = null;
    let apiError7050 = false;
    for (const resp of apiResponses) {
      try {
        const data = JSON.parse(resp.body);
        // 检查7050错误（secsdk检测到自动化环境）
        if (data.code === 7050 || data.err_no === 7050) {
          apiError7050 = true;
          console.log(`[LLMWikiPublisher] 7050 error detected from ${resp.url.substring(0, 60)}: ${data.message || data.err_tips || '保存失败'}`);
        }
        // 检查常见成功码
        if ((data.code === 0 || data.err_no === 0 || data.code === 200 || data.status === 'success') &&
            (resp.url.includes('publish') || resp.url.includes('submit'))) {
          // 排除自动保存的7050等失败
          if (data.code !== 7050 && data.err_no !== 7050) {
            apiSuccess = true;
            apiDetails = { url: resp.url, code: data.code, message: data.message || data.err_tips || 'success' };
            console.log(`[LLMWikiPublisher] API success detected: ${resp.url.substring(0, 60)} => code=${data.code}`);
            break;
          }
        }
      } catch {}
    }

    // 7050错误专项处理：secsdk检测到headless浏览器
    if (apiError7050 && !apiSuccess) {
      console.error('[LLMWikiPublisher] 7050 error: Toutiao secsdk detected automation environment. Fix: set RPA_HEADLESS=false + ensure Xvfb is running');
      return {
        success: false,
        url: finalUrl,
        steps: stepResults,
        stepsCompleted: currentStep,
        error: '头条号保存失败(7050) — secsdk检测到自动化环境，需设置RPA_HEADLESS=false并启动Xvfb虚拟显示',
        apiResponses: apiResponses.slice(-5),
      };
    }

    const urlSuccess = await this.verifyPublish(page, platform, platformKnowledge);
    const success = apiSuccess || urlSuccess;
    console.log(`[LLMWikiPublisher] Result: success=${success} (api=${apiSuccess}, url=${urlSuccess}), URL=${finalUrl}`);

    return { success, url: finalUrl, steps: stepResults, stepsCompleted: currentStep, apiSuccess, apiDetails, apiResponses: apiResponses.slice(-5) };
  }

  async executeStep(page, step, article, fallbackSelectors, platform) {
    const resolveValue = (val) => {
      if (!val) return val;
      if (val === '$title') return article.title;
      if (val === '$content') return article.contentMarkdown || article.content;
      if (val === '$summary') return article.summary || '';
      if (val.startsWith('$tag[')) {
        const idx = parseInt(val.match(/\$tag\[(\d+)\]/)[1]);
        return article.tags?.[idx] || '';
      }
      return val;
    };

    const findElement = async (selector, ctx) => {
      if (!selector) return null;
      const selectors = selector.split(',').map(s => s.trim()).filter(s => s);
      for (const sel of selectors) {
        try {
          const el = await ctx.waitForSelector(sel, { timeout: 3000 }).catch(() => null);
          if (el) return { el, selector: sel };
        } catch(e) {}
      }
      return null;
    };

    switch (step.type) {
      case 'navigate':
        try {
          await page.goto(step.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch(e) {
          console.log(`[LLMWikiPublisher] Navigate warning: ${e.message.substring(0, 100)}`);
        }
        await page.waitForTimeout(2000);
        this._currentFrame = null;
        return true;

      case 'fill': {
        const value = resolveValue(step.value);
        if (!value) return true;

        const ctx = step.frame && this._currentFrame ? this._currentFrame : page;
        const found = await findElement(step.selector, ctx);
        if (!found) return false;

        // For React-based inputs (toutiao, etc), try fill + keyboard + native setter
        if (step.reactSetter || platform === 'toutiao') {
          // Method 1: Playwright fill
          try {
            await found.el.fill(value);
            await page.waitForTimeout(300);
            const actualVal = await found.el.inputValue().catch(() => '');
            if (actualVal && actualVal.length >= value.length * 0.8) return true;
          } catch(e) {}

          // Method 2: Click + keyboard type
          try {
            await found.el.click();
            await page.waitForTimeout(200);
            await page.keyboard.press('Control+a');
            await page.keyboard.type(value, { delay: 50 });
            await page.waitForTimeout(300);
            return true;
          } catch(e) {}

          // Method 3: Native setter via evaluate
          await page.evaluate(({ sel, val }) => {
            const el = document.querySelector(sel);
            if (!el) return;
            const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
            const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            if (nativeSetter) {
              nativeSetter.call(el, val);
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            } else {
              el.value = val;
              el.dispatchEvent(new Event('input', { bubbles: true }));
            }
          }, { sel: found.selector, val: value });
          await page.waitForTimeout(500);
          return true;
        }

        await found.el.click();
        await page.waitForTimeout(100);
        await found.el.fill(value);
        await page.waitForTimeout(300);
        return true;
      }

      case 'click': {
        const ctx = step.frame && this._currentFrame ? this._currentFrame : page;

        // Handle :has-text selectors via Playwright locator
        if (step.selector && step.selector.includes(':has-text')) {
          const selectors = step.selector.split(',').map(s => s.trim()).filter(s => s);
          for (const sel of selectors) {
            // Method 1: locator click
            try {
              const el = page.locator(sel).first();
              await el.click({ timeout: 5000 });
              await page.waitForTimeout(500);
              if (!step.frame) this._currentFrame = null;
              return true;
            } catch(e) {}
            // Method 2: force click
            try {
              const el = page.locator(sel).first();
              await el.click({ timeout: 3000, force: true });
              await page.waitForTimeout(500);
              if (!step.frame) this._currentFrame = null;
              return true;
            } catch(e) {}
            // Method 3: mouse click via coordinates
            const pos = await page.evaluate((s) => {
              const match = s.match(/:has-text\(["'](.+?)["']\)/);
              if (!match) return { found: false };
              const text = match[1];
              const tagMatch = s.match(/^([a-zA-Z.]+)/);
              const tag = tagMatch ? tagMatch[1] : 'button';
              const els = document.querySelectorAll(tag);
              for (const el of els) {
                if (el.textContent.includes(text)) {
                  const rect = el.getBoundingClientRect();
                  if (rect.width > 20 && rect.height > 10) {
                    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, found: true };
                  }
                }
              }
              return { found: false };
            }, sel);
            if (pos.found) {
              await page.mouse.click(pos.x, pos.y);
              await page.waitForTimeout(500);
              if (!step.frame) this._currentFrame = null;
              return true;
            }
            // Method 4: evaluate DOM click
            try {
              const clicked = await page.evaluate((s) => {
                const match = s.match(/:has-text\(["'](.+?)["']\)/);
                if (!match) return false;
                const text = match[1];
                const tagMatch = s.match(/^([a-zA-Z.]+)/);
                const tag = tagMatch ? tagMatch[1] : 'button';
                const els = document.querySelectorAll(tag);
                for (const el of els) {
                  if (el.textContent.includes(text)) {
                    const rect = el.getBoundingClientRect();
                    if (rect.width > 20 && rect.height > 10) { el.click(); return true; }
                  }
                }
                return false;
              }, sel);
              if (clicked) {
                await page.waitForTimeout(500);
                if (!step.frame) this._currentFrame = null;
                return true;
              }
            } catch(e) {}
          }
          return false;
        }

        const found = await findElement(step.selector, ctx);
        if (!found) return false;
        try {
          await found.el.click({ timeout: 5000 });
        } catch(e) {
          try { await found.el.click({ timeout: 3000, force: true }); }
          catch(e2) {
            const pos = await page.evaluate((sel) => {
              const el = document.querySelector(sel);
              if (!el) return { found: false };
              const rect = el.getBoundingClientRect();
              return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, found: true };
            }, found.selector);
            if (pos.found) {
              await page.mouse.click(pos.x, pos.y);
            } else {
              return false;
            }
          }
        }
        await page.waitForTimeout(500);
        if (!step.frame) this._currentFrame = null;
        return true;
      }

      case 'type': {
        const text = resolveValue(step.text);
        if (!text) return true;

        if (step.frame && this._currentFrame) {
          try { await this._currentFrame.type('body', text, { delay: 0 }); }
          catch(e) { await page.keyboard.type(text, { delay: 0 }); }
        } else {
          const plainText = text
            .replace(/^#{1,6}\s+/gm, '')
            .replace(/\*\*(.+?)\*\*/g, '$1')
            .replace(/\*(.+?)\*/g, '$1')
            .replace(/`(.+?)`/g, '$1')
            .replace(/\[(.+?)\]\(.+?\)/g, '$1')
            .replace(/!\[.*?\]\(.+?\)/g, '')
            .replace(/>\s+/g, '')
            .replace(/---/g, '')
            .replace(/\n{3,}/g, '\n\n');

          // Use Playwright locator pressSequentially — most reliable for ProseMirror in headless mode
          const editorLocator = page.locator('.ProseMirror').first();
          try {
            await editorLocator.click({ timeout: 5000 });
            await page.waitForTimeout(300);
          } catch(e) {
            try {
              await page.locator('[contenteditable="true"]').first().click({ timeout: 3000 });
              await page.waitForTimeout(300);
            } catch(e2) {
              console.log('[LLMWikiPublisher] Could not focus editor');
            }
          }

          const paragraphs = plainText.split('\n\n');
          let totalTyped = 0;
          for (let i = 0; i < paragraphs.length; i++) {
            const para = paragraphs[i].trim();
            if (!para) continue;
            // Use pressSequentially which focuses + types character by character
            try {
              await editorLocator.pressSequentially(para, { delay: 5 });
              totalTyped += para.length;
            } catch(e) {
              // Fallback to keyboard
              await page.keyboard.type(para, { delay: 5 });
              totalTyped += para.length;
            }
            if (i < paragraphs.length - 1) {
              await page.keyboard.press('Enter');
              await page.waitForTimeout(200);
            }
          }
          console.log(`[LLMWikiPublisher] Typed ${totalTyped} chars into editor`);

          // Verify content was actually inserted
          const bodyLen = await page.evaluate(() => {
            const ed = document.querySelector('.ProseMirror');
            return ed ? (ed.textContent || '').length : -1;
          }).catch(() => -1);
          console.log(`[LLMWikiPublisher] Editor text length after typing: ${bodyLen}`);

          if (bodyLen === 0) {
            // Last resort: try execCommand insertText
            console.log('[LLMWikiPublisher] pressSequentially produced empty content, trying execCommand');
            await page.evaluate((content) => {
              const editor = document.querySelector('.ProseMirror');
              if (!editor) return;
              editor.focus();
              const paras = content.split('\n\n');
              for (let i = 0; i < paras.length; i++) {
                if (i > 0) document.execCommand('insertParagraph', false);
                const p = paras[i].trim();
                if (p) document.execCommand('insertText', false, p);
              }
            }, plainText).catch(() => {});
          }
        }
        await page.waitForTimeout(500);
        return true;
      }

      case 'evaluate': {
        // Close byte-drawer overlays
        if (step.script === '$closeDrawer') {
          await page.evaluate(() => {
            document.querySelectorAll('.byte-drawer-mask, .byte-drawer-wrapper').forEach(el => el.remove());
          });
          await page.waitForTimeout(500);
          return true;
        }

        // Unhide hidden title input (CSDN etc.)
        if (step.script === '$unhideTitle') {
          await page.evaluate(() => {
            const input = document.querySelector('input.article-bar__title--i') ||
                          document.querySelector('input[placeholder*="标题"]');
            if (input) {
              input.style.cssText = 'display:block !important; visibility:visible !important; opacity:1 !important; width:600px !important; height:40px !important; position:relative !important;';
            }
          });
          await page.waitForTimeout(500);
          return true;
        }

        // Select all + Delete (clear editor content before typing)
        if (step.script === '$selectAllDelete') {
          await page.keyboard.press('Control+a');
          await page.waitForTimeout(200);
          await page.keyboard.press('Delete');
          await page.waitForTimeout(500);
          return true;
        }

        // Click first stock image (RPA approach: wait + poll + mouse click)
        if (step.script === '$clickFirstImage') {
          // Step 1: Wait for drawer to be visible
          try {
            await page.waitForSelector('.byte-drawer-wrapper', { state: 'visible', timeout: 5000 });
          } catch(e) {
            console.log('[LLMWikiPublisher] Drawer not found, trying anyway');
          }

          // Step 2: Poll for images to load (up to 20 seconds)
          let imagesLoaded = false;
          for (let i = 0; i < 20; i++) {
            await page.waitForTimeout(1000);
            const imgInfo = await page.evaluate(() => {
              const dw = document.querySelector('.byte-drawer-wrapper');
              if (!dw) return { count: 0, firstPos: null };
              let count = 0;
              let firstPos = null;
              // Check img tags
              dw.querySelectorAll('img').forEach(img => {
                if (img.src && img.src.startsWith('data:')) return;
                const r = img.getBoundingClientRect();
                if (r.width > 40 && r.height > 30 && r.top > 30) {
                  count++;
                  if (!firstPos) firstPos = { x: r.x + r.width / 2, y: r.y + r.height / 2, type: 'img' };
                }
              });
              // Check background-image on ALL elements (not just leaf nodes)
              dw.querySelectorAll('div, span, li, a').forEach(d => {
                const bg = window.getComputedStyle(d).getPropertyValue('background-image');
                if (bg && bg !== 'none' && bg.includes('url') && !bg.includes('data:')) {
                  const r = d.getBoundingClientRect();
                  if (r.width > 40 && r.height > 30 && r.top > 30) {
                    // Only count if this element's own bg is the image (not inherited)
                    count++;
                    if (!firstPos) firstPos = { x: r.x + r.width / 2, y: r.y + r.height / 2, type: 'bg' };
                  }
                }
              });
              // Also check for canvas or lazy-loaded images
              dw.querySelectorAll('[class*="image"], [class*="img"], [class*="cover"], [class*="card"]').forEach(el => {
                const r = el.getBoundingClientRect();
                if (r.width > 40 && r.height > 30 && r.top > 30) {
                  // Check if it has a click handler or cursor pointer
                  const cursor = window.getComputedStyle(el).cursor;
                  if (cursor === 'pointer' && !firstPos) {
                    firstPos = { x: r.x + r.width / 2, y: r.y + r.height / 2, type: 'card' };
                    count++;
                  }
                }
              });
              return { count, firstPos };
            });
            if (imgInfo.count > 0) {
              console.log(`[LLMWikiPublisher] Images found: ${imgInfo.count} after ${i + 1}s (type=${imgInfo.firstPos.type})`);
              imagesLoaded = true;
              // Step 3: Mouse click on first image
              await page.mouse.click(imgInfo.firstPos.x, imgInfo.firstPos.y);
              console.log(`[LLMWikiPublisher] Clicked cover image at (${Math.round(imgInfo.firstPos.x)},${Math.round(imgInfo.firstPos.y)}) type=${imgInfo.firstPos.type}`);
              await page.waitForTimeout(1000);
              return true;
            }
          }

          if (!imagesLoaded) {
            console.log('[LLMWikiPublisher] No images loaded, using coordinate fallback');
            // Coordinate fallback: drawer images are in grid starting around (420, 200)
            await page.mouse.click(420, 200);
            await page.waitForTimeout(2000);
            return true;
          }

          return true;
        }

        // Click publish button (预览并发布) via coordinates + mouse click
        if (step.script === '$clickPublishBtn') {
          await page.evaluate(() => {
            document.querySelectorAll('.byte-drawer-mask, .byte-drawer-wrapper').forEach(el => el.remove());
          });

          // Get button position via evaluate, then use Playwright locator + mouse click
          const btnInfo = await page.evaluate(() => {
            const btns = document.querySelectorAll('button, [role="button"], .byte-btn');
            // Exact match "预览并发布"
            for (const btn of btns) {
              const text = (btn.textContent || '').trim().replace(/\u200B/g, '');
              if (text === '预览并发布') {
                const rect = btn.getBoundingClientRect();
                if (rect.width > 30 && rect.height > 15) {
                  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, found: true };
                }
              }
            }
            // Fallback: primary button with "发布" but not "定时"
            for (const btn of btns) {
              if (btn.className.includes('byte-btn-primary')) {
                const text = (btn.textContent || '').trim().replace(/\u200B/g, '');
                if (text.includes('发布') && !text.includes('定时')) {
                  const rect = btn.getBoundingClientRect();
                  if (rect.width > 30 && rect.height > 15) {
                    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, found: true };
                  }
                }
              }
            }
            return { found: false };
          });

          if (!btnInfo.found) {
            console.log('[LLMWikiPublisher] $clickPublishBtn: button not found');
            return false;
          }

          // Method 1: Playwright locator (triggers proper React events)
          try {
            const btn = page.locator('button:has-text("预览并发布")').first();
            await btn.waitFor({ state: 'visible', timeout: 5000 });
            await btn.click({ timeout: 5000 });
            console.log('[LLMWikiPublisher] $clickPublishBtn: clicked via locator');
            await page.waitForTimeout(500);
            return true;
          } catch(e) {}

          // Method 2: Mouse click at coordinates
          await page.mouse.click(btnInfo.x, btnInfo.y);
          console.log(`[LLMWikiPublisher] $clickPublishBtn: mouse click at (${Math.round(btnInfo.x)},${Math.round(btnInfo.y)})`);
          await page.waitForTimeout(500);
          return true;
        }

        // P0融合: 精确点击"免费正版图片"tab（只匹配叶子元素，避免匹配父容器）
        if (step.script === '$clickFreeImageTab') {
          const tabPos = await page.evaluate(() => {
            const dw = document.querySelector('.byte-drawer-wrapper');
            if (!dw) return { found: false, reason: 'no drawer' };
            // 查找所有包含"免费正版图片"文本的元素，选文字最短且是叶子节点的
            const candidates = [];
            const allEls = dw.querySelectorAll('*');
            for (const el of allEls) {
              const txt = (el.textContent || '').trim().replace(/\u200B/g, '');
              if (txt === '免费正版图片' && el.children.length === 0) {
                const r = el.getBoundingClientRect();
                if (r.width > 20 && r.height > 15) {
                  candidates.push({ x: r.x + r.width / 2, y: r.y + r.height / 2, tag: el.tagName });
                }
              }
            }
            if (candidates.length === 0) {
              // 回退：包含文本的最小元素
              for (const el of allEls) {
                const txt = (el.textContent || '').trim().replace(/\u200B/g, '');
                if (txt.includes('免费正版') && txt.length <= 10) {
                  const r = el.getBoundingClientRect();
                  if (r.width > 20 && r.height > 15) {
                    candidates.push({ x: r.x + r.width / 2, y: r.y + r.height / 2, tag: el.tagName });
                    break;
                  }
                }
              }
            }
            return candidates.length > 0 ? { found: true, ...candidates[0] } : { found: false, reason: 'no match' };
          });
          if (tabPos.found) {
            await page.mouse.click(tabPos.x, tabPos.y);
            console.log(`[LLMWikiPublisher] $clickFreeImageTab: clicked at (${Math.round(tabPos.x)},${Math.round(tabPos.y)})`);
            await page.waitForTimeout(1500);
            return true;
          }
          console.log('[LLMWikiPublisher] $clickFreeImageTab: not found, reason:', tabPos.reason);
          return false;
        }

        // P0融合: 在drawer内查找"确定"按钮并点击（force:true）
        if (step.script === '$clickConfirmInDrawer') {
          const btnPos = await page.evaluate(() => {
            const dw = document.querySelector('.byte-drawer-wrapper');
            if (!dw) return { found: false, reason: 'no drawer' };
            const btns = dw.querySelectorAll('button, [role="button"], .byte-btn');
            for (const btn of btns) {
              const txt = (btn.textContent || '').trim().replace(/\u200B/g, '');
              if (txt === '确定' || txt === '完成') {
                const r = btn.getBoundingClientRect();
                if (r.width > 30 && r.height > 20) {
                  return { found: true, x: r.x + r.width / 2, y: r.y + r.height / 2, text: txt };
                }
              }
            }
            // 回退：右下角的主按钮
            const primaryBtns = dw.querySelectorAll('.byte-btn-primary');
            for (const btn of primaryBtns) {
              const r = btn.getBoundingClientRect();
              if (r.width > 30 && r.height > 20) {
                return { found: true, x: r.x + r.width / 2, y: r.y + r.height / 2, text: btn.textContent.trim() };
              }
            }
            return { found: false, reason: 'no confirm btn' };
          });
          if (btnPos.found) {
            await page.mouse.click(btnPos.x, btnPos.y);
            console.log(`[LLMWikiPublisher] $clickConfirmInDrawer: clicked "${btnPos.text}" at (${Math.round(btnPos.x)},${Math.round(btnPos.y)})`);
            return true;
          }
          console.log('[LLMWikiPublisher] $clickConfirmInDrawer: not found');
          return false;
        }

        // P0融合: 直接用成功案例验证过的方案 — button:has-text("发布").last()
        // 参考generate_and_publish_toutiao.js 9/17成功案例
        if (step.script === '$clickConfirmPublish') {
          // Wait a moment for any modal to appear after publish button click
          await page.waitForTimeout(2000);

          // Check for any visible "确定" (Confirm) button in a modal/dialog
          // This handles "作品同步授权" and other confirmation dialogs
          try {
            const confirmBtns = page.locator('button:has-text("确定")');
            const count = await confirmBtns.count();
            for (let i = 0; i < count; i++) {
              const btn = confirmBtns.nth(i);
              const isVisible = await btn.isVisible({ timeout: 1000 }).catch(() => false);
              if (isVisible) {
                const btnText = await btn.textContent().catch(() => '');
                console.log(`[LLMWikiPublisher] $clickConfirmPublish: found visible "确定" button (#${i}, text="${btnText?.trim()}"), clicking`);
                await btn.click({ timeout: 5000 });
                console.log('[LLMWikiPublisher] $clickConfirmPublish: clicked "确定" button');
                await page.waitForTimeout(3000);
                // After confirming, check if there's another modal or the actual publish button
                const anotherConfirm = page.locator('button:has-text("确定"):visible').first();
                const hasAnother = await anotherConfirm.isVisible({ timeout: 2000 }).catch(() => false);
                if (hasAnother) {
                  await anotherConfirm.click({ timeout: 3000 }).catch(() => {});
                  console.log('[LLMWikiPublisher] $clickConfirmPublish: clicked second "确定" button');
                  await page.waitForTimeout(2000);
                }
                return true;
              }
            }
          } catch(e) {
            console.log(`[LLMWikiPublisher] $clickConfirmPublish: confirm button check error: ${e.message?.substring(0, 100)}`);
          }

          // No modal found, try clicking the "发布" button
          try {
            const btn = page.locator('button:has-text("发布")').last();
            await btn.waitFor({ state: 'visible', timeout: 5000 });
            await btn.click({ timeout: 5000 });
            console.log('[LLMWikiPublisher] $clickConfirmPublish: clicked last "发布" button via locator (success case proven)');
            return true;
          } catch(e) {}

          // Fallback: evaluate to find and click any publish/confirm button
          const result = await page.evaluate(() => {
            const btns = document.querySelectorAll('button');
            for (const b of btns) {
              const text = b.textContent.trim().replace(/\u200B/g, '');
              if ((text === '发布' || text === '确认发布' || text === '确定') && !b.disabled) {
                b.click();
                return { found: true, text };
              }
            }
            return { found: false };
          });
          if (result.found) {
            console.log(`[LLMWikiPublisher] $clickConfirmPublish: clicked via evaluate (text="${result.text}")`);
            return true;
          }

          console.log('[LLMWikiPublisher] $clickConfirmPublish: button not found');
          return false;
        }

        // ════════════════════════════════════════════════════════
        // P1融合: 掘金平台特定脚本
        // ════════════════════════════════════════════════════════

        // 掘金: 聚焦CodeMirror编辑器
        if (step.script === '$juejinFocusEditor') {
          await page.evaluate(() => {
            const ed = document.querySelector('.CodeMirror');
            if (ed) { ed.focus(); ed.click(); }
            else {
              const ce = document.querySelector('[contenteditable="true"]');
              if (ce) { ce.focus(); ce.click(); }
            }
          });
          await page.waitForTimeout(500);
          return true;
        }

        // 掘金: 点击顶部"发布"按钮打开发布设置页
        if (step.script === '$juejinClickPublish') {
          await page.evaluate(() => {
            document.querySelectorAll('button').forEach(btn => {
              if (btn.textContent?.trim() === '发布' && btn.offsetParent !== null) btn.click();
            });
          });
          await page.waitForTimeout(2000);
          return true;
        }

        // 掘金: 选择分类(非标准byte-select, 点击form-item打开下拉)
        if (step.script === '$juejinSelectCategory') {
          const catSelected = await page.evaluate(() => {
            const labels = Array.from(document.querySelectorAll('.label, [class*="label"]'));
            const catLabel = labels.find(el => el.textContent?.trim().startsWith('分类'));
            if (!catLabel) return { found: false };
            const field = catLabel.closest('[class*="form-item"], [class*="field"]') || catLabel.parentElement;
            if (!field) return { found: false };
            field.click();
            return { found: true, fieldClass: field.className?.substring(0, 40) };
          });
          console.log('[LLMWikiPublisher] Juejin category:', JSON.stringify(catSelected));
          await page.waitForTimeout(1000);
          if (catSelected.found) {
            await page.evaluate(() => {
              const items = document.querySelectorAll('[class*="byte-select-dropdown"] li, [class*="select-option"], li[role="option"]');
              for (const item of items) {
                const r = item.getBoundingClientRect();
                const t = item.textContent?.trim() || '';
                if (r.width > 30 && r.height > 5 && t.length > 0 && t.length < 20) {
                  item.click();
                  return;
                }
              }
            });
            await page.waitForTimeout(500);
          }
          return catSelected.found;
        }

        // 掘金: 添加标签(输入关键词→选下拉建议)
        if (step.script === '$juejinAddTag') {
          const tag = resolveValue(step.tag) || 'AI';
          await page.mouse.click(752, 273);
          await page.waitForTimeout(500);
          await page.keyboard.type(tag, { delay: 50 });
          await page.waitForTimeout(2000);
          const tagSelected = await page.evaluate(() => {
            const dropdowns = document.querySelectorAll('.byte-select-dropdown:not([style*="display: none"])');
            for (const dd of dropdowns) {
              const items = dd.querySelectorAll('li, [class*="option"], [class*="item"]');
              for (const item of items) {
                const r = item.getBoundingClientRect();
                const t = item.textContent?.trim() || '';
                if (r.width > 30 && r.height > 5 && t.length > 0 && t.length < 20) {
                  item.click();
                  return { selected: true, text: t };
                }
              }
            }
            return { selected: false };
          });
          console.log('[LLMWikiPublisher] Juejin tag:', JSON.stringify(tagSelected));
          await page.waitForTimeout(500);
          return true;
        }

        // 掘金: 填写摘要
        if (step.script === '$juejinFillSummary') {
          const summary = resolveValue(step.summary) || '';
          if (summary) {
            await page.evaluate((text) => {
              const textareas = document.querySelectorAll('textarea');
              for (const ta of textareas) {
                const r = ta.getBoundingClientRect();
                if (r.y > 600 && r.x > 700 && r.width > 100) {
                  ta.focus();
                  ta.value = text;
                  ta.dispatchEvent(new Event('input', { bubbles: true }));
                  ta.dispatchEvent(new Event('change', { bubbles: true }));
                  break;
                }
              }
            }, summary);
          }
          await page.waitForTimeout(500);
          return true;
        }

        // 掘金: 检查确定并发布按钮状态并点击
        if (step.script === '$juejinConfirmPublish') {
          const btnState = await page.evaluate(() => {
            let disabled = true;
            document.querySelectorAll('button').forEach(btn => {
              if (btn.textContent?.trim() === '确定并发布') disabled = btn.disabled;
            });
            return { disabled };
          });
          console.log('[LLMWikiPublisher] Juejin confirm disabled:', btnState.disabled);
          if (!btnState.disabled) {
            await page.evaluate(() => {
              document.querySelectorAll('button').forEach(btn => {
                if (btn.textContent?.trim() === '确定并发布' && !btn.disabled) btn.click();
              });
            });
            await page.waitForTimeout(5000);
            return true;
          }
          // 回退: 尝试点击顶部"发布"按钮
          await page.evaluate(() => {
            document.querySelectorAll('button').forEach(btn => {
              const r = btn.getBoundingClientRect();
              if (btn.textContent?.trim() === '发布' && r.y < 100) btn.click();
            });
          });
          await page.waitForTimeout(3000);
          return true;
        }

        // ════════════════════════════════════════════════════════
        // P1融合: 百家号平台特定脚本
        // ════════════════════════════════════════════════════════

        // 百家号: 设置标题(keyboard方式, FeEditorApp-editor)
        if (step.script === '$baijiahaoSetTitle') {
          const title = resolveValue(step.title);
          if (!title) return false;
          const titleInfo = await page.evaluate(() => {
            const ed = document.querySelector('[class*="FeEditorApp-"][class*="-editor"]');
            if (!ed) return { found: false };
            ed.focus(); ed.click();
            const r = ed.getBoundingClientRect();
            return { found: true, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
          });
          if (titleInfo.found) {
            await page.mouse.click(titleInfo.x, titleInfo.y);
            await page.waitForTimeout(500);
            await page.keyboard.press('Control+a');
            await page.keyboard.press('Delete');
            await page.keyboard.type(title, { delay: 0 });
            await page.waitForTimeout(1000);
            return true;
          }
          return false;
        }

        // 百家号: 设置正文(iframe UEditor)
        if (step.script === '$baijiahaoSetContent') {
          const content = resolveValue(step.content);
          if (!content) return false;
          const iframeEl = await page.$('iframe#ueditor_0');
          if (iframeEl) {
            const frame = await iframeEl.contentFrame();
            await page.waitForTimeout(2000);
            await frame.click('body').catch(() => {});
            await page.waitForTimeout(500);
            const paragraphs = content.split('\n\n').filter(p => p.trim());
            for (const para of paragraphs) {
              await page.keyboard.type(para.trim(), { delay: 0 });
              await page.keyboard.press('Enter');
              await page.waitForTimeout(100);
            }
            return true;
          }
          // 回退: contenteditable
          await page.evaluate((md) => {
            const ce = document.querySelector('[contenteditable="true"]');
            if (ce) { ce.innerHTML = md; }
          }, content);
          return true;
        }

        // 百家号: 封面选择全流程(选择封面→单图radio→免费正版图片→选第一张→确定)
        if (step.script === '$baijiahaoSetCover') {
          await page.evaluate(() => window.scrollTo(0, 1000));
          await page.waitForTimeout(500);

          // 1. 点击"选择封面"
          await page.evaluate(() => {
            const els = document.querySelectorAll('*');
            for (const el of els) {
              if (el.textContent?.trim() === '选择封面') {
                const r = el.getBoundingClientRect();
                if (r.width > 30 && r.height > 10 && r.width < 200) { el.click(); return; }
              }
            }
          });
          await page.waitForTimeout(2000);

          // 2. 点击"单图"radio
          await page.evaluate(() => {
            const els = document.querySelectorAll('[class*="radio"], [class*="cover"], label');
            for (const el of els) {
              if (el.textContent?.trim()?.includes('单图')) { el.click(); return; }
            }
          });
          await page.waitForTimeout(1000);

          // 3. 点击"免费正版图片"tab
          await page.evaluate(() => {
            const els = document.querySelectorAll('[class*="tab"], [role="tab"], span, div');
            for (const el of els) {
              const t = el.textContent?.trim() || '';
              if ((t === '免费正版图片' || t === '免费') && el.children.length <= 1) { el.click(); return; }
            }
          });
          await page.waitForTimeout(2000);

          // 4. 选第一张图片(放宽尺寸: width>40, height>30)
          const imgClicked = await page.evaluate(() => {
            const imgs = Array.from(document.querySelectorAll('img')).filter(img => {
              const r = img.getBoundingClientRect();
              const cs = window.getComputedStyle(img);
              return cs.display !== 'none' && r.width > 40 && r.height > 30 && img.src?.startsWith('http') && r.y > 600;
            });
            if (imgs.length > 0) { imgs[0].click(); return { clicked: true, count: imgs.length }; }
            return { clicked: false };
          });
          console.log('[LLMWikiPublisher] Baijiahao cover image:', JSON.stringify(imgClicked));
          await page.waitForTimeout(2000);

          // 5. 点击"确定"确认封面
          await page.evaluate(() => {
            document.querySelectorAll('button, .cheetah-btn, [role="button"]').forEach(btn => {
              if (btn.textContent?.trim() === '确定' || btn.textContent?.trim() === '确认') {
                const r = btn.getBoundingClientRect();
                if (r.width > 30) btn.click();
              }
            });
          });
          await page.waitForTimeout(2000);
          return true;
        }

        // 百家号: 点击发布+确认对话框
        if (step.script === '$baijiahaoClickPublish') {
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await page.waitForTimeout(500);
          await page.evaluate(() => {
            const btns = document.querySelectorAll('button, .cheetah-btn, [role="button"]');
            for (const btn of btns) {
              if (btn.textContent?.trim() === '发布' && !btn.disabled) { btn.click(); return; }
            }
          });
          await page.waitForTimeout(3000);
          // 确认对话框
          await page.evaluate(() => {
            const btns = document.querySelectorAll('button, .cheetah-btn, [role="button"]');
            for (const btn of btns) {
              const t = btn.textContent?.trim() || '';
              if ((t === '确认' || t === '确定') && !btn.disabled) {
                const r = btn.getBoundingClientRect();
                if (r.y > 200) { btn.click(); return; }
              }
            }
          });
          await page.waitForTimeout(5000);
          return true;
        }

        // ════════════════════════════════════════════════════════
        // P1融合: CSDN平台特定脚本
        // ════════════════════════════════════════════════════════

        // CSDN: 关闭模板弹窗
        if (step.script === '$csdnCloseTemplate') {
          try {
            const cancel = page.locator('button:has-text("取消"), button:has-text("不使用模版")').first();
            if (await cancel.isVisible({ timeout: 2000 }).catch(() => false)) {
              await cancel.click();
              await page.waitForTimeout(500);
            }
          } catch { await page.keyboard.press('Escape'); await page.waitForTimeout(500); }
          return true;
        }

        // CSDN: 设置标题(查找无标题文本)
        if (step.script === '$csdnSetTitle') {
          const title = resolveValue(step.title);
          if (!title) return false;
          const titleSet = await page.evaluate((t) => {
            const all = document.querySelectorAll('*');
            for (const el of all) {
              if (el.children.length === 0 || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                const text = (el.textContent || el.value || '').trim();
                if (text.includes('无标题') || text.includes('Untitled')) {
                  el.focus();
                  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                    if (nativeSetter) nativeSetter.call(el, t);
                    else el.value = t;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    return { found: true, tag: el.tagName };
                  }
                  el.setAttribute('contenteditable', 'true');
                  el.textContent = t;
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  return { found: true, tag: el.tagName };
                }
              }
            }
            return { found: false };
          }, title);
          console.log('[LLMWikiPublisher] CSDN title:', JSON.stringify(titleSet));
          return titleSet.found;
        }

        // CSDN: 设置正文(CodeMirror API)
        if (step.script === '$csdnSetContent') {
          const content = resolveValue(step.content);
          if (!content) return false;
          const contentFilled = await page.evaluate((md) => {
            const w = window;
            if (w.editor?.setValue) { w.editor.setValue(md); return true; }
            if (w.cmEditor?.setValue) { w.cmEditor.setValue(md); return true; }
            const cmEl = document.querySelector('.CodeMirror');
            if (cmEl?.CodeMirror) { cmEl.CodeMirror.setValue(md); return true; }
            const cm6El = document.querySelector('.cm-editor');
            if (cm6El?.cmView) {
              const view = cm6El.cmView.view;
              view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: md } });
              return true;
            }
            // 回退: pre.editor__inner
            const pre = document.querySelector('pre.editor__inner.markdown-highlighting');
            if (pre) {
              pre.focus();
              pre.click();
              return false;
            }
            return false;
          }, content);
          console.log('[LLMWikiPublisher] CSDN content via CodeMirror:', contentFilled);
          if (!contentFilled) {
            // 回退: keyboard方式
            const editor = await page.$('pre.editor__inner.markdown-highlighting, .CodeMirror, [contenteditable="true"]');
            if (editor) {
              await editor.click({ force: true });
              await page.waitForTimeout(500);
              await page.keyboard.press('Control+a');
              await page.waitForTimeout(100);
              await page.keyboard.type(content, { delay: 0 });
              await page.waitForTimeout(2000);
              return true;
            }
          }
          return contentFilled;
        }

        // CSDN: 点击发布文章按钮
        if (step.script === '$csdnClickPublish') {
          try {
            const btn = page.locator('button.btn-publish').first();
            await btn.waitFor({ state: 'visible', timeout: 5000 });
            await btn.click();
          } catch {
            await page.evaluate(() => {
              document.querySelectorAll('button').forEach(btn => {
                if (btn.textContent?.trim()?.includes('发布') && btn.offsetParent) btn.click();
              });
            });
          }
          await page.waitForTimeout(2000);
          return true;
        }

        // CSDN: 添加标签
        if (step.script === '$csdnAddTags') {
          const tags = article.tags || [];
          if (tags.length > 0) {
            try {
              const addTagBtn = page.locator('.modal button:has-text("添加文章标签"), .modal .tag__btn-tag:has-text("添加文章标签")').first();
              if (await addTagBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
                await addTagBtn.click();
                await page.waitForTimeout(500);
              }
            } catch {}
            for (const tag of tags.slice(0, 5)) {
              try {
                const tagInput = page.locator('.modal input[placeholder*="标签"], .modal .tag-input input').first();
                if (await tagInput.isVisible({ timeout: 2000 })) {
                  await tagInput.fill(tag);
                  await page.keyboard.press('Enter');
                  await page.waitForTimeout(500);
                }
              } catch {}
            }
          }
          return true;
        }

        // CSDN: 选择原创radio
        if (step.script === '$csdnSelectOriginal') {
          try {
            const originalRadio = page.locator('.modal label:has-text("原创") input, .modal .radio:has-text("原创") input').first();
            if (await originalRadio.isVisible({ timeout: 1000 })) await originalRadio.click();
          } catch {}
          return true;
        }

        // CSDN: 确认发布(btn-b-red)
        if (step.script === '$csdnConfirmPublish') {
          try {
            const pubBtn = page.locator('.modal button.btn-b-red').first();
            if (await pubBtn.isVisible({ timeout: 3000 })) {
              await pubBtn.click();
              console.log('[LLMWikiPublisher] CSDN: clicked btn-b-red');
            } else {
              await page.evaluate(() => {
                document.querySelectorAll('.modal button, .dialog button').forEach(btn => {
                  if (btn.textContent?.trim() === '发布' && btn.className?.includes('btn-b-red')) btn.click();
                });
              });
            }
          } catch {
            await page.evaluate(() => {
              document.querySelectorAll('.modal button').forEach(btn => {
                if (btn.textContent?.trim() === '发布') btn.click();
              });
            });
          }
          await page.waitForTimeout(5000);
          return true;
        }

        // ════════════════════════════════════════════════════════
        // P1融合: 知乎平台特定脚本
        // ════════════════════════════════════════════════════════

        // 知乎: 发布(PublishPanel-triggerButton → 确认并发布)
        if (step.script === '$zhihuPublish') {
          const btnDisabled = await page.evaluate(() => {
            const btn = document.querySelector('button.PublishPanel-triggerButton') ||
                        Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === '发布');
            return btn ? { found: true, disabled: btn.disabled } : { found: false };
          });
          console.log('[LLMWikiPublisher] Zhihu publish btn:', JSON.stringify(btnDisabled));
          if (!btnDisabled.disabled) {
            await page.evaluate(() => {
              const btn = document.querySelector('button.PublishPanel-triggerButton') ||
                          Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === '发布');
              if (btn) btn.click();
            });
            await page.waitForTimeout(2000);
            // 确认并发布
            await page.evaluate(() => {
              document.querySelectorAll('button').forEach(btn => {
                if (btn.textContent?.trim()?.includes('确认并发布')) btn.click();
              });
            });
            await page.waitForTimeout(5000);
            return true;
          }
          return false;
        }

        // ════════════════════════════════════════════════════════
        // P2迁移: 搜狐号平台特定脚本（基于RPAHandler 5层策略）
        // ════════════════════════════════════════════════════════

        if (step.script === '$sohuhaoCheckLogin') {
          const currentUrl = page.url();
          const title = await page.title();
          // 多重检测：登录页跳转、首页重定向、404页面
          const isLoginRedirect = currentUrl.includes('login') || currentUrl.includes('passport');
          const isHomepageRedirect = (currentUrl === 'https://mp.sohu.com/' || currentUrl === 'https://mp.sohu.com' || currentUrl.endsWith('.sohu.com/')) && !currentUrl.includes('edit');
          const is404 = title.includes('404');
          const isHomepage = title.includes('搜狐号首页') || title === '搜狐号';
          if (isLoginRedirect || isHomepageRedirect || is404 || isHomepage) {
            console.log('[LLMWikiPublisher] Sohuhao: Cookie过期或页面异常，URL:', currentUrl, 'Title:', title);
            return false;
          }
          console.log('[LLMWikiPublisher] Sohuhao: Cookie有效，页面:', title);
          return true;
        }

        if (step.script === '$sohuhaoFillTitle') {
          const title = resolveValue(step.title);
          if (!title) return false;

          const titleResult = await page.evaluate((t) => {
            const selectors = [
              'input[placeholder*="标题"]',
              '#title',
              '.article-title input',
              '.title-input input',
              'input[type="text"]',
              'textarea[placeholder*="标题"]',
            ];
            for (const sel of selectors) {
              const el = document.querySelector(sel);
              if (el) {
                const r = el.getBoundingClientRect();
                if (r.width > 50 && r.height > 10) {
                  const tag = el.tagName;
                  if (tag === 'TEXTAREA' || tag === 'INPUT') {
                    const proto = tag === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
                    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                    if (nativeSetter) nativeSetter.call(el, t);
                    else el.value = t;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                  } else {
                    el.textContent = t;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                  }
                  return { found: true, selector: sel, tag };
                }
              }
            }
            return { found: false };
          }, title);

          if (!titleResult.found) {
            try {
              const firstInput = page.locator('input[type="text"]:visible').first();
              if (await firstInput.isVisible({ timeout: 2000 })) {
                await firstInput.fill(title);
                console.log('[LLMWikiPublisher] Sohuhao title: filled via first visible input');
                return true;
              }
            } catch {}
            console.log('[LLMWikiPublisher] Sohuhao title: no input found');
            return false;
          }

          console.log(`[LLMWikiPublisher] Sohuhao title: filled via ${titleResult.selector}`);
          return true;
        }

        if (step.script === '$sohuhaoFillContent') {
          const content = resolveValue(step.content);
          if (!content) return false;

          // 5层编辑器策略（与RPAHandler一致）
          const editorSelectors = [
            '.editor-content',
            '.ProseMirror',
            '.ql-editor',
            '[contenteditable="true"]',
            'textarea.editor-content, textarea#content',
          ];

          let editorFound = false;
          for (const sel of editorSelectors) {
            try {
              const editor = page.locator(sel).first();
              if (await editor.isVisible({ timeout: 3000 })) {
                await editor.click();
                await page.waitForTimeout(300);
                console.log(`[LLMWikiPublisher] Sohuhao content: using ${sel}`);

                // 检查是否是textarea
                const tagName = await editor.evaluate(el => el.tagName);
                if (tagName === 'TEXTAREA') {
                  await editor.fill(content);
                } else {
                  // Rich text editor: 逐段输入
                  const paragraphs = content.split('\n\n').filter(p => p.trim());
                  for (const para of paragraphs) {
                    await page.keyboard.type(para.trim(), { delay: 0 });
                    await page.keyboard.press('Enter');
                    await page.waitForTimeout(100);
                  }
                }
                editorFound = true;
                break;
              }
            } catch {
              // 继续尝试下一个选择器
            }
          }

          if (!editorFound) {
            console.log('[LLMWikiPublisher] Sohuhao content: no editor found');
            return false;
          }
          return true;
        }

        if (step.script === '$sohuhaoFillTags') {
          const tagsRaw = resolveValue(step.tags) || '';
          const tags = Array.isArray(tagsRaw) ? tagsRaw : String(tagsRaw).split(',').map(t => t.trim()).filter(Boolean);
          if (!tags.length) return true;

          for (const tag of tags.slice(0, 5)) {
            try {
              const tagInput = page.locator('input[placeholder*="标签"], input.tag-input, #tag').first();
              if (await tagInput.isVisible({ timeout: 3000 })) {
                await tagInput.fill(tag);
                await page.keyboard.press('Enter');
                await page.waitForTimeout(500);
                console.log(`[LLMWikiPublisher] Sohuhao tag: added "${tag}"`);
              }
            } catch {
              // 跳过该标签
            }
          }
          return true;
        }

        if (step.script === '$sohuhaoClickPublish') {
          // 点击发布按钮（多策略匹配）
          const publishClicked = await page.evaluate(() => {
            const btns = document.querySelectorAll('button, [role="button"], .publish-btn, [class*="publish"], a.btn');
            for (const btn of btns) {
              const t = (btn.textContent || '').trim();
              const r = btn.getBoundingClientRect();
              if (r.width > 30 && r.height > 20 && !btn.disabled &&
                  (t === '发布' || t === '发布文章' || t === '发文章' || t.includes('发布'))) {
                btn.click();
                return true;
              }
            }
            return false;
          });

          if (!publishClicked) {
            console.log('[LLMWikiPublisher] Sohuhao: publish button not found');
            return false;
          }

          console.log('[LLMWikiPublisher] Sohuhao: publish button clicked');
          await page.waitForTimeout(2000);

          // 处理二次确认对话框
          await page.evaluate(() => {
            const confirmBtns = document.querySelectorAll('button, [role="button"], .confirm-btn, .dialog-btn, .btn-confirm');
            for (const btn of confirmBtns) {
              const t = (btn.textContent || '').trim();
              if ((t === '确认' || t === '确定' || t === '立即发布' || t === '确认发布') && !btn.disabled) {
                btn.click();
                return;
              }
            }
          });
          await page.waitForTimeout(3000);
          return true;
        }

        if (step.script === '$sohuhaoVerifyPublish') {
          const currentUrl = page.url();
          const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 1000));

          // 检查成功模式
          if (currentUrl.includes('/manage/content') || currentUrl.includes('/contentManagement')) {
            console.log('[LLMWikiPublisher] Sohuhao: publish verified via URL:', currentUrl);
            return true;
          }
          if (bodyText.includes('发布成功') || bodyText.includes('提交成功')) {
            console.log('[LLMWikiPublisher] Sohuhao: publish verified via text');
            return true;
          }

          // 提取文章ID
          const postIdMatch = currentUrl.match(/\/(\d{10,})/) || currentUrl.match(/id=([0-9a-f]+)/);
          if (postIdMatch) {
            console.log('[LLMWikiPublisher] Sohuhao: publish verified via post ID:', postIdMatch[1]);
            return true;
          }

          console.log('[LLMWikiPublisher] Sohuhao: publish verification failed, URL:', currentUrl);
          return false;
        }

        // ════════════════════════════════════════════════════════
        // P1融合: 网易号平台特定脚本
        // ════════════════════════════════════════════════════════

        // ════════════════════════════════════════════════════════
        // P2迁移: 网易号 — 从NeteaseRpaHandler迁移的多策略脚本
        // ════════════════════════════════════════════════════════

        if (step.script === '$wangyihaoFillTitle') {
          const title = resolveValue(step.title);
          if (!title) return false;

          // 多策略匹配标题输入框：placeholder > .title-input > #articleTitle > 通用input
          const titleResult = await page.evaluate((t) => {
            const selectors = [
              'input[placeholder*="标题"]',
              '.title-input input',
              '#articleTitle',
              'input[type="text"]',
              'textarea[placeholder*="标题"]',
            ];
            for (const sel of selectors) {
              const el = document.querySelector(sel);
              if (el) {
                const r = el.getBoundingClientRect();
                if (r.width > 50 && r.height > 10) {
                  const tag = el.tagName;
                  if (tag === 'TEXTAREA' || tag === 'INPUT') {
                    const proto = tag === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
                    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                    if (nativeSetter) nativeSetter.call(el, t);
                    else el.value = t;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                  } else {
                    el.textContent = t;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                  }
                  return { found: true, selector: sel, tag };
                }
              }
            }
            return { found: false };
          }, title);

          if (!titleResult.found) {
            try {
              const firstInput = page.locator('input[type="text"]:visible').first();
              if (await firstInput.isVisible({ timeout: 2000 })) {
                await firstInput.fill(title);
                console.log('[LLMWikiPublisher] Wangyihao title: filled via first visible input');
                return true;
              }
            } catch {}
            console.log('[LLMWikiPublisher] Wangyihao title: no input found');
            return false;
          }

          console.log(`[LLMWikiPublisher] Wangyihao title: filled via ${titleResult.selector}`);
          return true;
        }

        if (step.script === '$wangyihaoFillContent') {
          const content = resolveValue(step.content);
          if (!content) return false;

          // 多编辑器策略：editor-content > ProseMirror > ql-editor > contenteditable > textarea
          const editorFound = await page.evaluate(() => {
            const selectors = ['.editor-content', '.ProseMirror', '.ql-editor', '[contenteditable="true"]'];
            for (const sel of selectors) {
              const ed = document.querySelector(sel);
              if (ed) {
                const r = ed.getBoundingClientRect();
                if (r.width > 100 && r.height > 50) {
                  ed.focus();
                  ed.click();
                  return { found: true, selector: sel };
                }
              }
            }
            // textarea fallback
            const ta = document.querySelector('textarea.editor-content, textarea#content');
            if (ta) { ta.focus(); return { found: true, selector: 'textarea' }; }
            return { found: false };
          });

          if (!editorFound.found) {
            console.log('[LLMWikiPublisher] Wangyihao: no editor found');
            return false;
          }

          console.log(`[LLMWikiPublisher] Wangyihao editor: ${editorFound.selector}`);
          await page.waitForTimeout(500);

          // 分段输入内容
          const paragraphs = content.split('\n\n').filter(p => p.trim());
          for (const para of paragraphs) {
            await page.keyboard.type(para.trim(), { delay: 0 });
            await page.keyboard.press('Enter');
            await page.waitForTimeout(100);
          }
          return true;
        }

        if (step.script === '$wangyihaoAddTags') {
          const tags = resolveValue(step.tags);
          if (!tags || !Array.isArray(tags) || tags.length === 0) return true; // 标签可选

          for (const tag of tags.slice(0, 5)) {
            try {
              const tagInput = page.locator('input[placeholder*="标签"], input.tag-input').first();
              if (await tagInput.isVisible({ timeout: 3000 })) {
                await tagInput.fill(tag);
                await page.keyboard.press('Enter');
                await page.waitForTimeout(500);
              }
            } catch {
              // 跳过单个标签失败
            }
          }
          return true;
        }

        if (step.script === '$wangyihaoClickPublish') {
          // 多策略匹配发布按钮
          const publishClicked = await page.evaluate(() => {
            const btns = document.querySelectorAll('button, [role="button"], .publish-btn');
            for (const btn of btns) {
              const t = btn.textContent?.trim() || '';
              const r = btn.getBoundingClientRect();
              if (r.width > 30 && r.height > 20 && (t === '发布' || t === '发布文章') && !btn.disabled) {
                btn.click();
                return { clicked: true, text: t };
              }
            }
            return { clicked: false };
          });
          console.log('[LLMWikiPublisher] Wangyihao publish:', JSON.stringify(publishClicked));
          return publishClicked.clicked;
        }

        if (step.script === '$wangyihaoConfirmDialog') {
          // 处理确认对话框（如果出现）
          await page.evaluate(() => {
            document.querySelectorAll('button, [role="button"], .btn-confirm').forEach(btn => {
              const t = btn.textContent?.trim() || '';
              if ((t === '确认发布' || t === '确认' || t === '确定') && !btn.disabled) {
                const r = btn.getBoundingClientRect();
                if (r.width > 30) btn.click();
              }
            });
          });
          await page.waitForTimeout(1000);
          return true;
        }

        // ════════════════════════════════════════════════════════
        // P1融合: 百度知道/百度百科平台特定脚本
        // ════════════════════════════════════════════════════════

        // ════════════════════════════════════════════════════════
        // P2迁移: 百度知道 — 从BaiduZhidaoRpaHandler迁移的细粒度脚本
        // ════════════════════════════════════════════════════════

        if (step.script === '$baiduZhidaoFillTitle') {
          // 填写问题标题到textarea#title-area
          // 必须用keyboard.type触发Vue表单验证，否则提交按钮不会启用
          const title = resolveValue(step.title);
          if (!title) return false;

          // 先尝试textarea#title-area（探测确认的正确选择器）
          const titleArea = page.locator('textarea#title-area');
          if (await titleArea.isVisible({ timeout: 5000 })) {
            await titleArea.click();
            await page.waitForTimeout(200);
            await page.keyboard.type(title, { delay: 30 });
            console.log('[LLMWikiPublisher] BaiduZhidao title: filled via #title-area');
            return true;
          }

          // 回退策略
          const fallbackSels = [
            'textarea[placeholder*="问题"]',
            'input[placeholder*="问"]',
            '#ask-title-input',
            'textarea[placeholder*="提问"]',
          ];
          for (const sel of fallbackSels) {
            const el = page.locator(sel).first();
            if (await el.isVisible({ timeout: 1000 })) {
              await el.click();
              await page.waitForTimeout(200);
              await page.keyboard.type(title, { delay: 30 });
              console.log(`[LLMWikiPublisher] BaiduZhidao title: filled via ${sel}`);
              return true;
            }
          }

          console.log('[LLMWikiPublisher] BaiduZhidao title: no input found');
          return false;
        }

        if (step.script === '$baiduZhidaoFillDetail') {
          // 填写问题详情到textarea#content-area（选填）
          const content = resolveValue(step.content);
          if (!content) return true; // 选填，无内容也算成功

          const contentArea = page.locator('textarea#content-area');
          if (await contentArea.isVisible({ timeout: 3000 })) {
            await contentArea.click();
            await page.waitForTimeout(200);
            await page.keyboard.type(content, { delay: 20 });
            console.log('[LLMWikiPublisher] BaiduZhidao detail: filled via #content-area');
            return true;
          }

          // 回退
          const fallbackSels = ['textarea[placeholder*="补充"]', 'textarea[placeholder*="详情"]', '#ask-content'];
          for (const sel of fallbackSels) {
            const el = page.locator(sel).first();
            if (await el.isVisible({ timeout: 1000 })) {
              await el.click();
              await page.waitForTimeout(200);
              await page.keyboard.type(content, { delay: 20 });
              console.log(`[LLMWikiPublisher] BaiduZhidao detail: filled via ${sel}`);
              return true;
            }
          }

          console.log('[LLMWikiPublisher] BaiduZhidao detail: no textarea found (skipping, optional)');
          return true;
        }

        if (step.script === '$baiduZhidaoClickSubmit') {
          // 点击提交按钮button#submit-btn
          // 关键：等待disabled class被移除后才点击
          const submitBtn = page.locator('button#submit-btn');

          if (await submitBtn.isVisible({ timeout: 5000 })) {
            // 等待按钮启用（最多5秒）
            for (let i = 0; i < 10; i++) {
              const isDisabled = await submitBtn.evaluate(el =>
                el.disabled || el.classList.contains('disabled')
              );
              if (!isDisabled) break;
              await page.waitForTimeout(500);
            }

            const isDisabled = await submitBtn.evaluate(el =>
              el.disabled || el.classList.contains('disabled')
            );

            if (isDisabled) {
              console.log('[LLMWikiPublisher] BaiduZhidao submit: button still disabled, retrying title input');
              // 重新尝试在标题框中输入触发验证
              const titleArea = page.locator('textarea#title-area');
              if (await titleArea.isVisible()) {
                await titleArea.click();
                await page.keyboard.press('End');
                await page.keyboard.type(' ', { delay: 50 });
                await page.keyboard.press('Backspace');
                await page.waitForTimeout(500);
              }
              // 再检查
              const stillDisabled = await submitBtn.evaluate(el =>
                el.disabled || el.classList.contains('disabled')
              );
              if (stillDisabled) {
                console.log('[LLMWikiPublisher] BaiduZhidao submit: button still disabled after retry');
                return false;
              }
            }

            await submitBtn.click();
            console.log('[LLMWikiPublisher] BaiduZhidao submit: clicked #submit-btn');
            return true;
          }

          // 回退：找任何可见的提交/发布按钮
          const allBtns = await page.evaluate(() => {
            const btns = [...document.querySelectorAll('button, input[type="submit"]')];
            return btns.filter(b => {
              const r = b.getBoundingClientRect();
              const t = (b.textContent || b.value || '').trim();
              const isDisabled = b.disabled || b.classList?.contains('disabled');
              const isDoctor = b.classList?.contains('doctor-submit-btn');
              return r.width > 30 && r.height > 20 && !isDisabled && !isDoctor &&
                     (t === '提交' || t === '发布' || t === '发布问题');
            }).map(b => ({ tag: b.tagName, id: b.id, text: (b.textContent || '').trim(), class: b.className?.substring(0, 60) }));
          });

          if (allBtns.length > 0) {
            await page.click(`button:has-text("${allBtns[0].text}"), input[value="${allBtns[0].text}"]`);
            console.log(`[LLMWikiPublisher] BaiduZhidao submit: clicked fallback "${allBtns[0].text}"`);
            return true;
          }

          console.log('[LLMWikiPublisher] BaiduZhidao submit: no button found');
          return false;
        }

        if (step.script === '$baiduBaikeCreate') {
          const title = resolveValue(step.title);
          const content = resolveValue(step.content);
          // 填词条名
          if (title) {
            await page.evaluate((t) => {
              const input = document.querySelector('input[placeholder*="词条名"]') ||
                            document.querySelector('#lemma-title') || document.querySelector('.lemma-title input');
              if (input) {
                input.focus();
                input.value = t;
                input.dispatchEvent(new Event('input', { bubbles: true }));
              }
            }, title);
            await page.waitForTimeout(500);
          }
          // 填正文
          if (content) {
            await page.evaluate(() => {
              const ed = document.querySelector('[contenteditable="true"]') || document.querySelector('.editor-container');
              if (ed) { ed.focus(); ed.click(); }
            });
            await page.waitForTimeout(500);
            await page.keyboard.type(content, { delay: 0 });
            await page.waitForTimeout(1000);
          }
          // 提交
          await page.evaluate(() => {
            document.querySelectorAll('button, .submit-btn').forEach(btn => {
              if (btn.textContent?.trim() === '提交' && !btn.disabled) btn.click();
            });
          });
          await page.waitForTimeout(5000);
          return true;
        }

        return true;
      }

      case 'waitForSelector': {
        const selector = resolveValue(step.selector);
        if (!selector) return true;
        const state = step.state || 'visible';
        const timeout = step.timeout || 10000;
        try {
          await page.waitForSelector(selector, { state, timeout });
          console.log(`[LLMWikiPublisher] waitForSelector OK: ${selector}`);
          return true;
        } catch(e) {
          console.log(`[LLMWikiPublisher] waitForSelector timeout: ${selector} (${timeout}ms)`);
          return step.skipOnFailure ? true : false;
        }
      }

      case 'verifyValue': {
        const selector = resolveValue(step.selector);
        const minLen = step.minLength || 1;
        if (!selector) return true;
        try {
          const actualVal = await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (!el) return null;
            return el.value || el.textContent || '';
          }, selector);
          if (actualVal !== null && actualVal.length >= minLen) {
            console.log(`[LLMWikiPublisher] verifyValue OK: ${actualVal.length} chars >= ${minLen}`);
            return true;
          }
          console.log(`[LLMWikiPublisher] verifyValue FAIL: ${actualVal?.length || 0} chars < ${minLen}, retrying with keyboard...`);
          // 如果失败且retryWith=keyboard，尝试用键盘重新输入
          if (step.retryWith === 'keyboard') {
            const targetVal = resolveValue(step.retryValue) || '';
            if (targetVal) {
              await page.click(selector);
              await page.waitForTimeout(200);
              await page.keyboard.press('Control+a');
              await page.keyboard.type(targetVal, { delay: 50 });
              await page.waitForTimeout(300);
            }
          }
          return true;
        } catch(e) {
          console.log('[LLMWikiPublisher] verifyValue error:', e.message);
          return step.skipOnFailure ? true : false;
        }
      }

      case 'clickText': {
        const text = resolveValue(step.text);
        if (!text) return false;

        // Method 1: Playwright locator
        try {
          await page.locator(`text="${text}"`).first().click({ timeout: 5000 });
          await page.waitForTimeout(1000);
          return true;
        } catch(e) {}

        // Method 2: locator with force
        try {
          await page.locator(`text="${text}"`).first().click({ timeout: 3000, force: true });
          await page.waitForTimeout(1000);
          return true;
        } catch(e) {}

        // Method 3: find position via evaluate, then mouse click
        const pos = await page.evaluate((t) => {
          const els = document.querySelectorAll('div, span, li, a, button');
          for (const el of els) {
            if (el.children.length > 2) continue;
            const elText = el.textContent.trim().replace(/\u200B/g, '');
            if (elText.includes(t) && elText.length < 20) {
              const rect = el.getBoundingClientRect();
              if (rect.width > 30 && rect.height > 10) {
                return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, found: true };
              }
            }
          }
          return { found: false };
        }, text);

        if (pos.found) {
          await page.mouse.click(pos.x, pos.y);
          await page.waitForTimeout(1000);
          return true;
        }

        // Method 4: evaluate DOM click
        await page.evaluate((t) => {
          const els = document.querySelectorAll('div, span, li, a, button');
          for (const el of els) {
            if (el.children.length > 2) continue;
            const elText = el.textContent.trim().replace(/\u200B/g, '');
            if (elText.includes(t) && elText.length < 20) {
              const rect = el.getBoundingClientRect();
              if (rect.width > 30 && rect.height > 10) { el.click(); return; }
            }
          }
        }, text);
        await page.waitForTimeout(1000);
        return true;
      }

      case 'wait':
        await page.waitForTimeout(step.duration || 2000);
        return true;

      case 'screenshot':
        try { await page.screenshot({ path: step.path || `llmwiki_${platform}_step.png` }); } catch(e) {}
        return true;

      default:
        console.log(`[LLMWikiPublisher] Unknown step type: ${step.type}, skipping`);
        return true;
    }
  }

  async tryFallbackSelectors(page, step, fallbackSelectors) {
    const primaries = step.selector.split(',').map(s => s.trim());
    for (const primary of primaries) {
      const fallbacks = fallbackSelectors[primary] || fallbackSelectors[step.selector] || [];
      for (const fallback of fallbacks) {
        try {
          const el = await page.waitForSelector(fallback, { timeout: 2000 }).catch(() => null);
          if (el) { step.selector = fallback; return true; }
        } catch(e) {}
      }
    }
    return false;
  }

  async verifyPublish(page, platform, platformKnowledge) {
    const url = page.url();

    // 优先检查知识库中定义的平台特定成功模式
    if (platformKnowledge?.successPatterns) {
      for (const sp of platformKnowledge.successPatterns) {
        if (!sp.pattern) continue;
        // 判断是URL模式还是文本模式
        if (sp.pattern.startsWith('/') || sp.pattern.includes('http') || sp.pattern.includes('.com') || sp.description?.includes('URL')) {
          // URL模式
          if (url.includes(sp.pattern)) {
            console.log(`[LLMWikiPublisher] URL success pattern matched: ${sp.pattern}`);
            return true;
          }
        } else {
          // 文本模式 - 在页面内容中查找
          try {
            const found = await page.evaluate((pattern) => {
              return document.body?.textContent?.includes(pattern) || false;
            }, sp.pattern);
            if (found) {
              console.log(`[LLMWikiPublisher] Text success pattern matched: ${sp.pattern}`);
              return true;
            }
          } catch(e) {}
        }
      }
    }

    // 通用URL成功模式
    const urlPatterns = ['/post/', '/article/', '/p/', '/entry/', '/success/', '/published', 'status=success', '/detail/', 'article_id', '/graphic/articles', '/content/articles', '/manage/articles', '/manage/content', '/question/', '/item/'];
    for (const pattern of urlPatterns) {
      if (url.includes(pattern)) return true;
    }
    // 通用成功文本
    const successTexts = ['发布成功', '已发布', '发表成功', '成功发布', '提交成功', '保存成功', '发布中', '审核中', '待审核', '已提交', '发布完成', '创建成功', '提问成功', '词条创建成功'];
    try {
      const hasSuccess = await page.evaluate((texts) => {
        const bodyText = document.body?.textContent || '';
        return texts.some(t => bodyText.includes(t));
      }, successTexts);
      if (hasSuccess) return true;
    } catch(e) {}
    const errorTexts = ['发布失败', '发布异常', '参数错误', '请登录', '登录页', '请完成封面', '保存失败'];
    try {
      const hasError = await page.evaluate((texts) => {
        const bodyText = document.body?.textContent || '';
        return texts.some(t => bodyText.includes(t));
      }, errorTexts);
      if (hasError) return false;
    } catch(e) {}
    // 如果URL离开了编辑页，也认为可能成功
    const writeUrl = platformKnowledge.writeUrl || '';
    if (writeUrl && !url.includes('publish') && !url.includes('edit') && !url.includes('write') && !url.includes('create') && !url.includes('new')) return true;
    return false;
  }

  async checkToutiaoLogin(page) {
    const url = page.url();
    if (url.includes('login') || url.includes('sso') || url.includes('passport')) {
      return { loggedIn: false, reason: `redirected to login page: ${url.substring(0, 80)}` };
    }
    try {
      const resp = await page.evaluate(async () => {
        try {
          const r = await fetch('https://mp.toutiao.com/mp/agw/user/login_check', {
            credentials: 'include',
          });
          return await r.text();
        } catch(e) {
          return `fetch_error: ${e.message}`;
        }
      });
      const data = JSON.parse(resp);
      if (data?.data?.is_login === false) {
        return { loggedIn: false, reason: 'login_check API returned is_login:false (cookies expired)' };
      }
      if (data?.data?.is_login === true) {
        return { loggedIn: true, reason: 'ok' };
      }
      return { loggedIn: true, reason: `unknown response: ${resp.substring(0, 100)}` };
    } catch(e) {
      console.log(`[LLMWikiPublisher] Toutiao login check error: ${e.message?.substring(0, 100)}`);
      return { loggedIn: true, reason: `check skipped (${e.message?.substring(0, 60)})` };
    }
  }
}

module.exports = { LLMWikiPublisher };
