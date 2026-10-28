import type {
  Article,
  SessionData,
  ReviewResult,
  ReviewIssue,
  ReviewWeights,
} from '@zemingengine/shared';
import { DEFAULT_REVIEW_WEIGHTS } from '@zemingengine/shared';
import { checkCompliance } from './rules/compliance.js';
import { checkQuality } from './rules/quality.js';
import { checkSEO } from './rules/seo.js';
import { checkBrand } from './rules/brand.js';
import { checkOriginality } from './rules/originality.js';
import { checkPlatformAdaptation } from './rules/platform-adaptation.js';
import { checkReadability } from './rules/readability.js';
import { checkSafety } from './rules/safety.js';
import { checkTruthfulness } from './rules/truthfulness.js';
import { calculateScore, calculateWeightedScore } from './scorer.js';
import { createHash } from 'crypto';

/** Compute SHA-256 hash of review result for tamper detection. */
export function computeReviewHash(data: {
  articleId: string;
  overallScore: number;
  passed: boolean;
  issuesCount: number;
  reviewedAt: string;
}): string {
  const payload = `${data.articleId}:${data.overallScore}:${data.passed}:${data.issuesCount}:${data.reviewedAt}`;
  return createHash('sha256').update(payload).digest('hex').substring(0, 16);
}

/** Verify that a review result's content hash matches. */
export function verifyReviewHash(review: {
  articleId: string;
  overallScore: number;
  passed: boolean;
  issues?: unknown[];
  reviewedAt: string;
  contentHash?: string;
}): boolean {
  if (!review.contentHash) return false;
  const expected = computeReviewHash({
    articleId: review.articleId,
    overallScore: review.overallScore,
    passed: review.passed,
    issuesCount: review.issues?.length ?? 0,
    reviewedAt: review.reviewedAt,
  });
  return expected === review.contentHash;
}

export interface ReviewerOptions {
  passThreshold?: number;
  weights?: ReviewWeights;
}

export class ContentReviewer {
  private passThreshold: number;
  private weights: ReviewWeights;

  constructor(options?: ReviewerOptions) {
    this.passThreshold = options?.passThreshold ?? 70;
    this.weights = options?.weights ?? DEFAULT_REVIEW_WEIGHTS;
  }

  review(article: Article, session: SessionData): ReviewResult {
    // Collect issues from all 8 dimensions
    const complianceIssues = checkCompliance(article);
    const qualityIssues = checkQuality(article);
    const seoIssues = checkSEO(article, session);
    const brandIssues = checkBrand(article, session);
    const originalityIssues = checkOriginality(article);
    const platformAdaptationIssues = checkPlatformAdaptation(article);
    const readabilityIssues = checkReadability(article);
    const safetyIssues = checkSafety(article);
    const truthfulnessIssues = checkTruthfulness(article, session);

    const allIssues: ReviewIssue[] = [
      ...complianceIssues,
      ...qualityIssues,
      ...seoIssues,
      ...brandIssues,
      ...originalityIssues,
      ...platformAdaptationIssues,
      ...readabilityIssues,
      ...safetyIssues,
      ...truthfulnessIssues,
    ];

    // Calculate scores for each dimension
    const compliance = calculateScore(allIssues, 'compliance');
    const quality = calculateScore(allIssues, 'quality');
    const seo = calculateScore(allIssues, 'seo');
    const brand = calculateScore(allIssues, 'brand');
    const originality = calculateScore(allIssues, 'originality');
    const platform_adaptation = calculateScore(allIssues, 'platform_adaptation');
    const readability = calculateScore(allIssues, 'readability');
    const safety = calculateScore(allIssues, 'safety');
    const truthfulness = calculateScore(allIssues, 'truthfulness');

    const dimensions = {
      compliance,
      quality,
      seo,
      brand,
      originality,
      platform_adaptation,
      readability,
      safety,
      truthfulness,
    };

    // Calculate weighted overall score
    const overallScore = calculateWeightedScore(dimensions, this.weights);

    // Veto conditions: certain critical issues auto-fail regardless of overall score
    // 1. High-severity compliance issues (illegal/sensitive content)
    const hasHighSeverityCompliance = complianceIssues.some((i) => i.severity === 'high');
    // 2. High-severity platform adaptation issues (content doesn't meet platform minimum requirements)
    const hasHighSeverityPlatform = platformAdaptationIssues.some((i) => i.severity === 'high');
    // 3. High-severity safety issues (misleading claims, missing disclaimers)
    const hasHighSeveritySafety = safetyIssues.some((i) => i.severity === 'high');
    // 3b. High-severity truthfulness issues (fabricated data/products/contradictory facts)
    const hasHighSeverityTruthfulness = truthfulnessIssues.some((i) => i.severity === 'high');
    // 4. Any dimension scoring below 50 (critical failure in a single dimension)
    const minDimensionScore = Math.min(
      compliance.score, quality.score, seo.score, brand.score,
      originality.score, platform_adaptation.score, readability.score,
      safety.score, truthfulness.score,
    );

    const passed =
      overallScore >= this.passThreshold &&
      !hasHighSeverityCompliance &&
      !hasHighSeverityPlatform &&
      !hasHighSeveritySafety &&
      !hasHighSeverityTruthfulness &&
      minDimensionScore >= 50;

    // Extract all unique suggestions
    const suggestionsSet = new Set<string>();
    for (const issue of allIssues) {
      if (issue.suggestion) {
        suggestionsSet.add(issue.suggestion);
      }
    }
    const suggestions = Array.from(suggestionsSet);

    // Compute content hash for tamper detection
    const contentHash = computeReviewHash({
      articleId: article.id,
      overallScore,
      passed,
      issuesCount: allIssues.length,
      reviewedAt: new Date().toISOString(),
    });

    return {
      articleId: article.id,
      round: article.generationRound,
      passed,
      overallScore,
      dimensions,
      issues: allIssues,
      suggestions,
      reviewedAt: new Date().toISOString(),
      contentHash,
    };
  }
}
