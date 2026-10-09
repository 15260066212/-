import type { PlatformCredentials, PlatformId } from '@zemingengine/shared';

export interface ValidationResult {
  valid: boolean;
  error?: string;
  evidence?: {
    pageTitle?: string;
    finalUrl?: string;
    screenshot?: string;
  };
  durationMs: number;
}

export interface Validator {
  readonly platform: PlatformId;
  validate(credentials: PlatformCredentials): Promise<ValidationResult>;
}

export type HealthCheckStatus = 'valid' | 'checking' | 'expired' | 'invalid' | 'error';

export interface HealthCheckLog {
  id?: number;
  platform: string;
  userId: string;
  status: HealthCheckStatus;
  durationMs: number;
  errorMessage?: string;
  checkedAt: number;
}

export const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
export const CHECK_BATCH_SIZE = 3; // Max 3 concurrent checks per batch
export const MAX_CONSECUTIVE_FAILURES = 3; // Mark expired after 3 consecutive failures
