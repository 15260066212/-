/**
 * Shared summary generation for analysis results.
 * Both website analysis and PPT analysis produce structurally identical
 * profile summaries — this module centralizes the formatting logic.
 */

/** Fields needed to generate a profile summary. */
export interface SummaryFields {
  fullName?: string;
  shortName?: string;
  description?: string;
  scale?: string;
  location?: string;
  products: string[];
  trustAnchors: string[];
  brandTone: string[];
  keywords: ({ question: string } | string)[];
}

/**
 * Build the common profile summary lines (without header/footer).
 * Each line is conditionally added based on whether the field is present.
 */
export function buildProfileSummaryLines(fields: SummaryFields): string[] {
  const lines: string[] = [];

  if (fields.fullName) {
    lines.push(`📌 企业名称：${fields.fullName}${fields.shortName ? `（${fields.shortName}）` : ''}`);
  }
  if (fields.description) lines.push(`📝 业务描述：${fields.description}`);
  if (fields.scale) lines.push(`👥 公司规模：${fields.scale}`);
  if (fields.location) lines.push(`📍 所在地：${fields.location}`);
  if (fields.products.length > 0) lines.push(`🎯 核心产品：${fields.products.join('、')}`);
  if (fields.trustAnchors.length > 0) lines.push(`🏆 信任锚点：${fields.trustAnchors.join('、')}`);
  if (fields.brandTone.length > 0) lines.push(`🎨 品牌调性：${fields.brandTone.join('、')}`);
  if (fields.keywords.length > 0) {
    const kwDisplay = fields.keywords
      .slice(0, 5)
      .map((kw) => (typeof kw === 'object' ? kw.question : String(kw)))
      .join('、');
    lines.push(`🔑 核心关键词：${kwDisplay}`);
  }

  return lines;
}
