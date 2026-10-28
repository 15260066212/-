/**
 * Build a validation summary from selector validation results.
 */

export interface SelectorValidationResult {
  selector: string;
  purpose: string;
  found: boolean;
  count: number;
  visible: boolean;
}

export type SelectorStatus = 'ok' | 'degraded' | 'broken';

export interface SelectorValidationSummary {
  total: number;
  found: number;
  missing: number;
  byPurpose: Array<{
    purpose: string;
    total: number;
    found: number;
    missing: number;
    status: SelectorStatus;
  }>;
  brokenPurposes: string[];
}

export function buildSelectorValidationSummary(results: SelectorValidationResult[]): SelectorValidationSummary {
  if (!Array.isArray(results)) {
    return {
      total: 0,
      found: 0,
      missing: 0,
      byPurpose: [],
      brokenPurposes: [],
    };
  }

  const total = results.length;
  const found = results.filter((r) => r.found).length;
  const missing = total - found;

  const purposes = [...new Set(results.map((r) => r.purpose || 'unknown'))];
  const byPurpose = purposes.map((p) => {
    const purposeResults = results.filter((r) => (r.purpose || 'unknown') === p);
    const purposeFound = purposeResults.filter((r) => r.found).length;
    const purposeMissing = purposeResults.filter((r) => !r.found).length;

    // For fallback chains: if at least one selector works and is visible, the purpose is OK
    let status: SelectorStatus;
    if (purposeResults.some((r) => r.found && r.visible)) {
      status = 'ok';
    } else if (purposeResults.some((r) => r.found)) {
      status = 'degraded';
    } else {
      status = 'broken';
    }

    return {
      purpose: p,
      total: purposeResults.length,
      found: purposeFound,
      missing: purposeMissing,
      status,
    };
  });

  const brokenPurposes = byPurpose.filter((p) => p.status === 'broken').map((p) => p.purpose);

  return {
    total,
    found,
    missing,
    byPurpose,
    brokenPurposes,
  };
}
