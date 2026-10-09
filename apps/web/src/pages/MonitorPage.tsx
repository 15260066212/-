import { useEffect, useState } from 'react';
import { api } from '../hooks/useApi.js';
import type { AiInfo } from '../hooks/useApi.js';
import type {
  MonitorOverview,
  ArticleChartdata,
  PublishChartdata,
  ReviewChartdata,
  PublishFailureAnalysis,
  PublishLog,
} from '@zemingengine/shared';

const REFRESH_INTERVAL_MS = 30000;

export function MonitorPage() {
  const [overview, setOverview] = useState<MonitorOverview | null>(null);
  const [articleCharts, setArticleCharts] = useState<ArticleChartdata | null>(null);
  const [publishCharts, setPublishCharts] = useState<PublishChartdata | null>(null);
  const [reviewCharts, setReviewCharts] = useState<ReviewChartdata | null>(null);
  const [failureAnalysis, setFailureAnalysis] = useState<PublishFailureAnalysis | null>(null);
  const [aiInfo, setAiInfo] = useState<AiInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAll = async () => {
    try {
      const [ov, ac, pc, rc, fa, ai] = await Promise.all([
        api.getMonitorOverview(),
        api.getArticleCharts(),
        api.getPublishCharts(),
        api.getReviewCharts(),
        api.getPublishFailures(),
        api.getAiInfo(),
      ]);
      setOverview(ov);
      setArticleCharts(ac);
      setPublishCharts(pc);
      setReviewCharts(rc);
      setFailureAnalysis(fa);
      setAiInfo(ai);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载监控数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchAll();
    const timer = setInterval(() => {
      void fetchAll();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  if (loading && !overview) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-muted-foreground">正在加载监控数据...</div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 max-w-none space-y-4">
        {/* 顶部错误信息 */}
        {error && (
          <div className="rounded-xl border border-error/30 bg-error-bg px-4 py-3 shadow-card">
            <div className="flex items-start justify-between">
              <div className="text-sm text-error">
                <span className="font-medium">错误：</span>
                {error}
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => void fetchAll()}
                  className="text-xs text-error underline underline-offset-2"
                >
                  重试
                </button>
                <button
                  onClick={() => setError(null)}
                  className="text-xs text-error underline underline-offset-2"
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 顶部卡片行：总数概览 */}
        {overview && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <OverviewCard
              label="文章总数"
              value={overview.articles.total}
              accent="blue"
              sub={`已发布 ${overview.articles.published} · 草稿 ${overview.articles.draft}`}
            />
            <OverviewCard
              label="发布任务"
              value={overview.publishTasks.total}
              accent="green"
              sub={`成功 ${overview.publishTasks.published} · 失败 ${overview.publishTasks.failed}`}
            />
            <OverviewCard
              label="会话数"
              value={overview.sessions.total}
              accent="purple"
              sub="配置会话总数"
            />
            <OverviewCard
              label="流水线"
              value={overview.pipelineRuns.total}
              accent="orange"
              sub={`运行中 ${overview.pipelineRuns.running} · 完成 ${overview.pipelineRuns.completed}`}
            />
          </div>
        )}

        {/* 中间图表区 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* 文章创建趋势 */}
          <div className="bg-card rounded-xl border border-border p-4 shadow-card">
            <h3 className="text-sm font-semibold text-foreground/90 mb-3">文章创建趋势（最近 30 天）</h3>
            <TimelineBarChart data={articleCharts?.timeline ?? []} />
          </div>

          {/* 发布成功率 */}
          <div className="bg-card rounded-xl border border-border p-4 shadow-card">
            <h3 className="text-sm font-semibold text-foreground/90 mb-3">发布成功率</h3>
            <SuccessRateBar
              rate={publishCharts?.successRate ?? 0}
              published={overview?.publishTasks.published ?? 0}
              failed={overview?.publishTasks.failed ?? 0}
            />
          </div>
        </div>

        {/* 审核统计 */}
        {reviewCharts && (
          <div className="bg-card rounded-xl border border-border p-4 shadow-card">
            <h3 className="text-sm font-semibold text-foreground/90 mb-3">审核统计</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-foreground">
                  {reviewCharts.averageScore.toFixed(1)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">平均分</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-success">
                  {reviewCharts.passRate.toFixed(1)}%
                </div>
                <div className="text-xs text-muted-foreground mt-1">通过率</div>
              </div>
              <div className="text-center">
                <ScoreDistributionMini data={reviewCharts.scoreDistribution} />
              </div>
            </div>
          </div>
        )}

        {/* 各平台发布统计 */}
        <div className="bg-card rounded-xl border border-border p-4 shadow-card">
          <h3 className="text-sm font-semibold text-foreground/90 mb-3">各平台发布统计</h3>
          <PlatformPublishTable data={publishCharts?.byPlatform ?? []} />
        </div>

        {/* AI模型信息 + 发布失败分析 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* AI模型信息 */}
          <div className="bg-card rounded-xl border border-border p-4 shadow-card">
            <h3 className="text-sm font-semibold text-foreground/90 mb-3">AI 引擎状态</h3>
            <AiInfoCard data={aiInfo} />
          </div>

          {/* 失败类型分布 */}
          <div className="bg-card rounded-xl border border-border p-4 shadow-card">
            <h3 className="text-sm font-semibold text-foreground/90 mb-3">发布失败类型分布</h3>
            <FailureTypeChart data={failureAnalysis?.byFailureType ?? []} totalFailures={failureAnalysis?.totalFailures ?? 0} />
          </div>

          {/* Top 错误 */}
          <div className="bg-card rounded-xl border border-border p-4 shadow-card">
            <h3 className="text-sm font-semibold text-foreground/90 mb-3">高频错误 Top 10</h3>
            <TopErrorsList data={failureAnalysis?.topErrors ?? []} />
          </div>
        </div>

        {/* 成功率趋势 */}
        {failureAnalysis && failureAnalysis.successRateTrend.length > 0 && (
          <div className="bg-card rounded-xl border border-border p-4 shadow-card">
            <h3 className="text-sm font-semibold text-foreground/90 mb-3">发布成功率趋势（最近 30 天）</h3>
            <SuccessRateTrendChart data={failureAnalysis.successRateTrend} overallRate={failureAnalysis.overallSuccessRate} />
          </div>
        )}

        {/* 底部：最近发布日志 */}
        <div className="bg-card rounded-xl border border-border p-4 shadow-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground/90">最近发布日志</h3>
            <span className="text-xs text-muted-foreground/70">每 30 秒自动刷新</span>
          </div>
          <RecentLogsTable logs={overview?.recentLogs ?? []} />
        </div>
      </div>
    </div>
  );
}

// === Sub components ===

type AccentColor = 'blue' | 'green' | 'purple' | 'orange';

const ACCENT_CLASSES: Record<AccentColor, { bar: string; text: string }> = {
  blue: { bar: 'bg-primary', text: 'text-primary' },
  green: { bar: 'bg-success', text: 'text-success' },
  purple: { bar: 'bg-primary', text: 'text-primary' },
  orange: { bar: 'bg-warning', text: 'text-warning' },
};

function OverviewCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: number;
  sub: string;
  accent: AccentColor;
}) {
  const colors = ACCENT_CLASSES[accent];
  return (
    <div className="bg-card rounded-xl border border-border p-4 shadow-card">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className={`inline-block w-2 h-2 rounded-full ${colors.bar}`} />
      </div>
      <div className={`text-3xl font-bold mt-2 ${colors.text}`}>{value}</div>
      <div className="text-xs text-muted-foreground/70 mt-1">{sub}</div>
    </div>
  );
}

function TimelineBarChart({ data }: { data: { date: string; count: number }[] }) {
  if (data.length === 0) {
    return <div className="text-sm text-muted-foreground/70 py-8 text-center">暂无数据</div>;
  }
  const maxCount = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="flex items-end gap-1 h-40 overflow-x-auto">
      {data.map((d) => {
        const heightPct = (d.count / maxCount) * 100;
        return (
          <div
            key={d.date}
            className="flex flex-col items-center justify-end flex-shrink-0 group relative"
            style={{ minWidth: '20px' }}
          >
            <div className="text-[10px] text-muted-foreground mb-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {d.count}
            </div>
            <div
              className="w-3 sm:w-4 bg-primary/70 hover:bg-primary rounded-t transition-colors"
              style={{ height: `${Math.max(heightPct, 2)}%` }}
              title={`${d.date}: ${d.count} 篇`}
            />
            <div className="text-[9px] text-muted-foreground/70 mt-1 rotate-45 origin-left whitespace-nowrap">
              {d.date.slice(5)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SuccessRateBar({
  rate,
  published,
  failed,
}: {
  rate: number;
  published: number;
  failed: number;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <span className="text-3xl font-bold text-foreground">{rate.toFixed(1)}%</span>
        <span className="text-sm text-muted-foreground">
          成功 {published} · 失败 {failed}
        </span>
      </div>
      <div className="w-full bg-muted rounded-full h-4 overflow-hidden">
        <div
          className="bg-success h-4 rounded-full transition-all duration-500"
          style={{ width: `${rate}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground/70">
        <span>0%</span>
        <span>50%</span>
        <span>100%</span>
      </div>
    </div>
  );
}

function ScoreDistributionMini({ data }: { data: { range: string; count: number }[] }) {
  const maxCount = Math.max(...data.map((d) => d.count), 1);
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-2">分数段分布</div>
      <div className="flex items-end gap-1 h-16 justify-center">
        {data.map((d) => (
          <div key={d.range} className="flex flex-col items-center" title={`${d.range}: ${d.count}`}>
            <div className="text-[10px] text-muted-foreground">{d.count}</div>
            <div
              className="w-6 bg-primary/70 rounded-t"
              style={{ height: `${Math.max((d.count / maxCount) * 40, 2)}px` }}
            />
            <div className="text-[9px] text-muted-foreground/70 mt-1">{d.range}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlatformPublishTable({
  data,
}: {
  data: { platform: string; total: number; published: number; failed: number }[];
}) {
  if (data.length === 0) {
    return <div className="text-sm text-muted-foreground/70 py-4 text-center">暂无数据</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-muted-foreground text-left">
            <th className="py-2 px-3 font-medium">平台</th>
            <th className="py-2 px-3 font-medium text-right">总任务</th>
            <th className="py-2 px-3 font-medium text-right">已发布</th>
            <th className="py-2 px-3 font-medium text-right">失败</th>
            <th className="py-2 px-3 font-medium text-right">成功率</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => {
            const rate =
              row.total > 0 ? Math.round((row.published / row.total) * 1000) / 10 : 0;
            return (
              <tr key={row.platform} className="border-b border-border/50 hover:bg-muted/50">
                <td className="py-2 px-3 font-medium text-foreground/90">{row.platform}</td>
                <td className="py-2 px-3 text-right text-foreground/70">{row.total}</td>
                <td className="py-2 px-3 text-right text-success">{row.published}</td>
                <td className="py-2 px-3 text-right text-error">{row.failed}</td>
                <td className="py-2 px-3 text-right text-foreground/90">{rate}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const LEVEL_STYLES: Record<PublishLog['level'], string> = {
  info: 'bg-primary/10 text-primary/90',
  warn: 'bg-warning-bg text-warning',
  error: 'bg-error-bg text-error',
};

function RecentLogsTable({ logs }: { logs: PublishLog[] }) {
  if (logs.length === 0) {
    return <div className="text-sm text-muted-foreground/70 py-4 text-center">暂无日志</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-muted-foreground text-left">
            <th className="py-2 px-3 font-medium">时间</th>
            <th className="py-2 px-3 font-medium">任务 ID</th>
            <th className="py-2 px-3 font-medium">级别</th>
            <th className="py-2 px-3 font-medium">消息</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id} className="border-b border-border/50 hover:bg-muted/50">
              <td className="py-2 px-3 text-muted-foreground whitespace-nowrap">
                {formatTime(log.createdAt)}
              </td>
              <td className="py-2 px-3 text-foreground/70 font-mono text-xs">{log.taskId}</td>
              <td className="py-2 px-3">
                <span
                  className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${LEVEL_STYLES[log.level]}`}
                >
                  {log.level}
                </span>
              </td>
              <td className="py-2 px-3 text-foreground/90">{log.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const FAILURE_TYPE_COLORS: Record<string, string> = {
  network: 'bg-primary',
  auth: 'bg-warning',
  rate_limit: 'bg-warning',
  content: 'bg-primary',
  platform: 'bg-error',
  unknown: 'bg-muted-foreground/50',
};

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  doubao: '豆包',
  ernie: '文心一言',
};

function AiInfoCard({ data }: { data: AiInfo | null }) {
  if (!data) {
    return <div className="text-sm text-muted-foreground/70 py-4 text-center">加载中...</div>;
  }
  const providerLabel = PROVIDER_LABELS[data.provider] ?? data.provider;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">状态</span>
        <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${data.available ? 'text-success' : 'text-error'}`}>
          <span className={`inline-block w-2 h-2 rounded-full ${data.available ? 'bg-success' : 'bg-error'}`} />
          {data.available ? '已启用' : '未启用'}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">模型提供商</span>
        <span className="text-sm font-medium text-foreground/90">{providerLabel}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">模型名称</span>
        <span className="text-sm font-mono text-foreground/90">{data.model}</span>
      </div>
    </div>
  );
}

function FailureTypeChart({
  data,
  totalFailures,
}: {
  data: { type: string; category: string; count: number; percentage: number }[];
  totalFailures: number;
}) {
  if (data.length === 0) {
    return <div className="text-sm text-muted-foreground/70 py-4 text-center">暂无失败记录</div>;
  }
  return (
    <div className="space-y-2">
      {data.map((item) => (
        <div key={item.type} className="flex items-center gap-2">
          <div className="w-20 text-xs text-foreground/70 text-right shrink-0">{item.category}</div>
          <div className="flex-1 bg-muted rounded-full h-6 overflow-hidden">
            <div
              className={`${FAILURE_TYPE_COLORS[item.type] ?? 'bg-muted-foreground/50'} h-6 rounded-full transition-all duration-500 flex items-center justify-end px-2`}
              style={{ width: `${Math.max(item.percentage, 5)}%` }}
            >
              <span className="text-[10px] text-white font-medium">{item.percentage.toFixed(0)}%</span>
            </div>
          </div>
          <div className="w-8 text-xs text-muted-foreground shrink-0 text-right">{item.count}</div>
        </div>
      ))}
      <div className="pt-2 border-t border-border/50 text-xs text-muted-foreground/70">
        总失败数：{totalFailures}
      </div>
    </div>
  );
}

function TopErrorsList({
  data,
}: {
  data: { error: string; count: number; type: string }[];
}) {
  if (data.length === 0) {
    return <div className="text-sm text-muted-foreground/70 py-4 text-center">暂无错误记录</div>;
  }
  return (
    <div className="space-y-2 max-h-48 overflow-y-auto">
      {data.map((item, idx) => (
        <div key={idx} className="flex items-start gap-2">
          <span className={`inline-block w-2 h-2 rounded-full mt-1.5 shrink-0 ${FAILURE_TYPE_COLORS[item.type] ?? 'bg-muted-foreground/50'}`} />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-foreground/90 truncate" title={item.error}>
              {item.error}
            </div>
            <div className="text-[10px] text-muted-foreground/70">
              {item.count} 次 · {item.type}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function SuccessRateTrendChart({
  data,
  overallRate,
}: {
  data: { date: string; total: number; published: number; failed: number; successRate: number }[];
  overallRate: number;
}) {
  const maxBars = data.length;
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <span className="text-2xl font-bold text-foreground">{overallRate.toFixed(1)}%</span>
        <span className="text-xs text-muted-foreground">整体成功率</span>
      </div>
      <div className="flex items-end gap-1 h-32 overflow-x-auto">
        {data.map((d) => {
          const heightPct = d.total > 0 ? (d.successRate / 100) * 100 : 0;
          const barColor = d.successRate >= 80 ? 'bg-success' : d.successRate >= 50 ? 'bg-warning' : 'bg-error';
          return (
            <div
              key={d.date}
              className="flex flex-col items-center justify-end flex-shrink-0 group relative"
              style={{ minWidth: '16px' }}
            >
              <div className="text-[9px] text-muted-foreground mb-1 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                {d.successRate.toFixed(0)}%
              </div>
              <div
                className={`w-2.5 ${barColor} rounded-t transition-colors`}
                style={{ height: `${Math.max(heightPct, 2)}%` }}
                title={`${d.date}: ${d.successRate.toFixed(1)}% (${d.published}/${d.total})`}
              />
              <div className="text-[8px] text-muted-foreground/70 mt-1 rotate-45 origin-left whitespace-nowrap">
                {d.date.slice(5)}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground/70">
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded bg-success" /> ≥80%</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded bg-warning" /> 50-80%</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded bg-error" /> &lt;50%</span>
      </div>
    </div>
  );
}
