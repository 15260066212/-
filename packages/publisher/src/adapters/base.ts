import type { PlatformCredentials, PlatformId } from '@zemingengine/shared';
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

  getMethod(): 'api' | 'rpa' {
    return 'api';
  }

  /**
   * Verify that a published article is live and accessible.
   * Default implementation returns 'unverified' — subclasses (e.g. WechatAdapter)
   * override this to perform platform-specific API verification.
   *
   * @param credentials - Platform credentials needed for verification
   * @param postId - The platform post ID (e.g. publish_id, media_id)
   * @returns Verification result with status and message
   */
  async verifyWithCredentials(
    _credentials: PlatformCredentials,
    _postId?: string,
  ): Promise<VerificationResult> {
    return {
      verificationStatus: 'unverified',
      verificationMessage: 'Verification not supported for this platform',
    };
  }
}
