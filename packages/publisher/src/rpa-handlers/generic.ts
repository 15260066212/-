import type { Article, PlatformCredentials, PlatformId } from '@zemingengine/shared';
import type { Page } from 'playwright';
import type { PublishResult } from '../types.js';
import { RpaHandler } from './base.js';

/**
 * Generic RPA handler for platforms that don't have a dedicated handler yet.
 * Returns a clear error indicating the platform needs a dedicated implementation.
 */
export class GenericRpaHandler extends RpaHandler {
  constructor(platform: PlatformId) {
    super(platform);
  }

  async publish(_page: Page, _article: Article, _credentials: PlatformCredentials): Promise<PublishResult> {
    return {
      success: false,
      error: `No dedicated RPA handler implemented for platform: ${this.platform}. ` +
        'Please contribute a handler implementation or use the API adapter if available.',
    };
  }
}
