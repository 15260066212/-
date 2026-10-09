import type { ReviewIssue, ReviewWeights, DimensionResult } from '@zemingengine/shared';
import { DEFAULT_REVIEW_WEIGHTS } from '@zemingengine/shared';

const SEVERITY_RATE: Record<string, number> = {
  high: 0.20,
  medium: 0.10,
  low: 0.05,
};

export function calculateScore(
  issues: ReviewIssue[],
  dimension: string,
): DimensionResult {
  const dimensionIssues = issues.filter((issue) => issue.dimension === dimension);
  let score = 100;

  const severityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const sorted = [...dimensionIssues].sort(
    (a, b) => (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3),
  );

  for (const issue of sorted) {
    const rate = SEVERITY_RATE[issue.severity] ?? 0.05;
    score -= score * rate;
  }

  return { score: Math.max(0, Math.round(score)), issues: dimensionIssues };
}

export function calculateWeightedScore(
  dimensions: Record<string, DimensionResult>,
  weights: ReviewWeights = DEFAULT_REVIEW_WEIGHTS,
): number {
  let totalScore = 0;
  let totalWeight = 0;

  for (const [dim, result] of Object.entries(dimensions)) {
    const weight = weights[dim as keyof ReviewWeights] ?? 0;
    totalScore += result.score * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) return 0;

  let score = Math.floor(totalScore / totalWeight);

  const lowDimensions = Object.values(dimensions).filter((d) => d.score < 60).length;
  if (lowDimensions >= 4) {
    score = Math.floor(score * 0.85);
  } else if (lowDimensions >= 3) {
    score = Math.floor(score * 0.92);
  }

  return score;
}
