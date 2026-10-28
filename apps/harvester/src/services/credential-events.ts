/**
 * Credential Event Bus — event-driven credential update system.
 *
 * A simple event emitter that decouples "cookie was extracted" from
 * "save to local storage" and "sync to main server". This allows
 * subscribers to react to credential updates without the extractor
 * knowing about them.
 */

import type { CookieCredential } from '../lib/credential-model.js';

type CredentialUpdatedHandler = (cred: CookieCredential) => void | Promise<void>;

class CredentialEventBus {
  private handlers: Set<CredentialUpdatedHandler> = new Set();

  /**
   * Register a handler for credential update events.
   * Returns an unsubscribe function.
   */
  onCredentialUpdated(handler: CredentialUpdatedHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /**
   * Emit a credential updated event to all registered handlers.
   * All handlers run concurrently; errors in individual handlers
   * are caught and logged so one failure doesn't affect others.
   */
  async emitCredentialUpdated(cred: CookieCredential): Promise<void> {
    const promises = Array.from(this.handlers).map((h) => {
      try {
        return Promise.resolve(h(cred));
      } catch (e) {
        console.error('[CredentialEvents] Handler error:', e);
        return Promise.resolve();
      }
    });
    await Promise.all(promises);
  }
}

/** Singleton event bus instance for credential lifecycle events. */
export const credentialEvents = new CredentialEventBus();
