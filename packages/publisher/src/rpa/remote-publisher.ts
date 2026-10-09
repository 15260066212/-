import { type Article, type PlatformCredentials, type PlatformId, getPlatformLLMWikiName } from '@zemingengine/shared';
import type { PublishResult } from '../types.js';

/**
 * Remote RPA publisher that delegates publishing to a remote harvester service over HTTP.
 *
 * When RPA_REMOTE_URL is set, publish calls are delegated to the
 * harvester service instead of launching a local Playwright browser.
 * This is used in Docker deployments where the geo-app container
 * does not have Playwright browsers installed, but the harvester container does.
 */
export class RemotePublisher {
  /**
   * Whether remote RPA execution is enabled via the RPA_REMOTE_URL env var.
   */
  isRemoteMode(): boolean {
    return !!process.env.RPA_REMOTE_URL;
  }

  /**
   * Delegate RPA publishing to the LLMWiki pipeline service over HTTP.
   * Calls POST /api/llmwiki/publish on the service specified by RPA_REMOTE_URL.
   */
  async remotePublish(
    platform: PlatformId,
    article: Article,
    credentials: PlatformCredentials,
  ): Promise<PublishResult> {
    const baseUrl = process.env.RPA_REMOTE_URL;
    if (!baseUrl) {
      return { success: false, error: 'RPA_REMOTE_URL is not configured' };
    }

    const llmwikiPlatform = getPlatformLLMWikiName(platform) ?? platform;
    const url = `${baseUrl.replace(/\/+$/, '')}/api/llmwiki/publish`;
    console.log(`[RemotePublisher] Remote publishing to ${platform} (llmwiki: ${llmwikiPlatform}) via ${url}`, {
      articleId: article.id,
      title: article.title,
    });

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: llmwikiPlatform, article, credentials }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return {
          success: false,
          error: `LLMWiki /api/llmwiki/publish returned HTTP ${res.status}: ${text}`,
        };
      }

      const data = (await res.json()) as Partial<PublishResult>;
      return {
        success: !!data.success,
        postId: data.postId,
        postUrl: data.postUrl,
        error: data.error,
        verificationStatus: data.verificationStatus,
        verificationMessage: data.verificationMessage,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[RemotePublisher] Remote publish error for ${platform}:`, message);
      return { success: false, error: `Remote publish failed: ${message}` };
    }
  }
}
