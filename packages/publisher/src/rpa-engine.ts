import type { Article, PlatformCredentials, PlatformId, StorageState, resolveStorageState } from '@zemingengine/shared';
import { getSessionPlatformName } from '@zemingengine/shared';
import type { Browser, BrowserContext } from 'playwright';
import type { PublishResult } from './types.js';
import { RpaHandler, parseCookies } from './rpa-handlers/base.js';
import { PublicationVerifier } from './rpa/publication-verifier.js';
import { RemotePublisher } from './rpa/remote-publisher.js';
import { LLMWikiFallback } from './rpa/llmwiki-fallback.js';
// BrowserFingerprintManager is lazily imported to avoid loading
// fingerprint-generator / fingerprint-injector at startup.
// These native deps are only needed for local RPA mode (not remote mode).

// Dynamic import of resolveStorageState to avoid circular dependency issues
// (shared package is a dependency of publisher)
async function getStorageState(cred: PlatformCredentials): Promise<StorageState | null> {
  const mod = await import('@zemingengine/shared');
  return mod.resolveStorageState(cred.data as Record<string, unknown>);
}

/**
 * Minimal account info needed by SessionPool to acquire a browser context.
 * This is a subset of AccountCredentials from account-vault.
 */
export interface SessionAccount {
  platform: string;
  accountId: string;
  fingerprintId?: string;
}

/**
 * Interface for SessionPool integration.
 * The actual SessionPool class (packages/session-pool) implements this interface.
 * RPAEngine uses it to persist and reuse browser sessions with fingerprint isolation.
 */
export interface ISessionPool {
  acquireContext(account: SessionAccount): Promise<BrowserContext>;
  releaseContext(accountId: string, platform: string): void | Promise<void>;
  saveSession(
    accountId: string,
    platform: string,
    context: BrowserContext,
    userDataDir: string,
    fingerprintId?: string,
  ): Promise<void>;
  close(): Promise<void>;
}

/**
 * Playwright-based RPA engine for browser automation publishing.
 *
 * Features:
 * - Lazy browser launch (only when first publish is requested)
 * - Optional stealth plugin to patch automation fingerprints (extends cookie lifespan)
 * - Full storageState persistence (cookies + localStorage + IndexedDB)
 * - Optional SessionPool integration for session persistence + fingerprint isolation
 * - Configurable headless mode via RPA_HEADLESS env var
 * - Cookie-based authentication injection
 * - Per-platform handler dispatch
 * - Automatic screenshot capture on errors
 * - Graceful fallback when Playwright is not available
 *
 * As a Facade, RPAEngine coordinates specialized sub-modules:
 * - RemotePublisher: delegates publishing to a remote harvester service
 * - PublicationVerifier: verifies that published articles are live
 * - LLMWikiFallback: provides LLMWiki-based self-healing fallback
 */
export class RPAEngine {
  private browser: Browser | null = null;
  private handlers: Map<PlatformId, RpaHandler> = new Map();
  private launchPromise: Promise<Browser> | null = null;
  private sessionPool?: ISessionPool;
  private fingerprintManager: any = null;
  private fingerprintEnabled: boolean;
  private fingerprintManagerPromise: Promise<any> | null = null;

  // Callback when a new fingerprint is generated — caller should persist it
  // to the credential store so the same fingerprint is reused next time.
  onFingerprintGenerated?: (
    platform: PlatformId,
    accountId: string,
    fingerprintJson: string,
  ) => void | Promise<void>;

  // Sub-modules (collaborators)
  private remotePublisher: RemotePublisher;
  private publicationVerifier: PublicationVerifier;
  private llmWikiFallback: LLMWikiFallback;

  constructor(sessionPool?: ISessionPool) {
    this.sessionPool = sessionPool;
    // Fingerprint manager is lazily initialized only when needed
    // (local RPA mode + fingerprint enabled) to avoid loading heavy
    // native dependencies at startup in remote mode deployments.
    this.fingerprintEnabled = process.env.RPA_FINGERPRINT !== 'false';
    // Handlers are registered externally (via Publisher layer), not here.
    // RPAEngine is a pure execution engine — it does not know or care which
    // platforms are supported. The Publisher decides which handlers to load.

    // Initialize sub-modules
    this.remotePublisher = new RemotePublisher();
    this.publicationVerifier = new PublicationVerifier();
    // Enable LLMWiki fallback by default, can be disabled via env var
    const fallbackEnabled = process.env.RPA_LLMWIKI_FALLBACK !== 'false';
    this.llmWikiFallback = new LLMWikiFallback(fallbackEnabled);
  }

  /**
   * Lazily load the BrowserFingerprintManager.
   * Only called when actually needed (local RPA mode + fingerprint enabled).
   */
  private async getFingerprintManager(): Promise<any> {
    if (this.fingerprintManager) return this.fingerprintManager;
    if (this.fingerprintManagerPromise) return this.fingerprintManagerPromise;

    this.fingerprintManagerPromise = (async () => {
      const { BrowserFingerprintManager } = await import('./browser-fingerprint.js');
      this.fingerprintManager = new BrowserFingerprintManager();
      this.fingerprintManagerPromise = null;
      return this.fingerprintManager;
    })();

    return this.fingerprintManagerPromise;
  }

  /** Number of registered handlers (exposes handler map size for inspection). */
  get handlerCount(): number {
    return this.handlers.size;
  }

  /** Register a custom RPA handler for a platform. */
  registerHandler(handler: RpaHandler): void {
    this.handlers.set(handler.platform, handler);
  }

  /** Check if a handler is registered for a platform. */
  hasHandler(platform: PlatformId): boolean {
    return this.handlers.has(platform);
  }

  /** Get all platform IDs that have a registered handler. */
  getHandlerPlatforms(): PlatformId[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Whether remote RPA execution is enabled via the RPA_REMOTE_URL env var.
   *
   * When set (e.g. http://harvester:3003), publish calls are delegated to the
   * harvester service over HTTP instead of launching a local Playwright
   * browser. This is used in Docker deployments where the geo-app container
   * does not have Playwright browsers installed, but the harvester container
   * does.
   */
  private isRemoteMode(): boolean {
    return this.remotePublisher.isRemoteMode();
  }

  /**
   * Launch the browser lazily. Returns a cached instance if already launched.
   * Uses RPA_HEADLESS env var (default: true).
   *
   * Stealth plugin (RPA_STEALTH=true, default) patches 20+ automation
   * fingerprints to reduce bot detection, which significantly extends cookie
   * lifespan by avoiding "suspicious browser" flagging.
   *
   * NOTE: In remote mode (RPA_REMOTE_URL set), local browser launch is
   * disabled and publishing is delegated to the harvester service.
   * Calling launch() in remote mode will throw.
   */
  async launch(): Promise<Browser> {
    if (this.browser) return this.browser;
    if (this.launchPromise) return this.launchPromise;

    this.launchPromise = this.doLaunch();
    this.browser = await this.launchPromise;
    this.launchPromise = null;
    return this.browser;
  }

  private async doLaunch(): Promise<Browser> {
    // Remote mode: local Playwright browser launch is intentionally disabled.
    if (this.isRemoteMode()) {
      throw new Error(
        `Local browser launch is disabled in remote mode ` +
          `(RPA_REMOTE_URL=${process.env.RPA_REMOTE_URL}). ` +
          'Publishing is delegated to the harvester service.',
      );
    }

    const headless = process.env.RPA_HEADLESS !== 'false';
    const stealthEnabled = process.env.RPA_STEALTH !== 'false';
    try {
      let chromium: typeof import('playwright').chromium;

      if (stealthEnabled) {
        // Use playwright-extra with the stealth plugin to patch 20+
        // automation fingerprints (navigator.webdriver, plugins, languages,
        // WebGL vendor, etc.). This reduces bot detection and significantly
        // extends cookie / session lifespan.
        const { chromium: extraChromium } = await import('playwright-extra');
        const { default: StealthPlugin } = await import(
          'puppeteer-extra-plugin-stealth'
        );
        // playwright-extra uses the same API as playwright's chromium
        extraChromium.use(StealthPlugin());
        chromium = extraChromium as unknown as typeof import('playwright').chromium;
      } else {
        const pw = await import('playwright');
        chromium = pw.chromium;
      }

      const browser = await chromium.launch({
        headless,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-sandbox',
          '--disable-setuid-sandbox',
        ],
      });
      console.log(
        `[RPAEngine] Browser launched (headless: ${headless}, stealth: ${stealthEnabled})`,
      );
      return browser;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to launch browser: ${message}. ` +
          'Ensure Playwright browsers are installed: npx playwright install chromium',
      );
    }
  }

  /** Close the browser if it's running. */
  async close(): Promise<void> {
    if (this.sessionPool) {
      await this.sessionPool.close();
      console.log('[RPAEngine] SessionPool closed');
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      console.log('[RPAEngine] Browser closed');
    }
  }

  /**
   * Enable or disable LLMWiki fallback at runtime.
   */
  setLLMWikiFallback(enabled: boolean): void {
    this.llmWikiFallback.setEnabled(enabled);
  }

  /**
   * Publish an article to a platform using the registered RPA handler.
   *
   * Flow:
   * 1. If remote mode, delegate to RemotePublisher
   * 2. Otherwise acquire a browser context (SessionPool or fresh)
   * 3. Find the handler for the target platform
   * 4. Restore full browser state (storageState > cookies, for better session lifespan)
   * 5. Execute the handler's publish flow
   * 6. Save updated storageState (so next restore has fresher state)
   * 7. Verify publication (best-effort)
   * 8. Optionally trigger LLMWiki fallback on failure
   */
  async publish(
    article: Article,
    credentials: PlatformCredentials,
    accountId: string,
  ): Promise<PublishResult> {
    // Remote mode: delegate entirely to the harvester service
    if (this.isRemoteMode()) {
      return this.remotePublisher.remotePublish(credentials.platform as PlatformId, article, credentials);
    }

    const handler = this.handlers.get(credentials.platform);
    if (!handler) {
      return {
        success: false,
        error: `No RPA handler registered for platform: ${credentials.platform}`,
      };
    }

    const browser = await this.launch();
    let context: BrowserContext | null = null;

    try {
      // Use SessionPool if available (persistent session + fingerprint isolation)
      if (this.sessionPool) {
        context = await this.sessionPool.acquireContext({
          platform: credentials.platform,
          accountId,
        });
      } else {
        // Restore full browser state from storageState (preferred) or legacy cookies.
        // Full storageState includes cookies + localStorage + IndexedDB,
        // which reduces "new device" detection and extends session lifespan.
        const storageState = await getStorageState(credentials);
        const credData = credentials.data as Record<string, unknown>;

        // Fingerprint: use persisted fingerprint if available, otherwise generate new one.
        // Consistent fingerprints across sessions reduce "device change" detection.
        if (this.fingerprintEnabled) {
          const fpMgr = await this.getFingerprintManager();
          const { fingerprint, isNew } = fpMgr.getOrGenerateFingerprint(credData);
          const contextOpts: any = {};

          if (storageState && storageState.cookies.length > 0) {
            contextOpts.storageState = storageState;
          }

          context = await fpMgr.createContextWithFingerprint(
            browser,
            fingerprint,
            contextOpts,
          );

          // If this is a new fingerprint, notify caller to persist it
          if (isNew && this.onFingerprintGenerated) {
            const fpJson = fpMgr.serializeFingerprint(fingerprint);
            await Promise.resolve(
              this.onFingerprintGenerated(credentials.platform, accountId, fpJson),
            );
          }

          // Fallback: add cookies if no storageState was available
          if (!storageState || storageState.cookies.length === 0) {
            const cookies = parseCookies(credentials, '');
            if (cookies.length > 0) {
              await context.addCookies(cookies);
            }
          }
        } else if (storageState && storageState.cookies.length > 0) {
          // Cast storageState to Playwright's expected format
          context = await browser.newContext({
            storageState: storageState as any,
          });
        } else {
          // Fallback: legacy cookie injection
          context = await browser.newContext();
          const cookies = parseCookies(credentials, '');
          if (cookies.length > 0) {
            await context.addCookies(cookies);
          }
        }
      }

      const page = await context.newPage();
      const result = await handler.publish(page, article, credentials);

      // Best-effort publication verification
      if (result.success && result.postUrl) {
        try {
          const verification = await this.publicationVerifier.verifyPublication(
            page,
            result.postUrl,
            credentials.platform,
          );
          result.verificationStatus = verification.status === 'verified' ? 'verified' : 'unverified';
          result.verificationMessage = verification.message;
        } catch {
          // verification is best-effort, ignore errors
        }
      }

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      // Attempt LLMWiki fallback on failure
      if (this.llmWikiFallback.canUseLLMWikiFallback(credentials.platform)) {
        try {
          const fallbackResult = await (this.llmWikiFallback as any).tryFallback?.(
            article,
            credentials,
            accountId,
          );
          if (fallbackResult?.success) {
            return fallbackResult;
          }
        } catch {
          // fallback failed, return original error
        }
      }

      return {
        success: false,
        error: message,
      };
    } finally {
      if (context && !this.sessionPool) {
        await context.close();
      } else if (context && this.sessionPool) {
        await this.sessionPool.releaseContext(accountId, credentials.platform);
      }
    }
  }

  /**
   * Save an article as a draft on a platform using the registered RPA handler.
   *
   * Mirrors publish() but calls `handler.saveDraft()` instead of
   * `handler.publish()`. Publication verification is skipped for drafts
   * since the article is not yet live.
   */
  async saveDraft(
    article: Article,
    credentials: PlatformCredentials,
    accountId: string,
  ): Promise<PublishResult> {
    // Remote mode: delegate to the harvester service (draft mode)
    if (this.isRemoteMode()) {
      return this.remotePublisher.remotePublish(credentials.platform as PlatformId, article, credentials);
    }

    const handler = this.handlers.get(credentials.platform);
    if (!handler) {
      return {
        success: false,
        error: `No RPA handler registered for platform: ${credentials.platform}`,
      };
    }

    const browser = await this.launch();
    let context: BrowserContext | null = null;

    try {
      if (this.sessionPool) {
        context = await this.sessionPool.acquireContext({
          platform: credentials.platform,
          accountId,
        });
      } else {
        const storageState = await getStorageState(credentials);
        const credData = credentials.data as Record<string, unknown>;

        if (this.fingerprintEnabled) {
          const fpMgr = await this.getFingerprintManager();
          const { fingerprint, isNew } = fpMgr.getOrGenerateFingerprint(credData);
          const contextOpts: any = {};

          if (storageState && storageState.cookies.length > 0) {
            contextOpts.storageState = storageState;
          }

          context = await fpMgr.createContextWithFingerprint(
            browser,
            fingerprint,
            contextOpts,
          );

          if (isNew && this.onFingerprintGenerated) {
            const fpJson = fpMgr.serializeFingerprint(fingerprint);
            await Promise.resolve(
              this.onFingerprintGenerated(credentials.platform, accountId, fpJson),
            );
          }

          if (!storageState || storageState.cookies.length === 0) {
            const cookies = parseCookies(credentials, '');
            if (cookies.length > 0) {
              await context.addCookies(cookies);
            }
          }
        } else if (storageState && storageState.cookies.length > 0) {
          context = await browser.newContext({
            storageState: storageState as any,
          });
        } else {
          context = await browser.newContext();
          const cookies = parseCookies(credentials, '');
          if (cookies.length > 0) {
            await context.addCookies(cookies);
          }
        }
      }

      const page = await context.newPage();
      const result = await handler.saveDraft(page, article, credentials);

      // No publication verification for drafts — the article is not live yet.
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: message,
      };
    } finally {
      if (context && !this.sessionPool) {
        await context.close();
      } else if (context && this.sessionPool) {
        await this.sessionPool.releaseContext(accountId, credentials.platform);
      }
    }
  }
}
