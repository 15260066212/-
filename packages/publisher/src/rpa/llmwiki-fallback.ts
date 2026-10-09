import type { Article, PlatformCredentials, PlatformId } from '@zemingengine/shared';
import type { Page } from 'playwright';
import type { PublishResult } from '../types.js';
import { LLMWikiHandler } from '../rpa-handlers/llmwiki-handler.js';

/**
 * LLMWiki fallback publisher.
 *
 * When the primary RPA handler fails, this module attempts to publish
 * using the LLMWiki knowledge base as a fallback. This provides
 * automatic self-healing and platform-change resilience.
 */
export class LLMWikiFallback {
  private llmwikiHandler: LLMWikiHandler | null = null;
  private fallbackEnabled: boolean;

  constructor(enabled: boolean = true) {
    this.fallbackEnabled = enabled;
  }

  /**
   * Enable or disable LLMWiki fallback at runtime.
   */
  setEnabled(enabled: boolean): void {
    this.fallbackEnabled = enabled;
    console.log(`[LLMWikiFallback] LLMWiki fallback: ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Check if LLMWiki fallback should be attempted for a given platform.
   * Lazily initializes the LLMWikiHandler on first check.
   */
  canUseLLMWikiFallback(platform: PlatformId): boolean {
    if (!this.fallbackEnabled) return false;
    // Lazy init the handler on first check
    if (!this.llmwikiHandler) {
      const handler = this.findLLMWikiModule();
      if (!handler) {
        this.fallbackEnabled = false;
        return false;
      }
      this.llmwikiHandler = handler;
    }
    return this.llmwikiHandler.supportsPlatform(platform);
  }

  /**
   * Find and initialize the LLMWiki module (LLMWikiHandler).
   * Returns null if initialization fails.
   */
  private findLLMWikiModule(): LLMWikiHandler | null {
    try {
      return new LLMWikiHandler();
    } catch (e) {
      console.warn('[LLMWikiFallback] Failed to init LLMWikiHandler, fallback disabled:',
        e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  /**
   * Try publishing via LLMWiki fallback.
   * Called when the primary RPA handler fails.
   */
  async tryLLMWikiFallback(
    page: Page,
    platform: PlatformId,
    article: Article,
    credentials: PlatformCredentials,
    originalError: string,
  ): Promise<PublishResult | null> {
    if (!this.canUseLLMWikiFallback(platform) || !this.llmwikiHandler) {
      return null;
    }

    console.log(`[LLMWikiFallback] Primary handler failed for ${platform}, trying LLMWiki fallback...`);
    console.log(`[LLMWikiFallback] Original error: ${originalError.substring(0, 200)}`);

    try {
      const fallbackResult = await this.llmwikiHandler.publish(page, article, credentials);

      if (fallbackResult.success) {
        console.log(`[LLMWikiFallback] LLMWiki fallback succeeded for ${platform}!`);
        return {
          ...fallbackResult,
          verificationMessage: fallbackResult.verificationMessage
            ? `${fallbackResult.verificationMessage} (via LLMWiki fallback)`
            : 'Published via LLMWiki fallback',
        };
      } else {
        console.warn(`[LLMWikiFallback] LLMWiki fallback also failed for ${platform}: ${fallbackResult.error}`);
        return null;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[LLMWikiFallback] LLMWiki fallback error for ${platform}:`, msg);
      return null;
    }
  }
}
