import type { PlatformId } from '@zemingengine/shared';
import type { PublishParams, PublishResult } from '../types.js';

export interface VerificationResult {
  verificationStatus: 'verified' | 'unverified' | 'failed';
  verificationMessage: string;
}

export abstract class PlatformAdapter {
  readonly platform: PlatformId;

  constructor(platform: PlatformId) {
    this.platform = platform;
  }

  abstract publish(params: PublishParams): Promise<PublishResult>;

  /**
   * Save the article as a draft on the platform without publishing it.
   *
   * The returned PublishResult should have `success: true`,
   * `verificationStatus: 'draft_saved'`, and `draftSaved: true`.
   * The `postId` holds the platform draft identifier (e.g. WeChat media_id).
   *
   * Default implementation falls back to `publish()` so that adapters
   * without native draft support still produce a result (callers should
   * inspect `draftSaved` to know whether a true draft was created).
   */
  async saveDraft(params: PublishParams): Promise<PublishResult> {
    return this.publish(params);
  }

  getMethod(): 'api' | 'rpa' {
    return 'api';
  }
}
