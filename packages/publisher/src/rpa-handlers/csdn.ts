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
}
