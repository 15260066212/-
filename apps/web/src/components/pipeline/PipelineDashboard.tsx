import { usePipelineStore } from '../../stores/pipelineStore.js';
import type { PlatformId, ArticleStatus } from '@zemingengine/shared';
import { ArticleStatusBadge } from '../articles/ArticleStatusBadge.js';
import { Loader2, Inbox } from 'lucide-react';

interface Props {
  sessionId: string;
}

const PLATFORM_LABELS: Record<string, string> = {
  weixin: '微信公众号',
  zhihu: '知乎',
  baijia: '百家号',
  toutiao: '今日头条',
  csdn: 'CSDN',
  juejin: '掘金',
  bilibili: '哔哩哔哩',
  sohu: '搜狐号',
  netease: '网易号',
  zhidao: '百度知道',
  deepseek: 'DeepSeek',
  kimi: 'Kimi',
  doubao: '豆包',
  yuanbao: '元宝',
  qianwen: '千问',
};

const STATUS_CARDS: { key: keyof StatusCounts; label: string; color: string; pulse?: boolean }[] = [
  { key: 'draft', label: '草稿', color: 'text-foreground/70' },
  { key: 'reviewing', label: '审核中', color: 'text-warning', pulse: true },
  { key: 'approved', label: '已通过', color: 'text-primary' },
  { key: 'publishing', label: '发布中', color: 'text-purple-600', pulse: true },
  { key: 'published', label: '已发布', color: 'text-success' },
  { key: 'failed', label: '失败', color: 'text-error' },
];

interface StatusCounts {
  draft: number;
  reviewing: number;
  approved: number;
  publishing: number;
  published: number;
  failed: number;
}

export function PipelineDashboard({ sessionId: _sessionId }: Props) {
  const { status, loading, isRunning } = usePipelineStore();

  if (loading && !status) {
    return (
      <div className="bg-card rounded-xl border border-border p-8 text-center text-sm text-muted-foreground/70 shadow-card">
        <Loader2 className="w-5 h-5 animate-spin text-primary mx-auto mb-2" />
        正在加载流水线状态...
      </div>
    );
  }

  if (!status) {
    return (
      <div className="bg-card rounded-xl border border-border p-8 text-center text-sm text-muted-foreground/70 shadow-card">
        <Inbox className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
        暂无流水线数据，请在上方启动流水线
      </div>
    );
  }

  const counts: StatusCounts = {
    draft: status.draft,
    reviewing: status.reviewing,
    approved: status.approved,
    publishing: status.publishing,
    published: status.published,
    failed: status.failed,
  };

  return (
    <div className="space-y-4">
      {/* 状态计数卡片 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        {STATUS_CARDS.map((card) => {
          const value = counts[card.key];
          const isActive = card.pulse && value > 0 && isRunning;
          return (
            <div
              key={card.key}
              className={`bg-card rounded-xl border p-4 text-center shadow-card transition-colors ${
                isActive ? `border-${card.color.replace('text-', '')}/30` : 'border-border'
              }`}
            >
              <div className={`text-2xl font-bold tabular-nums ${card.color} ${isActive ? 'animate-pulse' : ''}`}>
                {value}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{card.label}</div>
            </div>
          );
        })}
      </div>

      {/* 总数 + 进度百分比 */}
      <div className="flex items-center justify-between bg-card rounded-xl border border-border px-5 py-3 shadow-card">
        <span className="text-sm text-foreground/70">文章总数</span>
        <div className="flex items-center gap-3">
          {status.totalArticles > 0 && (
            <span className="text-xs text-muted-foreground">
              {status.published + status.failed}/{status.totalArticles} 已处理
            </span>
          )}
          <span className="text-lg font-bold text-foreground tabular-nums">{status.totalArticles}</span>
        </div>
      </div>

      {/* 文章进度列表 */}
      <div className="bg-card rounded-xl border border-border shadow-card">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">文章进度</h3>
          {isRunning && (
            <span className="flex items-center gap-1.5 text-xs text-primary">
              <Loader2 className="w-3 h-3 animate-spin" />
              实时更新中
            </span>
          )}
        </div>

        {status.articles.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground/70">
            {isRunning ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                <span>正在生成文章，请稍候...</span>
              </div>
            ) : (
              <span>暂无文章</span>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-border/50">
            {status.articles.map((article) => {
              const isActive = (article.status === 'draft' || article.status === 'reviewing' || article.status === 'publishing') && isRunning;
              return (
                <li key={article.id} className={`px-4 py-3 flex items-center gap-3 ${isActive ? 'bg-primary/5' : ''}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs text-muted-foreground">
                        {PLATFORM_LABELS[article.platform] ?? article.platform}
                      </span>
                      <ArticleStatusBadge status={article.status as ArticleStatus} />
                    </div>
                    <div className="text-sm text-foreground truncate">
                      {article.title || '(未命名文章)'}
                    </div>
                    <div className="text-xs text-muted-foreground/70 mt-0.5">
                      创建于 {new Date(article.createdAt).toLocaleString('zh-CN')}
                      {article.reviewScore !== undefined && (
                        <span className="ml-2">
                          审核分：<span className="text-foreground/70">{article.reviewScore}</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {isActive && (
                    <Loader2 className="w-4 h-4 text-primary animate-spin flex-shrink-0" />
                  )}

                  {article.publishUrl && (
                    <a
                      href={article.publishUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-primary hover:bg-primary/10 transition-colors"
                    >
                      查看发布
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
