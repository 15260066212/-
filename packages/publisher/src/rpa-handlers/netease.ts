import { SimpleRpaHandler } from './base.js';

/**
 * NetEase (网易号) RPA handler - publishes articles via browser automation.
 * Requires cookie-based authentication (P_INFO, S_INFO, NTES_SESS, etc.)
 *
 * Publishing flow:
 * 1. Navigate to https://mp.163.com/editor/article.html
 * 2. Fill in title
 * 3. Fill in content (rich text editor)
 * 4. Add tags if available
 * 5. Click publish button
 * 6. Handle confirmation dialog
 * 7. Extract the published article URL
 */
export class NeteaseRpaHandler extends SimpleRpaHandler {
  protected readonly cookieDomain = '.163.com';
  protected readonly titleSelectors = ['input[placeholder*="标题"]', '.title-input input'];
  protected readonly contentEditorSelectors = ['.editor-content'];
  protected readonly platformDisplayName = 'NetEase';

  constructor() {
    super('netease');
  }
}
