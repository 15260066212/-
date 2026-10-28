import type { Article, PlatformCredentials } from '@zemingengine/shared';
import type { PublishResult } from '../types.js';

/**
 * LLMWiki Fallback Publisher
 *
 * Provides LLMWiki-based self-healing fallback when regular RPA publishing fails.
 * This is a stub implementation — the full feature uses the LLMWiki platform
 * as an alternative publishing channel when the primary platform has issues.
 */
export class LLMWikiFallback {
  private enabled: boolean;

  constructor(enabled: boolean = false) {
    this.enabled = enabled;
  }

  /**
   * Enable or disable the LLMWiki fallback at runtime.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Check if LLMWiki fallback can be used for the given platform.
   * Returns true only when fallback is enabled AND the platform is supported.
   */
  canUseLLMWikiFallback(platform: string): boolean {
    if (!this.enabled) return false;
    // Only support platforms where LLMWiki has a compatible publishing path
    const supportedPlatforms = ['csdn', 'jianshu', 'zhihu'];
    return supportedPlatforms.includes(platform);
  }

  /**
   * Attempt to publish via LLMWiki as a fallback channel.
   * Returns a PublishResult on success, or throws on failure.
   *
   * Note: This is a stub. The real implementation would:
   * 1. Acquire an LLMWiki browser session
   * 2. Publish the article through the LLMWiki interface
   * 3. Return the published URL and status
   */
  async tryFallback(
    article: Article,
    credentials: PlatformCredentials,
    accountId: string,
  ): Promise<PublishResult> {
    if (!this.enabled) {
      throw new Error('LLMWiki fallback is not enabled');
    }

    // Stub: always fail so callers fall through to the original error.
    // Replace with actual LLMWiki publishing logic when the feature is implemented.
    throw new Error('LLMWiki fallback not implemented yet');
  }
}
