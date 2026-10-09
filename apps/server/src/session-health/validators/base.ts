import type { PlatformCredentials, PlatformId } from '@zemingengine/shared';
import type { ValidationResult } from '../types.js';

export abstract class BaseValidator {
  abstract readonly platform: PlatformId;

  abstract validate(credentials: PlatformCredentials): Promise<ValidationResult>;

  protected measure<T>(fn: () => Promise<T>): Promise<{ result: T; durationMs: number }> {
    const start = Date.now();
    return fn().then((result) => ({
      result,
      durationMs: Date.now() - start,
    }));
  }
}
