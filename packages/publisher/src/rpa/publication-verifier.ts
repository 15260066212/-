import type { PlatformId } from '@zemingengine/shared';
import type { Page } from 'playwright';
import { EngineTimeout } from '../constants.js';

export type VerificationStatus = 'verified' | 'unverified' | 'failed';

export interface VerificationResult {
  status: VerificationStatus;
  message: string;
}

/**
 * Post-publish publication verifier.
 *
 * Responsible for verifying that a published article is actually live
 * by navigating to its URL and checking for error indicators.
 */
export class PublicationVerifier {
  /**
   * Verify that a published article is actually live by navigating to its URL.
   */
  async verifyPublication(
    page: Page,
    postUrl: string,
    platform: PlatformId,
  ): Promise<VerificationResult> {
    try {
      await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: EngineTimeout.VERIFY_NAVIGATION_MS });
      const currentUrl = page.url();

      if (currentUrl.includes('404') || currentUrl.includes('error') || currentUrl.includes('notfound')) {
        return { status: 'failed', message: `URL contains error indicator: ${currentUrl}` };
      }

      const bodyText = await page.locator('body').textContent({ timeout: EngineTimeout.VERIFY_READ_MS });
      if (!bodyText) return { status: 'failed', message: 'Page body is empty' };

      const errorIndicators = [
        '页面不存在',
        '内容已删除',
        '内容已被删除',
        '文章不存在',
        'Page not found',
        'Access denied',
      ];

      for (const indicator of errorIndicators) {
        if (bodyText.includes(indicator)) {
          return { status: 'failed', message: `Page contains error indicator: ${indicator}` };
        }
      }

      console.log(`[PublicationVerifier] Post-publish verification passed for ${platform}: ${postUrl}`);
      return { status: 'verified', message: 'Article is live and accessible' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[PublicationVerifier] Verification error for ${platform}: ${message}`);
      return { status: 'unverified', message: `Verification error: ${message}` };
    }
  }
}
