import { useArticleStore } from '../../stores/articleStore.js';
import type { PlatformId } from '@zemingengine/shared';
import { ArticleStatusBadge } from './ArticleStatusBadge.js';
import { ExternalLink, AlertTriangle, CheckCircle2 } from 'lucide-react';

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

export function ArticleList() {
  const { articles, selectedArticleId, selectArticle, loading } = useArticleStore();

  return (
    <div className="w-80 border-r border-border bg-card flex flex-col shadow-card">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground">
          文章列表
          {articles.length > 0 && (
            <span className="ml-2 text-xs text-muted-foreground/70">({articles.length})</span>
          )}
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && articles.length === 0 && (
          <div className="p-4 text-center text-sm text-muted-foreground/70">加载中...</div>
        )}

        {!loading && articles.length === 0 && (
          <div className="p-4 text-center text-sm text-muted-foreground/70">
            暂无文章，生成后将显示在此处
          </div>
        )}

        <ul className="divide-y divide-border/50">
          {articles.map((article) => {
            const isSelected = article.id === selectedArticleId;
            return (
              <li key={article.id}>
                <button
                  onClick={() => selectArticle(article.id)}
                  className={`w-full text-left px-4 py-3 transition-colors ${
                    isSelected
                      ? 'bg-primary/10 border-l-2 border-primary'
                      : 'hover:bg-muted/50 border-l-2 border-transparent'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-muted-foreground">
                      {PLATFORM_LABELS[article.platform] ?? article.platform}
                    </span>
                    <div className="flex items-center gap-1">
                      {article.status === 'published' && article.publishUrl && (
                        <a
                          href={article.publishUrl}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center text-xs text-blue-600 hover:text-blue-700 hover:underline"
                          title="查看发布文章"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                      <ArticleStatusBadge status={article.status} />
                    </div>
                  </div>
                  <div className="text-sm text-foreground line-clamp-2 mb-1">
                    {article.title || '(未命名文章)'}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground/70">
                    <span>{article.wordCount} 字</span>
                    {(article as any).reviewRound > 0 && (
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        (article as any).reviewRound >= 3
                          ? 'bg-orange-100 text-orange-700'
                          : 'bg-blue-50 text-blue-600'
                      }`}>
                        审核 {(article as any).reviewRound}/3
                      </span>
                    )}
                    {(article as any).generationMeta?.model === 'fallback-template-v2' ? (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-orange-600" title="文章未由 DeepSeek API 生成">
                        <AlertTriangle className="w-2.5 h-2.5" />
                        模板生成
                      </span>
                    ) : (article as any).generationMeta?.model ? (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-green-600" title="文章由 DeepSeek API 生成">
                        <CheckCircle2 className="w-2.5 h-2.5" />
                        AI生成
                      </span>
                    ) : null}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
