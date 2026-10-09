import type {
  ApiResponse,
  BackResponse,
  CreateSessionResponse,
  GetSessionResponse,
  ManualResponse,
  MonitorOverview,
  ArticleChartdata,
  PublishChartdata,
  ReviewChartdata,
  PublishFailureAnalysis,
  PlatformCredentials,
  PlatformId,
  ProfileReviewRequest,
  ProfileReviewResponse,
  PublishTask,
  ReviewResult,
  ScrapeSessionResponse,
  SendMessageResponse,
  ImportPptResponse,
} from '@zemingengine/shared';

export interface SessionListItem {
  id: string;
  stage: string;
  enterpriseName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiInfo {
  available: boolean;
  provider: string;
  model: string;
}

const BASE_URL = '/api';

/** API 业务错误（后端返回 success:false 或 HTTP 错误），区别于网络错误 */
export class ApiError extends Error {
  public readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function getApiKey(): string | null {
  try {
    const raw = localStorage.getItem('geo_auth_user');
    if (!raw) return null;
    const user = JSON.parse(raw);
    return user?.apiKey ?? null;
  } catch {
    return null;
  }
}

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const apiKey = getApiKey();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['x-api-key'] = apiKey;

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: { ...headers, ...(options?.headers as Record<string, string>) },
    });
  } catch {
    throw new Error('无法连接后端服务，请确认 API 服务已启动');
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new ApiError(
      `API 返回异常响应 (${res.status})，请检查前端代理和后端端口配置`,
      res.status,
    );
  }

  const json = (await res.json()) as ApiResponse<T>;
  if (!res.ok || !json.success) {
    throw new ApiError(json.error ?? `Request failed (${res.status})`, res.status);
  }

  return json.data as T;
}

/**
 * 封装 "设置 loading → 执行异步任务 → 捕获错误 → 重置 loading" 的通用模式。
 *
 * @param set       - Zustand set 函数
 * @param loadingKey - loading 状态字段名
 * @param errorKey   - error 状态字段名
 * @param errorMsg   - 默认错误消息（当错误对象没有 message 时使用）
 * @param task       - 异步任务函数，内部可自行调用 set 更新其他状态
 * @param rethrow    - 捕获错误后是否重新抛出（默认 false）
 * @returns 任务成功时返回任务结果；失败时若 rethrow=false 则返回 undefined
 */
export async function withLoading<T extends object, LK extends keyof T, EK extends keyof T, R>(
  set: (partial: Partial<T>) => void,
  loadingKey: LK,
  errorKey: EK,
  errorMsg: string,
  task: () => Promise<R>,
  rethrow = false,
): Promise<R | undefined> {
  set({ [loadingKey]: true, [errorKey]: null } as unknown as Partial<T>);
  try {
    const result = await task();
    set({ [loadingKey]: false } as unknown as Partial<T>);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : errorMsg;
    set({
      [errorKey]: message as unknown as T[EK],
      [loadingKey]: false as unknown as T[LK],
    } as unknown as Partial<T>);
    if (rethrow) throw err;
    return undefined;
  }
}

export const api = {
  createSession: () =>
    request<CreateSessionResponse>('/session', {
      method: 'POST',
    }),

  getSession: (id: string) =>
    request<GetSessionResponse>(`/session/${id}`),

  sendMessage: (id: string, text: string) =>
    request<SendMessageResponse>(`/session/${id}/message`, { method: 'POST', body: JSON.stringify({ text }) }),

  scrapeUrl: (id: string, url: string) =>
    request<ScrapeSessionResponse>(`/session/${id}/scrape`, {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),

  importPpt: (id: string, file: File) => {
    const apiKey = getApiKey();
    const formData = new FormData();
    formData.append('file', file);
    return fetch(`${BASE_URL}/session/${id}/import-ppt`, {
      method: 'POST',
      headers: {
        ...(apiKey ? { 'x-api-key': apiKey } : {}),
      },
      body: formData,
    }).then(async (res) => {
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? `Request failed (${res.status})`);
      }
      return json.data as ImportPptResponse;
    });
  },

  confirmProfileReview: (id: string, payload: ProfileReviewRequest) =>
    request<ProfileReviewResponse>(`/session/${id}/profile-review`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  goBack: (id: string) =>
    request<BackResponse>(`/session/${id}/back`, {
      method: 'POST',
    }),

  getManual: (id: string) =>
    request<ManualResponse>(`/session/${id}/manual`),

  getManualDownloadUrl: (id: string, format: 'markdown' | 'html' = 'markdown'): string => {
    return `${BASE_URL}/session/${id}/manual/download?format=${format}`;
  },

  listSessions: () =>
    request<SessionListItem[]>('/session'),

  loadSession: (id: string) =>
    request<GetSessionResponse>(`/session/${id}`),

  deleteSession: (id: string) =>
    request<void>(`/session/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  // === Article actions ===

  publishArticle: (articleId: string) =>
    request<PublishTask[]>('/publish', {
      method: 'POST',
      body: JSON.stringify({ articleId }),
    }),

  fetchReview: (articleId: string) =>
    request<ReviewResult>(`/reviews/${encodeURIComponent(articleId)}/latest`),

  fetchReviews: (articleId: string) =>
    request<ReviewResult[]>(`/reviews/${encodeURIComponent(articleId)}`),

  // 重新审核：触发后端对文章生成新一轮审核结果
  reviewArticle: (articleId: string) =>
    request<ReviewResult>(`/reviews/${encodeURIComponent(articleId)}`, {
      method: 'POST',
    }),

  retryPublish: (taskId: string) =>
    request<PublishTask>(`/publish/${encodeURIComponent(taskId)}/retry`, {
      method: 'POST',
    }),

  deleteArticle: (id: string) =>
    request<void>(`/articles/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  // === Credentials ===

  fetchCredentials: () =>
    request<PlatformCredentials[]>('/credentials'),

  saveCredential: (platform: PlatformId, credential: PlatformCredentials) =>
    request<PlatformCredentials>(`/credentials/${encodeURIComponent(platform)}`, {
      method: 'PUT',
      body: JSON.stringify(credential),
    }),

  deleteCredential: (platform: PlatformId) =>
    request<{ deleted: boolean }>(`/credentials/${encodeURIComponent(platform)}`, {
      method: 'DELETE',
    }),

  validateCredential: (platform: PlatformId) =>
    request<{ valid: boolean; status: PlatformCredentials['status']; lastValidatedAt: string }>(
      `/credentials/${encodeURIComponent(platform)}/validate`,
      { method: 'POST' },
    ),

  // === Monitor ===

  getMonitorOverview: () =>
    request<MonitorOverview>('/monitor/overview'),

  getArticleCharts: () =>
    request<ArticleChartdata>('/monitor/charts/articles'),

  getPublishCharts: () =>
    request<PublishChartdata>('/monitor/charts/publish'),

  getReviewCharts: () =>
    request<ReviewChartdata>('/monitor/charts/reviews'),

  getPublishFailures: () =>
    request<PublishFailureAnalysis>('/monitor/charts/publish-failures'),

  getAiInfo: () =>
    request<AiInfo>('/monitor/ai-info'),
};
