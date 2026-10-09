import { SimpleRpaHandler } from './base.js';

/**
 * Sohu (搜狐号) RPA handler - publishes articles via browser automation.
 * Requires cookie-based authentication (SUV, IPLOC, sct, etc.)
 *
 * Publishing flow:
 * 1. Navigate to https://mp.sohu.com/mpfe/static/main/edit.html
 * 2. Fill in title
 * 3. Fill in content (rich text editor)
 * 4. Add tags if available
 * 5. Click publish button
 * 6. Handle confirmation dialog
 * 7. Extract the published article URL
 */
export class SohuRpaHandler extends SimpleRpaHandler {
  protected readonly cookieDomain = '.sohu.com';
  protected readonly titleSelectors = ['input[placeholder*="标题"]', '.article-title input'];
  protected readonly contentEditorSelectors = ['.editor-content'];
  protected readonly platformDisplayName = 'Sohu';

  constructor() {
    super('sohu');
  }
}
