import type { Page } from 'playwright';
import type { Article } from '@zemingengine/shared';
import type { PublishResult } from '../../../types.js';

/**
 * Strategy interface for CSDN publishing strategies.
 *
 * Each strategy encapsulates a complete publishing flow (navigate, fill
 * content, submit) and returns a PublishResult. Strategies are tried in
 * order by CsdnRpaHandler until one succeeds.
 */
export interface CsdnPublishStrategy {
  /** Human-readable strategy name, used in logs. */
  readonly name: string;

  /**
   * Execute the publishing strategy.
   *
   * @param page - Playwright Page with CSDN cookies already injected
   * @param article - Article to publish
   * @returns PublishResult indicating success or failure
   */
  execute(page: Page, article: Article): Promise<PublishResult>;
}
