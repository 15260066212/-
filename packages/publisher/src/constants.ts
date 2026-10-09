/**
 * Centralized constants for the publisher package.
 *
 * All magic numbers related to timeouts, retries, and default behavior
 * should live here so they can be tuned from a single source of truth.
 */

/** Default retry configuration for publish operations. */
export const PublishDefaults = {
  /** Default maximum number of retries (total attempts = maxRetries + 1). */
  MAX_RETRIES: 2,
  /** Default base retry delay in ms for unknown/unclassified failures. */
  BASE_RETRY_DELAY_MS: 3000,
} as const;

/** Timeout constants used by RPAEngine for operations outside handler scope. */
export const EngineTimeout = {
  /** Page navigation timeout for post-publish verification. */
  VERIFY_NAVIGATION_MS: 15000,
  /** Timeout for reading page content during verification. */
  VERIFY_READ_MS: 5000,
  /** Timeout for LLMWiki fallback remote call. */
  REMOTE_LLMWIKI_CALL_MS: 120000,
} as const;
