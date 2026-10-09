import { useEffect } from 'react';
import { useArticleStore } from '../stores/articleStore.js';
import { ArticleList } from '../components/articles/ArticleList.js';
import { ArticleDetail } from '../components/articles/ArticleDetail.js';

interface Props {
  sessionId: string;
}

export function ContentPage({ sessionId }: Props) {
  const { fetchArticles, error, clearError, loading } = useArticleStore();

  useEffect(() => {
    fetchArticles(sessionId);
  }, [sessionId, fetchArticles]);

  return (
    <div className="h-full flex flex-col">
      {/* 顶部错误信息 */}
      {error && (
        <div className="bg-error-bg border-b border-error/30 px-4 py-2">
          <div className="flex items-center justify-between">
            <div className="text-sm text-error">
              <span className="font-medium">错误：</span>
              {error}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => fetchArticles(sessionId)}
                disabled={loading}
                className="text-xs text-error/90 underline underline-offset-2 disabled:opacity-50"
              >
                重试
              </button>
              <button
                onClick={clearError}
                className="text-xs text-error/90 underline underline-offset-2"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 左右布局：文章列表 + 文章详情 */}
      <div className="flex-1 flex overflow-hidden">
        <ArticleList />
        <ArticleDetail />
      </div>
    </div>
  );
}
