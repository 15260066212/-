import { type Article, type PlatformCredentials, type PlatformId, getPlatformLLMWikiName } from '@zemingengine/shared';
import type { Page } from 'playwright';
import type { PublishResult } from '../types.js';
import { RpaHandler } from './base.js';

/**
 * LLMWiki-powered RPA fallback handler.
 *
 * When the platform-specific RPA handler fails, this handler steps in
 * using the LLMWiki knowledge base to execute the publishing flow.
 * This provides automatic self-healing and platform-change resilience.
 *
 * Usage: This is NOT registered as a primary handler. RPAEngine uses it
 * internally as a fallback when the primary handler fails.
 */
export class LLMWikiHandler extends RpaHandler {
  private llmwikiPublisher: any = null;
  private initPromise: Promise<any> | null = null;

  constructor() {
    // Use a placeholder platform — this handler is not registered per-platform
    super('csdn' as PlatformId);
  }

  /**
   * Check if LLMWiki has knowledge for a given platform.
   */
  supportsPlatform(platform: PlatformId): boolean {
    return !!getPlatformLLMWikiName(platform);
  }

  /**
   * Lazily initialize the LLMWiki publisher.
   * Only loads when actually needed (first fallback).
   */
  private async getPublisher(): Promise<any> {
    if (this.llmwikiPublisher) return this.llmwikiPublisher;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.doInit();
    this.llmwikiPublisher = await this.initPromise;
    this.initPromise = null;
    return this.llmwikiPublisher;
  }

  private async doInit(): Promise<any> {
    try {
      // Try to load LLMWiki from project root
      // In production, the path is relative to the built dist/ folder
      const path = require('path');
      const possiblePaths = [
        path.resolve(process.cwd(), 'llmwiki_publisher.js'),
        path.resolve(process.cwd(), '..', 'llmwiki_publisher.js'),
        path.resolve(process.cwd(), '..', '..', 'llmwiki_publisher.js'),
        '/home/ubuntu/geo-assistant-clean/llmwiki_publisher.js',
      ];

      let publisherClass: any = null;
      for (const p of possiblePaths) {
        try {
          if (require.resolve && require.resolve(p)) {
            const mod = require(p);
            publisherClass = mod.LLMWikiPublisher;
            console.log(`[LLMWikiHandler] Loaded from: ${p}`);
            break;
          }
        } catch {
          // try next path
        }
      }

      if (!publisherClass) {
        // Last resort: try to require by name (if in node_modules)
        try {
          const mod = require('llmwiki-publisher');
          publisherClass = mod.LLMWikiPublisher;
        } catch {
          throw new Error('LLMWikiPublisher module not found in any known path');
        }
      }

      const publisher = new publisherClass();
      console.log('[LLMWikiHandler] Initialized successfully');
      return publisher;
    } catch (e) {
      console.error('[LLMWikiHandler] Failed to initialize:', e instanceof Error ? e.message : String(e));
      throw e;
    }
  }

  /**
   * Publish using LLMWiki knowledge base.
   *
   * @param page - Playwright Page with cookies already injected
   * @param article - Article to publish (main system format)
   * @param credentials - Platform credentials (used for platform name mapping)
   */
  async publish(
    page: Page,
    article: Article,
    _credentials: PlatformCredentials,
  ): Promise<PublishResult> {
    const platform = article.platform;
    const llmwikiPlatform = getPlatformLLMWikiName(platform);

    if (!llmwikiPlatform) {
      return {
        success: false,
        error: `No LLMWiki mapping for platform: ${platform}`,
      };
    }

    try {
      const publisher = await this.getPublisher();

      // Convert Article to LLMWiki article format
      const llmwikiArticle = {
        title: article.title,
        content: article.contentMarkdown || article.contentPlain || '',
        tags: article.tags || [],
        summary: article.summary || '',
      };

      console.log(`[LLMWikiHandler] Fallback publishing to ${platform} (llmwiki: ${llmwikiPlatform})`);

      // Execute LLMWiki publish on the existing page
      // (cookies are already injected by RPAEngine)
      const result = await publisher.publish(page, llmwikiPlatform, llmwikiArticle);

      // Convert LLMWiki result to PublishResult
      return this.convertResult(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[LLMWikiHandler] Fallback publish failed for ${platform}:`, message);
      return {
        success: false,
        error: `LLMWiki fallback failed: ${message}`,
      };
    }
  }

  /**
   * Convert LLMWiki publish result to standard PublishResult format.
   */
  private convertResult(llmwikiResult: any): PublishResult {
    if (!llmwikiResult) {
      return { success: false, error: 'Empty result from LLMWiki' };
    }

    const result: PublishResult = {
      success: !!llmwikiResult.success,
    };

    if (llmwikiResult.url || llmwikiResult.postUrl) {
      result.postUrl = llmwikiResult.url || llmwikiResult.postUrl;
    }

    if (llmwikiResult.postId || llmwikiResult.articleId) {
      result.postId = llmwikiResult.postId || llmwikiResult.articleId;
    }

    if (llmwikiResult.error) {
      result.error = llmwikiResult.error;
    }

    // Determine verification status
    if (llmwikiResult.success) {
      if (result.postUrl) {
        result.verificationStatus = 'verified';
        result.verificationMessage = 'Published via LLMWiki fallback (URL confirmed)';
      } else {
        result.verificationStatus = 'unverified';
        result.verificationMessage = 'Published via LLMWiki fallback (no post URL returned)';
      }
    }

    return result;
  }
}
