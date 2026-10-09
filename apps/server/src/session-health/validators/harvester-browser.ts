import type { PlatformCredentials, PlatformId } from '@zemingengine/shared';
import { BaseValidator } from './base.js';
import type { ValidationResult } from '../types.js';
import type { DatabaseAccess } from '../../db.js';

export class HarvesterBrowserValidator extends BaseValidator {
  readonly platform: PlatformId;

  /** Database access for saving refreshed cookies / storageState / fingerprint */
  protected db?: DatabaseAccess;

  /** Harvester service platform ID, if different from system platform ID */
  private readonly _harvesterPlatform?: string;

  constructor(platform: PlatformId, harvesterPlatform?: string) {
    super();
    this.platform = platform;
    this._harvesterPlatform = harvesterPlatform;
  }

  /** Inject database access for cookie refresh on successful check */
  setDatabase(db: DatabaseAccess): void {
    this.db = db;
  }

  /** Harvester service platform ID, if different from system platform ID */
  protected get harvesterPlatform(): string {
    return this._harvesterPlatform ?? this.platform;
  }

  async validate(credentials: PlatformCredentials): Promise<ValidationResult> {
    const { result, durationMs } = await this.measure(async () => {
      const harvesterUrl = process.env.RPA_REMOTE_URL;

      if (!harvesterUrl) {
        return { valid: true, error: undefined };
      }

      const cookie = credentials.data.cookie || credentials.data.cookies || '';
      const storageState = credentials.data.storageState || '';
      const fingerprintData = credentials.data.fingerprintData || '';

      // Need at least one auth method
      if (!cookie && !storageState) {
        return { valid: false, error: 'No cookie or storageState found in credentials' };
      }

      try {
        // Build request body: prefer storageState, include fingerprint if available
        const body: Record<string, string> = { platform: this.harvesterPlatform };
        if (storageState) {
          body.storageState = storageState;
        } else if (cookie) {
          body.cookies = cookie;
        }
        if (fingerprintData) {
          body.fingerprintData = fingerprintData;
        }

        // First: check session validity
        const checkUrl = `${harvesterUrl.replace(/\/+$/, '')}/api/rpa/check-session`;
        const res = await fetch(checkUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(45000),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          return {
            valid: false,
            error: `Harvester returned HTTP ${res.status}: ${text.slice(0, 200)}`,
          };
        }

        const data = (await res.json()) as {
          success: boolean;
          valid: boolean;
          reason?: string;
          finalUrl?: string;
          pageTitle?: string;
          screenshot?: string;
          checks?: Record<string, unknown>;
          error?: string;
        };

        if (!data.success) {
          return {
            valid: false,
            error: data.error || 'Harvester check failed',
          };
        }

        // If session is valid, attempt cookie refresh to extend lifetime
        if (data.valid && this.db) {
          try {
            const refreshUrl = `${harvesterUrl.replace(/\/+$/, '')}/api/rpa/refresh-cookies`;
            const refreshRes = await fetch(refreshUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(30000),
            });

            if (refreshRes.ok) {
              const refreshData = (await refreshRes.json()) as {
                success: boolean;
                valid: boolean;
                refreshedCookies?: string;
                refreshedStorageState?: string;
                refreshedFingerprintData?: string;
              };

              if (refreshData.success && refreshData.valid) {
                // Save whatever the harvester returned
                const updateData: Record<string, string> = {};
                const accountId = credentials.accountId || 'default';
                const userId = credentials.brandId ? 'user_default' : 'user_default';

                // Prefer full storageState
                if (refreshData.refreshedStorageState) {
                  updateData.storageState = refreshData.refreshedStorageState;
                  if (refreshData.refreshedCookies) {
                    updateData.cookie = refreshData.refreshedCookies;
                  }
                } else if (refreshData.refreshedCookies) {
                  updateData.cookie = refreshData.refreshedCookies;
                }

                // Save fingerprint if returned
                if (refreshData.refreshedFingerprintData) {
                  updateData.fingerprintData = refreshData.refreshedFingerprintData;
                }

                if (Object.keys(updateData).length > 0) {
                  this.db.credentials.updateCredentialData(
                    this.platform,
                    updateData,
                    userId,
                    accountId,
                  );
                }

                console.log(`[HealthCheck] State refreshed and saved for ${this.platform}:${accountId}`);
              }
            }
          } catch (refreshErr) {
            // Cookie refresh failure is non-critical - the session is still valid
            console.warn(`[HealthCheck] Refresh failed for ${this.platform}:`, refreshErr instanceof Error ? refreshErr.message : refreshErr);
          }
        }

        return {
          valid: data.valid,
          error: data.valid ? undefined : data.reason || 'Session expired',
          evidence: {
            pageTitle: data.pageTitle,
            finalUrl: data.finalUrl,
            screenshot: data.screenshot,
          },
        };
      } catch (err) {
        return {
          valid: false,
          error: `Harvester check error: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    });

    return {
      ...result,
      durationMs,
    } as ValidationResult;
  }
}
