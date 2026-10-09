import { create } from 'zustand';
import type {
  Article,
  GenerateArticleRequest,
  GenerateArticleResponse,
  PublishTask,
  ReviewResult,
} from '@zemingengine/shared';
import { api, request, withLoading } from '../hooks/useApi.js';

interface ArticleStore {
  // State
  articles: Article[];
  selectedArticleId: string | null;
  /** 当前选中文章的最新审核结果 */
  review: ReviewResult | null;
  /** 当前选中文章的全部审核记录 */
  reviews: ReviewResult[];
  loading: boolean;
  actionLoading: boolean;
  error: string | null;

  // Actions
  fetchArticles: (sessionId?: string) => Promise<void>;
  selectArticle: (id: string) => void;
  generateArticle: (req: GenerateArticleRequest) => Promise<GenerateArticleResponse>;
  fetchReview: (articleId: string) => Promise<void>;
  fetchReviews: (articleId: string) => Promise<void>;
  reviewArticle: (articleId: string) => Promise<ReviewResult>;
  publishArticle: (articleId: string) => Promise<PublishTask[]>;
  retryPublish: (taskId: string) => Promise<PublishTask>;
  deleteArticle: (id: string) => Promise<void>;
  clearError: () => void;
}

export const useArticleStore = create<ArticleStore>((set, get) => ({
  articles: [],
  selectedArticleId: null,
  review: null,
  reviews: [],
  loading: false,
  actionLoading: false,
  error: null,

  fetchArticles: async (sessionId?: string) => {
    await withLoading(set, 'loading', 'error', '获取文章列表失败', async () => {
      const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
      const articles = await request<Article[]>(`/articles${query}`);
      set({ articles });

      // 若当前选中的文章不在列表中，则自动选中第一篇
      const { selectedArticleId } = get();
      if (!selectedArticleId || !articles.some((a) => a.id === selectedArticleId)) {
        set({ selectedArticleId: articles.length > 0 ? articles[0].id : null });
      }
    });
  },

  selectArticle: (id: string) => {
    set({ selectedArticleId: id, review: null, reviews: [] });
  },

  generateArticle: async (req: GenerateArticleRequest) => {
    return withLoading(set, 'loading', 'error', '生成文章失败', async () => {
      const result = await request<GenerateArticleResponse>('/articles/generate', {
        method: 'POST',
        body: JSON.stringify(req),
      });

      // 将新生成的文章加入列表并选中，同时记录自动审核结果
      const { articles } = get();
      set({
        articles: [result.article, ...articles],
        selectedArticleId: result.article.id,
        review: result.review,
        reviews: [result.review],
      });

      return result;
    }, true) as Promise<GenerateArticleResponse>;
  },

  fetchReview: async (articleId: string) => {
    set({ loading: true, error: null });
    try {
      const review = await api.fetchReview(articleId);
      set({ review, loading: false });
    } catch (err) {
      // 文章尚未审核时后端返回 404，视为正常状态（无审核结果），不作为错误抛出
      const message = err instanceof Error ? err.message : '';
      if (/not found/i.test(message)) {
        set({ review: null, loading: false });
      } else {
        set({
          error: message || '获取审核结果失败',
          review: null,
          loading: false,
        });
      }
    }
  },

  fetchReviews: async (articleId: string) => {
    await withLoading(set, 'loading', 'error', '获取审核记录失败', async () => {
      const reviews = await api.fetchReviews(articleId);
      set({ reviews });
    });
  },

  reviewArticle: async (articleId: string) => {
    return withLoading(set, 'actionLoading', 'error', '重新审核失败', async () => {
      const review = await api.reviewArticle(articleId);
      const { reviews } = get();
      set({
        review,
        reviews: [...reviews, review],
      });
      // 审核通过后后端会将文章状态置为 approved，同步更新列表中的状态
      if (review.passed) {
        const { articles } = get();
        set({
          articles: articles.map((a) =>
            a.id === articleId ? { ...a, status: 'approved' } : a,
          ),
        });
      }
      return review;
    }, true) as Promise<ReviewResult>;
  },

  publishArticle: async (articleId: string) => {
    return withLoading(set, 'actionLoading', 'error', '发布文章失败', async () => {
      const tasks = await api.publishArticle(articleId);
      // 发布后文章状态变为 publishing，同步更新列表
      const { articles } = get();
      set({
        articles: articles.map((a) =>
          a.id === articleId ? { ...a, status: 'publishing' } : a,
        ),
      });
      return tasks;
    }, true) as Promise<PublishTask[]>;
  },

  retryPublish: async (taskId: string) => {
    return withLoading(set, 'actionLoading', 'error', '重试发布失败', async () => {
      const task = await api.retryPublish(taskId);
      return task;
    }, true) as Promise<PublishTask>;
  },

  deleteArticle: async (id: string) => {
    return withLoading(set, 'actionLoading', 'error', '删除文章失败', async () => {
      await api.deleteArticle(id);
      const { articles, selectedArticleId } = get();
      const remaining = articles.filter((a) => a.id !== id);
      set({
        articles: remaining,
        // 删除当前选中文章时，自动选中第一篇并清空审核结果
        selectedArticleId:
          selectedArticleId === id
            ? remaining.length > 0
              ? remaining[0].id
              : null
            : selectedArticleId,
        review: selectedArticleId === id ? null : get().review,
        reviews: selectedArticleId === id ? [] : get().reviews,
      });
    }, true) as Promise<void>;
  },

  clearError: () => set({ error: null }),
}));
