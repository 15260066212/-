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
  waitForDraftSave: (
    articleId: string,
    timeoutMs?: number,
  ) => Promise<{ ok: boolean; error?: string; tasks: PublishTask[] }>;
  retryPublish: (taskId: string) => Promise<PublishTask>;
  confirmPublished: (articleId: string, postUrl?: string) => Promise<void>;
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
    return withLoading(set, 'actionLoading', 'error', '提交草稿箱失败', async () => {
      const tasks = await api.publishArticle(articleId);
      // 草稿优先模式：POST 只是提交任务，平台侧草稿尚未落盘，
      // 因此这里只标记为 publishing，等 waitForDraftSave 轮询到真实结果再改状态
      const { articles } = get();
      set({
        articles: articles.map((a) =>
          a.id === articleId ? { ...a, status: 'publishing' } : a,
        ),
      });
      return tasks;
    }, true) as Promise<PublishTask[]>;
  },

  waitForDraftSave: async (articleId: string, timeoutMs = 240000) => {
    const startedAt = Date.now();
    let tasks: PublishTask[] = [];
    while (Date.now() - startedAt < timeoutMs) {
      tasks = await api.fetchPublishTasks(articleId);
      const saved = tasks.find(
        (t) => t.status === 'draft_saved' || t.status === 'published',
      );
      if (saved) {
        const { articles } = get();
        set({
          articles: articles.map((a) =>
            a.id === articleId ? { ...a, status: 'draft_saved' } : a,
          ),
        });
        return { ok: true, tasks };
      }
      const failed = tasks.find((t) => t.status === 'failed');
      if (failed) {
        const { articles } = get();
        set({
          articles: articles.map((a) =>
            a.id === articleId ? { ...a, status: 'failed' } : a,
          ),
        });
        return {
          ok: false,
          error: failed.errorMessage ?? '平台未保存草稿，请重试',
          tasks,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    return {
      ok: false,
      error: '仍在处理中（超过等待时间），请稍后在「发布记录」查看最终结果',
      tasks,
    };
  },

  retryPublish: async (taskId: string) => {
    return withLoading(set, 'actionLoading', 'error', '重试保存草稿失败', async () => {
      const task = await api.retryPublish(taskId);
      return task;
    }, true) as Promise<PublishTask>;
  },

  // 使用者在平台手动发布后，回到系统标记文章为已发布
  confirmPublished: async (articleId: string, postUrl?: string) => {
    return withLoading(set, 'actionLoading', 'error', '标记已发布失败', async () => {
      // 先获取该文章的发布任务，找到 draft_saved 状态的任务
      const tasks = await api.fetchPublishTasks(articleId);
      const draftTask = tasks.find((t) => t.status === 'draft_saved') || tasks[0];
      if (!draftTask) {
        throw new Error('未找到该文章的发布任务');
      }
      await api.confirmPublished(draftTask.id, postUrl);
      const { articles } = get();
      set({
        articles: articles.map((a) =>
          a.id === articleId
            ? { ...a, status: 'published' as const, ...(postUrl ? { publishUrl: postUrl } : {}) }
            : a,
        ),
      });
    }, true) as Promise<void>;
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
