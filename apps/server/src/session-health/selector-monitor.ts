/**
 * SelectorMonitor — Periodically validates CSS selectors against live
 * platform pages to detect structural changes before they cause publish failures.
 *
 * Flow:
 * 1. Runs every 6 hours (or manually triggered)
 * 2. For each platform in SELECTOR_REGISTRY, calls harvester's /api/rpa/validate-selectors
 * 3. Records results in selector_health_logs table
 * 4. Creates health alerts for broken selector purposes
 * 5. Monitor API exposes status and manual trigger
 */

import type { DatabaseAccess } from '../db.js';
import { SELECTOR_REGISTRY, getPlatformSelectors } from './selector-registry.js';

const SELECTOR_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const HARVESTER_TIMEOUT_MS = 60 * 1000; // 60s per platform
const PLATFORM_CHECK_DELAY_MS = 5 * 1000; // 5s between platforms to avoid overload

interface SelectorValidationResult {
  success: boolean;
  platform: string;
  finalUrl?: string;
  pageTitle?: string;
  results?: Array<{
    selector: string;
    purpose: string;
    found: boolean;
    count: number;
    visible: boolean;
    error?: string;
  }>;
  summary?: {
    total: number;
    found: number;
    missing: number;
    byPurpose: Array<{
      purpose: string;
      total: number;
      found: number;
      missing: number;
      status: 'ok' | 'degraded' | 'broken';
    }>;
    brokenPurposes: string[];
  };
  error?: string;
  errorType?: string;
}

export class SelectorMonitor {
  private db: DatabaseAccess;
  private isRunning = false;
  private lastRunTime = 0;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(db: DatabaseAccess) {
    this.db = db;
  }

  /** Start the periodic selector health check. */
  start(): void {
    if (this.intervalHandle) return;
    console.log('[SelectorMonitor] Starting periodic selector health checks (every 6 hours)');
    // Run first check after 30 seconds to let server stabilize
    setTimeout(() => void this.runCheck(), 30 * 1000);
    this.intervalHandle = setInterval(
      () => void this.runCheck(),
      SELECTOR_CHECK_INTERVAL_MS,
    );
  }

  /** Stop the periodic check. */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /** Check if a check is currently running. */
  isCheckRunning(): boolean {
    return this.isRunning;
  }

  /** Get the timestamp of the last completed check run. */
  getLastRunTime(): number {
    return this.lastRunTime;
  }

  /** Get monitor status for API. */
  getStatus() {
    const stats = this.db.selectors.getSelectorHealthStats();
    return {
      running: this.isRunning,
      lastRunTime: this.lastRunTime,
      intervalMs: SELECTOR_CHECK_INTERVAL_MS,
      registeredPlatforms: SELECTOR_REGISTRY.map((s) => s.platform),
      stats,
    };
  }

  /** Run a selector health check for all registered platforms. */
  async runCheck(): Promise<void> {
    if (this.isRunning) {
      console.log('[SelectorMonitor] Check already running, skipping');
      return;
    }

    this.isRunning = true;
    console.log(`[SelectorMonitor] Starting selector health check for ${SELECTOR_REGISTRY.length} platforms`);

    const harvesterUrl = process.env.RPA_REMOTE_URL;
    if (!harvesterUrl) {
      console.warn('[SelectorMonitor] RPA_REMOTE_URL not configured, skipping selector check');
      this.isRunning = false;
      return;
    }

    for (const platformSet of SELECTOR_REGISTRY) {
      try {
        await this.checkPlatform(platformSet.platform, harvesterUrl, 'scheduled');
        // Delay between platforms to avoid overloading the harvester
        await sleep(PLATFORM_CHECK_DELAY_MS);
      } catch (error) {
        console.error(`[SelectorMonitor] Error checking ${platformSet.platform}:`, error);
      }
    }

    this.isRunning = false;
    this.lastRunTime = Date.now();
    console.log('[SelectorMonitor] Selector health check complete');
  }

  /** Validate selectors for a single platform. */
  async checkPlatform(
    platform: string,
    harvesterUrl?: string,
    triggeredBy: string = 'manual',
  ): Promise<SelectorValidationResult> {
    const platformSet = getPlatformSelectors(platform);
    if (!platformSet) {
      return {
        success: false,
        platform,
        error: `Platform ${platform} not found in selector registry`,
      };
    }

    const url = harvesterUrl || process.env.RPA_REMOTE_URL;
    if (!url) {
      return {
        success: false,
        platform,
        error: 'RPA_REMOTE_URL is not configured',
      };
    }

    // Separate selectors by page: login selectors go to loginUrl, others go to validateUrl
    const validateSelectors = platformSet.selectors.filter(
      (s) => !s.purpose.startsWith('login_'),
    );
    const loginSelectors = platformSet.selectors.filter(
      (s) => s.purpose.startsWith('login_'),
    );

    let combinedResults: SelectorValidationResult = {
      success: true,
      platform,
      summary: {
        total: 0,
        found: 0,
        missing: 0,
        byPurpose: [],
        brokenPurposes: [],
      },
    };

    // Check publishing selectors against the validate URL
    if (validateSelectors.length > 0) {
      const result = await this.callHarvester(
        url, platform, platformSet.validateUrl, validateSelectors,
      );
      if (result.success && result.summary) {
        combinedResults = mergeResults(combinedResults, result);
      } else if (!result.success) {
        combinedResults.success = false;
        combinedResults.error = result.error;
      }
    }

    // Check login selectors against the login URL (if any)
    if (loginSelectors.length > 0 && platformSet.loginUrl) {
      const loginResult = await this.callHarvester(
        url, platform, platformSet.loginUrl, loginSelectors,
      );
      if (loginResult.success && loginResult.summary) {
        combinedResults = mergeResults(combinedResults, loginResult);
      }
    }

    // Record in database
    if (combinedResults.summary) {
      const brokenPurposes = combinedResults.summary.brokenPurposes.join(',');
      const resultsJson = JSON.stringify(combinedResults.results || []);

      this.db.selectors.recordSelectorHealthCheck(
        platform,
        platformSet.validateUrl,
        combinedResults.summary.total,
        combinedResults.summary.found,
        combinedResults.summary.missing,
        brokenPurposes,
        resultsJson,
        triggeredBy,
      );

      // Create alerts for broken purposes
      if (combinedResults.summary.brokenPurposes.length > 0) {
        const message = `Selector health check for ${platform} found broken purposes: ${combinedResults.summary.brokenPurposes.join(', ')}. ` +
          `Found ${combinedResults.summary.found}/${combinedResults.summary.total} selectors. ` +
          `This may indicate the platform's page structure has changed.`;
        this.db.credentials.insertHealthAlert(platform, 'selector_broken', message);
        console.warn(`[SelectorMonitor] ALERT: ${platform} has broken selector purposes: ${combinedResults.summary.brokenPurposes.join(', ')}`);
      }

      console.log(
        `[SelectorMonitor] ${platform}: ${combinedResults.summary.found}/${combinedResults.summary.total} selectors found, ` +
        `${combinedResults.summary.brokenPurposes.length} broken purposes`,
      );
    }

    return combinedResults;
  }

  /** Call the harvester's validate-selectors endpoint. */
  private async callHarvester(
    harvesterUrl: string,
    platform: string,
    targetUrl: string,
    selectors: Array<{ selector: string; purpose: string }>,
  ): Promise<SelectorValidationResult> {
    const endpoint = `${harvesterUrl.replace(/\/+$/, '')}/api/rpa/validate-selectors`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), HARVESTER_TIMEOUT_MS);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, url: targetUrl, selectors }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const text = await response.text();
        return {
          success: false,
          platform,
          error: `Harvester returned ${response.status}: ${text}`,
          errorType: 'http_error',
        };
      }

      const data = await response.json();
      return {
        success: data.success ?? false,
        platform,
        finalUrl: data.finalUrl,
        pageTitle: data.pageTitle,
        results: data.results,
        summary: data.summary,
        error: data.error,
        errorType: data.errorType,
      };
    } catch (error) {
      const err = error as Error;
      return {
        success: false,
        platform,
        error: err.name === 'AbortError'
          ? `Harvester request timed out after ${HARVESTER_TIMEOUT_MS}ms`
          : `Failed to reach harvester: ${err.message}`,
        errorType: 'network',
      };
    }
  }
}

/** Merge two SelectorValidationResult objects into one. */
function mergeResults(
  base: SelectorValidationResult,
  addition: SelectorValidationResult,
): SelectorValidationResult {
  if (!addition.summary) return base;
  if (!base.summary) {
    base.summary = addition.summary;
    base.results = addition.results;
    return base;
  }

  const merged: SelectorValidationResult = {
    success: base.success && addition.success,
    platform: base.platform,
    results: [...(base.results || []), ...(addition.results || [])],
    summary: {
      total: base.summary.total + addition.summary.total,
      found: base.summary.found + addition.summary.found,
      missing: base.summary.missing + addition.summary.missing,
      byPurpose: [...base.summary.byPurpose, ...addition.summary.byPurpose],
      brokenPurposes: [
        ...new Set([
          ...base.summary.brokenPurposes,
          ...addition.summary.brokenPurposes,
        ]),
      ],
    },
  };

  return merged;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
