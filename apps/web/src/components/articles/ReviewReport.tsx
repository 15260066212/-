import type {
  ReviewResult,
  ReviewDimension,
  IssueSeverity,
} from '@zemingengine/shared';

interface Props {
  review: ReviewResult;
}

const DIMENSION_LABELS: Record<ReviewDimension, string> = {
  compliance: '合规性',
  quality: '内容质量',
  seo: 'SEO 优化',
  brand: '品牌一致性',
  originality: '文内重复度',
  platform_adaptation: '平台适配',
  readability: '可读性',
  safety: '安全性',
  truthfulness: '真实性',
};

const DIMENSION_ORDER: ReviewDimension[] = [
  'compliance',
  'quality',
  'seo',
  'brand',
  'originality',
  'platform_adaptation',
  'readability',
  'safety',
  'truthfulness',
];

const SEVERITY_CONFIG: Record<IssueSeverity, { label: string; className: string }> = {
  high: { label: '严重', className: 'bg-red-100 text-red-700' },
  medium: { label: '中等', className: 'bg-yellow-100 text-yellow-700' },
  low: { label: '轻微', className: 'bg-gray-100 text-gray-600' },
};

function scoreColor(score: number): string {
  if (score >= 80) return 'bg-green-500';
  if (score >= 60) return 'bg-yellow-500';
  return 'bg-red-500';
}

function scoreTextColor(score: number): string {
  if (score >= 80) return 'text-green-600';
  if (score >= 60) return 'text-yellow-600';
  return 'text-red-600';
}

export function ReviewReport({ review }: Props) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-5">
      {/* 头部：总分 + 通过状态 */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-gray-700 mb-1">审核报告</h3>
          <p className="text-xs text-gray-400">
            第 {review.round} 轮审核 ·{' '}
            {new Date(review.reviewedAt).toLocaleString('zh-CN')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className={`text-2xl font-bold ${scoreTextColor(review.overallScore)}`}>
              {review.overallScore}
            </div>
            <div className="text-xs text-gray-400">综合得分</div>
          </div>
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${
              review.passed
                ? 'bg-green-100 text-green-700'
                : 'bg-red-100 text-red-700'
            }`}
          >
            {review.passed ? '通过' : '未通过'}
          </span>
        </div>
      </div>

      {/* 维度得分 */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          维度评分
        </h4>
        <div className="space-y-2.5">
          {DIMENSION_ORDER.map((dim) => {
            const result = review.dimensions[dim];
            const score = result?.score ?? 0;
            return (
              <div key={dim}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-gray-700">
                    {DIMENSION_LABELS[dim]}
                  </span>
                  <span className={`text-sm font-medium ${scoreTextColor(score)}`}>
                    {score}
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${scoreColor(score)}`}
                    style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 问题列表 */}
      {review.issues.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            问题列表 ({review.issues.length})
          </h4>
          <ul className="space-y-2">
            {review.issues.map((issue, i) => {
              const sev = SEVERITY_CONFIG[issue.severity];
              return (
                <li
                  key={i}
                  className="rounded-md border border-gray-200 bg-gray-50 p-3"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${sev.className}`}
                    >
                      {sev.label}
                    </span>
                    <span className="text-xs text-gray-400">
                      {DIMENSION_LABELS[issue.dimension]}
                    </span>
                    {issue.location && (
                      <span className="text-xs text-gray-400">
                        · {issue.location}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-800">{issue.description}</p>
                  {issue.suggestion && (
                    <p className="mt-1 text-xs text-gray-500">
                      建议：{issue.suggestion}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* 优化建议 */}
      {review.suggestions.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            优化建议
          </h4>
          <ul className="space-y-1.5">
            {review.suggestions.map((suggestion, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                <span className="mt-0.5 inline-flex h-4 w-4 flex-none items-center justify-center rounded-full bg-blue-100 text-xs font-medium text-blue-700">
                  {i + 1}
                </span>
                <span className="leading-relaxed">{suggestion}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 既无问题也无建议时的友好提示 */}
      {review.issues.length === 0 && review.suggestions.length === 0 && (
        <div className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-700">
          未发现明显问题，内容质量良好。
        </div>
      )}
    </div>
  );
}
