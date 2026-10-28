import { PlatformAdapter } from './base.js';
import type { VerificationResult } from './base.js';
import type { PublishParams, PublishResult } from '../types.js';
import { markdownToHtml } from '../utils/markdown.js';
import type { Article, PlatformCredentials } from '@zemingengine/shared';

interface AccessTokenCache {
  token: string;
  expiresAt: number;
}

export class WechatAdapter extends PlatformAdapter {
  private tokenCache: AccessTokenCache | null = null;

  constructor() {
    super('weixin');
  }

  getMethod(): 'api' | 'rpa' {
    return 'api';
  }

  /**
   * Save the article as a draft on WeChat (draft/add API) WITHOUT submitting
   * it for publication. The returned media_id is the platform draft id; the
   * article will remain in the 草稿箱 until the user manually publishes it
   * on the WeChat MP platform.
   */
  async saveDraft(params: PublishParams): Promise<PublishResult> {
    const { article, credentials } = params;

    const appId = credentials.data.appId || credentials.data.app_id || '';
    const appSecret = credentials.data.appSecret || credentials.data.app_secret || '';

    if (!appId || !appSecret) {
      return { success: false, error: 'Missing appId or appSecret in WeChat credentials' };
    }

    try {
      const accessToken = await this.getAccessToken(appId, appSecret);
      const mediaId = await this.createDraft(accessToken, article);

      return {
        success: true,
        postId: mediaId,
        postUrl: `https://mp.weixin.qq.com`,
        verificationStatus: 'draft_saved',
        verificationMessage: 'Article saved to WeChat draft box. Manual publication required.',
        draftSaved: true,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown WeChat draft API error',
      };
    }
  }

  async publish(params: PublishParams): Promise<PublishResult> {
    const { article, credentials } = params;

    // Extract appId and appSecret from credentials
    const appId = credentials.data.appId || credentials.data.app_id || '';
    const appSecret = credentials.data.appSecret || credentials.data.app_secret || '';

    if (!appId || !appSecret) {
      return { success: false, error: 'Missing appId or appSecret in WeChat credentials' };
    }

    try {
      // Step 1: Get access_token
      const accessToken = await this.getAccessToken(appId, appSecret);

      // Step 2: Create draft
      const mediaId = await this.createDraft(accessToken, article);

      // Step 3: Publish
      const publishId = await this.submitPublish(accessToken, mediaId);

      // Step 4: Check publish status (with retries)
      const status = await this.checkPublishStatus(accessToken, publishId);

      if (status === 0) {
        // Post-publish verification: check if the article is readable via WeChat API
        const verification = await this.verifyPublication(accessToken, mediaId);
        return {
          success: true,
          postId: publishId,
          postUrl: `https://mp.weixin.qq.com`,
          verificationStatus: verification.verificationStatus,
          verificationMessage: verification.verificationMessage,
        };
      } else if (status === 1) {
        // Still publishing - treat as success (async), but skip article verification
        // since the article may not be fully published yet
        return {
          success: true,
          postId: publishId,
          postUrl: `https://mp.weixin.qq.com`,
          verificationStatus: 'unverified',
          verificationMessage: 'Article is still publishing, verification skipped',
        };
      } else {
        const statusMessages: Record<number, string> = {
          2: '原创校验失败',
          3: '常规发布失败',
          4: '审核中',
        };
        return {
          success: false,
          error: `WeChat publish failed: ${statusMessages[status] || `status ${status}`}`,
        };
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown WeChat API error',
      };
    }
  }

  private async getAccessToken(appId: string, appSecret: string): Promise<string> {
    // Check cache
    if (this.tokenCache && Date.now() < this.tokenCache.expiresAt) {
      return this.tokenCache.token;
    }

    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`;
    const res = await fetch(url);
    const data = await res.json() as { access_token?: string; expires_in?: number; errcode?: number; errmsg?: string };

    if (data.errcode) {
      throw new Error(`WeChat token error (${data.errcode}): ${data.errmsg}`);
    }

    if (!data.access_token) {
      throw new Error('Failed to get WeChat access_token');
    }

    // Cache token with 5 minute buffer before expiry
    this.tokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + ((data.expires_in ?? 7200) - 300) * 1000,
    };

    return data.access_token;
  }

  private async createDraft(accessToken: string, article: Article): Promise<string> {
    // Convert Markdown to basic HTML if contentHtml is not available
    const htmlContent = article.contentHtml || markdownToHtml(article.contentMarkdown);

    const body = {
      articles: [
        {
          title: article.title,
          author: '', // Can be customized
          digest: article.summary || article.title,
          content: htmlContent,
          content_source_url: '',
          need_open_comment: 0,
          only_fans_can_comment: 0,
        },
      ],
    };

    const url = `https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${encodeURIComponent(accessToken)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json() as { media_id?: string; errcode?: number; errmsg?: string };

    if (data.errcode) {
      throw new Error(`WeChat draft error (${data.errcode}): ${data.errmsg}`);
    }

    if (!data.media_id) {
      throw new Error('Failed to create WeChat draft: no media_id returned');
    }

    return data.media_id;
  }

  private async submitPublish(accessToken: string, mediaId: string): Promise<string> {
    const url = `https://api.weixin.qq.com/cgi-bin/freepublish/submit?access_token=${encodeURIComponent(accessToken)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ media_id: mediaId }),
    });
    const data = await res.json() as { publish_id?: string; errcode?: number; errmsg?: string };

    if (data.errcode) {
      throw new Error(`WeChat publish error (${data.errcode}): ${data.errmsg}`);
    }

    if (!data.publish_id) {
      throw new Error('Failed to submit WeChat publish: no publish_id returned');
    }

    return data.publish_id;
  }

  private async checkPublishStatus(accessToken: string, publishId: string): Promise<number> {
    const url = `https://api.weixin.qq.com/cgi-bin/freepublish/get?access_token=${encodeURIComponent(accessToken)}`;

    // Poll up to 3 times with 2-second intervals
    for (let i = 0; i < 3; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000));

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publish_id: publishId }),
      });
      const data = await res.json() as { publish_status?: number; errcode?: number; errmsg?: string };

      if (data.errcode) {
        // If error checking status, assume it's still processing
        continue;
      }

      if (data.publish_status !== undefined) {
        return data.publish_status;
      }
    }

    // If we can't determine status after 3 attempts, assume publishing (treat as success)
    return 1;
  }

  /**
   * Verify that a published article is readable via the WeChat API.
   * Calls freepublish/getarticle to check if the article content is accessible.
   *
   * If verification fails (e.g. API error), the status is set to 'failed' or
   * 'unverified' but this does NOT affect the publish success status — the
   * article was already successfully published, we only record the verification
   * result.
   *
   * @param accessToken - WeChat API access token
   * @param mediaId - The media_id of the published article (from draft/add)
   * @returns Verification result with status and message
   */
  async verifyPublication(accessToken: string, mediaId: string): Promise<VerificationResult> {
    try {
      const url = `https://api.weixin.qq.com/cgi-bin/freepublish/getarticle?access_token=${encodeURIComponent(accessToken)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ media_id: mediaId }),
      });
      const data = await res.json() as {
        news_item?: unknown[];
        errcode?: number;
        errmsg?: string;
      };

      if (data.errcode) {
        return {
          verificationStatus: 'failed',
          verificationMessage: `WeChat verification failed (${data.errcode}): ${data.errmsg ?? 'unknown error'}`,
        };
      }

      if (data.news_item && Array.isArray(data.news_item) && data.news_item.length > 0) {
        return {
          verificationStatus: 'verified',
          verificationMessage: 'Article is live and readable on WeChat',
        };
      }

      return {
        verificationStatus: 'unverified',
        verificationMessage: 'WeChat verification inconclusive: no article content returned',
      };
    } catch (err) {
      return {
        verificationStatus: 'unverified',
        verificationMessage: `Verification error: ${err instanceof Error ? err.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Verify a published article using stored credentials.
   * This is the standalone verification entry point used by the verify API endpoint.
   *
   * It first tries freepublish/getarticle with the postId as media_id.
   * If that fails (postId may be a publish_id rather than media_id), it falls
   * back to freepublish/get to check the publish status.
   *
   * @param credentials - WeChat credentials containing appId and appSecret
   * @param postId - The platform post ID (publish_id or media_id)
   * @returns Verification result with status and message
   */
  async verifyWithCredentials(
    credentials: PlatformCredentials,
    postId?: string,
  ): Promise<VerificationResult> {
    const appId = credentials.data.appId || credentials.data.app_id || '';
    const appSecret = credentials.data.appSecret || credentials.data.app_secret || '';

    if (!appId || !appSecret) {
      return {
        verificationStatus: 'unverified',
        verificationMessage: 'Missing appId or appSecret for WeChat verification',
      };
    }

    if (!postId) {
      return {
        verificationStatus: 'unverified',
        verificationMessage: 'Missing postId for WeChat verification',
      };
    }

    try {
      const accessToken = await this.getAccessToken(appId, appSecret);

      // First attempt: try getarticle with postId as media_id
      const articleResult = await this.verifyPublication(accessToken, postId);
      if (articleResult.verificationStatus === 'verified') {
        return articleResult;
      }

      // Fallback: use freepublish/get to check publish status by publish_id
      const statusUrl = `https://api.weixin.qq.com/cgi-bin/freepublish/get?access_token=${encodeURIComponent(accessToken)}`;
      const statusRes = await fetch(statusUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publish_id: postId }),
      });
      const statusData = await statusRes.json() as {
        publish_status?: number;
        errcode?: number;
        errmsg?: string;
      };

      if (statusData.errcode) {
        return {
          verificationStatus: 'failed',
          verificationMessage: `WeChat verification failed (${statusData.errcode}): ${statusData.errmsg ?? 'unknown error'}`,
        };
      }

      if (statusData.publish_status === 0) {
        return {
          verificationStatus: 'verified',
          verificationMessage: 'Article is published and verified on WeChat',
        };
      } else if (statusData.publish_status === 1) {
        return {
          verificationStatus: 'unverified',
          verificationMessage: 'Article is still publishing on WeChat',
        };
      } else {
        return {
          verificationStatus: 'failed',
          verificationMessage: `WeChat publish verification failed with status: ${statusData.publish_status}`,
        };
      }
    } catch (err) {
      return {
        verificationStatus: 'unverified',
        verificationMessage: `Verification error: ${err instanceof Error ? err.message : 'Unknown error'}`,
      };
    }
  }

}
