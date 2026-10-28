import type { DB } from '../db.js';
import type { ReviewResult, ReviewIssue } from '@zemingengine/shared';

export class ReviewRepository {
  constructor(private db: DB) {}

  insertReview(review: ReviewResult): string {
    const id = `rev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const stmt = this.db.prepare(`
      INSERT INTO reviews (
        id, article_id, round, passed, overall_score,
        compliance_score, quality_score, seo_score, brand_score,
        originality_score, platform_adaptation_score, readability_score,
        safety_score, truthfulness_score, content_hash,
        issues, suggestions, reviewed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id, review.articleId, review.round, review.passed ? 1 : 0,
      review.overallScore, review.dimensions.compliance.score,
      review.dimensions.quality.score, review.dimensions.seo.score,
      review.dimensions.brand.score,
      review.dimensions.originality?.score ?? 100,
      review.dimensions.platform_adaptation?.score ?? 100,
      review.dimensions.readability?.score ?? 100,
      review.dimensions.safety?.score ?? 100,
      review.dimensions.truthfulness?.score ?? 100,
      review.contentHash ?? null,
      JSON.stringify(review.issues),
      JSON.stringify(review.suggestions), review.reviewedAt
    );

    // Record audit entry
    this.recordReviewAudit(id, review.articleId, review.passed ? 'passed' : 'failed', 'system',
      `Score: ${review.overallScore}, Round: ${review.round}`);

    return id;
  }

  getReviewsByArticle(articleId: string): ReviewResult[] {
    const rows = this.db.prepare('SELECT * FROM reviews WHERE article_id = ? ORDER BY round ASC').all(articleId) as Record<string, unknown>[];
    return rows.map((r) => this.mapReview(r));
  }

  getLatestReview(articleId: string): ReviewResult | undefined {
    const row = this.db.prepare('SELECT * FROM reviews WHERE article_id = ? ORDER BY round DESC LIMIT 1').get(articleId) as Record<string, unknown> | undefined;
    return row ? this.mapReview(row) : undefined;
  }

  private mapReview(row: Record<string, unknown>): ReviewResult {
    const issues: ReviewIssue[] = JSON.parse(String(row.issues));
    // Reconstruct dimension-level issues by filtering the full issues array
    const filterByDim = (dim: string) => issues.filter((i) => i.dimension === dim);
    return {
      articleId: String(row.article_id),
      round: Number(row.round),
      passed: Boolean(row.passed),
      overallScore: Number(row.overall_score),
      dimensions: {
        compliance: { score: Number(row.compliance_score), issues: filterByDim('compliance') },
        quality: { score: Number(row.quality_score), issues: filterByDim('quality') },
        seo: { score: Number(row.seo_score), issues: filterByDim('seo') },
        brand: { score: Number(row.brand_score), issues: filterByDim('brand') },
        originality: { score: Number(row.originality_score ?? 100), issues: filterByDim('originality') },
        platform_adaptation: { score: Number(row.platform_adaptation_score ?? 100), issues: filterByDim('platform_adaptation') },
        readability: { score: Number(row.readability_score ?? 100), issues: filterByDim('readability') },
        safety: { score: Number(row.safety_score ?? 100), issues: filterByDim('safety') },
        truthfulness: { score: Number(row.truthfulness_score ?? 100), issues: filterByDim('truthfulness') },
      },
      issues,
      suggestions: JSON.parse(String(row.suggestions)),
      reviewedAt: String(row.reviewed_at),
      contentHash: row.content_hash ? String(row.content_hash) : undefined,
    };
  }

  /** Get dimension scores from recent reviews for health monitoring. */
  getReviewDimensionStats(limit: number = 100): Array<Record<string, number>> {
    const safeLimit = Math.max(1, Math.floor(limit));
    return this.db.prepare(
      `SELECT overall_score, compliance_score, quality_score, seo_score, brand_score,
              originality_score, platform_adaptation_score, readability_score, safety_score,
              truthfulness_score, passed, content_hash
       FROM reviews ORDER BY reviewed_at DESC LIMIT ?`,
    ).all(safeLimit) as Array<Record<string, number>>;
  }

  /** Get review safety statistics (hash coverage, publish protection). */
  getReviewSafetyStats(): {
    totalReviews: number;
    reviewsWithHash: number;
    hashCoverage: number;
    publishedArticles: number;
    publishedWithReview: number;
  } {
    const total = this.db.prepare('SELECT COUNT(*) as count FROM reviews').get() as { count: number };
    const withHash = this.db.prepare('SELECT COUNT(*) as count FROM reviews WHERE content_hash IS NOT NULL').get() as { count: number };
    const published = this.db.prepare("SELECT COUNT(*) as count FROM articles WHERE status = 'published'").get() as { count: number };
    const publishedReviewed = this.db.prepare(
      `SELECT COUNT(DISTINCT a.id) as count FROM articles a
       INNER JOIN reviews r ON a.id = r.article_id
       WHERE a.status = 'published' AND r.passed = 1`,
    ).get() as { count: number };

    return {
      totalReviews: total.count,
      reviewsWithHash: withHash.count,
      hashCoverage: total.count > 0 ? Math.round((withHash.count / total.count) * 1000) / 10 : 0,
      publishedArticles: published.count,
      publishedWithReview: publishedReviewed.count,
    };
  }

  /** Record a review audit event. */
  recordReviewAudit(reviewId: string, articleId: string, action: string, actor: string = 'system', details?: string): void {
    this.db.prepare(
      `INSERT INTO review_audit_log (review_id, article_id, action, actor, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(reviewId, articleId, action, actor, details ?? null, Date.now());
  }

  /** Get audit trail for an article. */
  getReviewAuditTrail(articleId: string, limit: number = 50): Array<{
    id: number;
    reviewId: string;
    articleId: string;
    action: string;
    actor: string;
    details: string | null;
    createdAt: number;
  }> {
    const safeLimit = Math.max(1, Math.floor(limit));
    const rows = this.db.prepare(
      `SELECT id, review_id, article_id, action, actor, details, created_at
       FROM review_audit_log WHERE article_id = ?
       ORDER BY created_at DESC LIMIT ?`,
    ).all(articleId, safeLimit) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: Number(r.id),
      reviewId: String(r.review_id),
      articleId: String(r.article_id),
      action: String(r.action),
      actor: String(r.actor),
      details: r.details ? String(r.details) : null,
      createdAt: Number(r.created_at),
    }));
  }

  /** Check if an article has a passing review (rollback protection). */
  hasPassingReview(articleId: string): boolean {
    const row = this.db.prepare(
      'SELECT 1 FROM reviews WHERE article_id = ? AND passed = 1 ORDER BY round DESC, reviewed_at DESC LIMIT 1',
    ).get(articleId);
    return !!row;
  }

  /** Get latest review status for an article (for publish guard). */
  getLatestReviewStatus(articleId: string): { passed: boolean; overallScore: number; round: number } | null {
    const row = this.db.prepare(
      'SELECT passed, overall_score, round FROM reviews WHERE article_id = ? ORDER BY round DESC, reviewed_at DESC LIMIT 1',
    ).get(articleId) as { passed: number; overall_score: number; round: number } | undefined;
    if (!row) return null;
    return { passed: Boolean(row.passed), overallScore: Number(row.overall_score), round: Number(row.round) };
  }
}
