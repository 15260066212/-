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
  KnowledgeSource,
  AICard,
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

// === Profile types ===

export interface ProfileCredentialInfo {
  status: string;
  cookieCount: number;
  accountName: string;
  lastValidatedAt: string | null;
  brandId: number | null;
}

export interface ProfileInfo {
  platform: string;
  account: string;
  accountName: string;
  sizeBytes: number;
  sizeMB: number;
  profileDir?: string;
  createdAt?: string;
  updatedAt?: string;
  lastCheckedAt?: string | null;
  isLoggedIn?: boolean | null;
  credential?: ProfileCredentialInfo | null;
}

export interface ProfileHealthInfo {
  success: boolean;
  platform: string;
  account: string;
  loggedIn: boolean;
  url?: string;
  authCookies?: boolean;
  sizeBytes?: number;
  sizeMB?: number;
  error?: string;
}

export interface ProfileRenewResult {
  success: boolean;
  platform: string;
  account: string;
  loggedIn: boolean;
  error?: string;
}

// === Node Management types ===

export type NodeStatus = 'online' | 'offline' | 'deploying';

export interface NodeInfo {
  nodeId: string;
  name: string;
  endpoint: string;
  version: string;
  status: NodeStatus;
  tags: string[];
  platformCount: number;
  activeSessions: number;
  os: string;
  cpuCores: number;
  memoryMB: number;
  registeredAt: string;
  lastHeartbeatAt: string;
  lastDeployAt?: string;
  lastDeployStatus?: 'success' | 'failed';
  ipAddress?: string;
}

export type DeployTaskStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled';

export interface DeployTaskInfo {
  taskId: string;
  nodeId: string;
  targetVersion?: string;
  status: DeployTaskStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  error?: string;
}

export interface DeployBatchInfo {
  batchId: string;
  name: string;
  targetVersion?: string;
  nodeIds: string[];
  status: DeployTaskStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  createdBy?: string;
}

export interface RenewAllResult {
  success: boolean;
  total: number;
  renewed: number;
  stillLoggedIn: number;
  failed: number;
  results: Array<{
    platform: string;
    accountName: string;
    success: boolean;
    loggedIn: boolean;
    error?: string;
  }>;
}

// === 芯图EK · 企业知识库 ===

export interface EkCombination {
  key: string;
  /** 组合引用次数（仅统计审核通过的文章） */
  count: number;
  memberIds: string[];
  articles: Array<{
    id: string;
    title: string;
    platform: string;
    contentType: string;
    status: string;
    createdAt: string;
  }>;
}

export interface EkKnowledgeData {
  sessionId: string;
  enterprise: { fullName: string; shortName?: string };
  kbReady: boolean;
  l2Sources: KnowledgeSource[];
  aiCard: (AICard & { usageCount: number }) | null;
  combinations: EkCombination[];
  stats: {
    l2Count: number;
    l3Usage: number;
    combinationCount: number;
    totalCitations: number;
    maxUsage: number;
    minUsage: number;
    articleCount: number;
    approvedCount: number;
    untrackedArticles: number;
  };
  generatedAt: string;
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
 * 直接返回整个 JSON 响应，不经过 data 字段提取。
 * 用于那些返回格式不是 { success, data } 的 API（如直接代理 harvester 的 endpoints）。
 */
export async function requestRaw<T extends { success: boolean }>(
  path: string,
  options?: RequestInit,
): Promise<T> {
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

  const json = (await res.json()) as T;
  if (!res.ok || !json.success) {
    const err = (json as any).error ?? `Request failed (${res.status})`;
    throw new ApiError(err, res.status);
  }

  return json;
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

  importPpt: (id: string, file: File) => importDocumentFile(id, file, 'import-ppt'),

  importDocx: (id: string, file: File) => importDocumentFile(id, file, 'import-docx'),

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

  // 使用者在平台手动发布后，回到系统标记文章为已发布
  confirmPublished: (taskId: string, postUrl?: string) =>
    request<{ taskId: string; status: string; publishedAt: string; platformPostUrl?: string }>(
      `/publish/${encodeURIComponent(taskId)}/confirm-published`,
      {
        method: 'POST',
        body: JSON.stringify(postUrl ? { postUrl } : {}),
      },
    ),

  // 获取文章的发布任务列表
  fetchPublishTasks: (articleId: string) =>
    request<PublishTask[]>(`/publish?articleId=${encodeURIComponent(articleId)}`),

  deleteArticle: (id: string) =>
    request<void>(`/articles/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  // === 芯图EK · 企业知识库 ===

  getEkKnowledge: (sessionId: string) =>
    request<EkKnowledgeData>(`/knowledge/ek/${encodeURIComponent(sessionId)}`),

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

  // === Profiles (persistent browser profiles) ===

  listProfiles: () =>
    requestRaw<{ success: boolean; total: number; profiles: ProfileInfo[] }>('/profiles').then(
      (data) => data.profiles,
    ),

  checkProfileHealth: (platform: string, accountName: string) =>
    requestRaw<ProfileHealthInfo>(
      `/profiles/${encodeURIComponent(platform)}/${encodeURIComponent(accountName)}/health`,
    ),

  deleteProfile: (platform: string, accountName: string) =>
    requestRaw<{ success: boolean; deleted: boolean }>(
      `/profiles/${encodeURIComponent(platform)}/${encodeURIComponent(accountName)}`,
      { method: 'DELETE' },
    ),

  renewProfile: (platform: string, accountName: string) =>
    requestRaw<ProfileRenewResult>(
      `/profiles/${encodeURIComponent(platform)}/${encodeURIComponent(accountName)}/renew`,
      { method: 'POST' },
    ),

  renewAllProfiles: () =>
    requestRaw<RenewAllResult>('/profiles/renew-all', { method: 'POST' }),

  // === Node Management (cloud deployment) ===

  listNodes: () =>
    requestRaw<{ success: boolean; total: number; nodes: NodeInfo[] }>('/nodes').then((d) => d.nodes),

  getNodesSummary: () =>
    requestRaw<{ success: boolean; total: number; online: number; offline: number; deploying: number; totalPlatforms: number }>(
      '/nodes/summary',
    ),

  createDeployBatch: (nodeIds: string[], name?: string, targetVersion?: string) =>
    requestRaw<{ success: boolean; batch: DeployBatchInfo }>('/nodes/deploy/batch', {
      method: 'POST',
      body: JSON.stringify({ nodeIds, name, targetVersion }),
    }),

  listDeployBatches: (limit = 20) =>
    requestRaw<{ success: boolean; batches: DeployBatchInfo[] }>(`/nodes/deploy/batches?limit=${limit}`).then((d) => d.batches),

  getDeployBatch: (batchId: string) =>
    requestRaw<{ success: boolean; batch: DeployBatchInfo; tasks: DeployTaskInfo[] }>(`/nodes/deploy/batches/${batchId}`),

  cancelDeployBatch: (batchId: string) =>
    requestRaw<{ success: boolean }>(`/nodes/deploy/batches/${batchId}/cancel`, { method: 'POST' }),

  getDeployTaskLog: (taskId: string) =>
    requestRaw<{ success: boolean; taskId: string; status: string; log: string[] }>(`/nodes/deploy/tasks/${taskId}/log`),

  getNodeDeployHistory: (nodeId: string, limit = 10) =>
    requestRaw<{ success: boolean; tasks: DeployTaskInfo[] }>(`/nodes/${nodeId}/deploy/tasks?limit=${limit}`).then((d) => d.tasks),
};

function importDocumentFile(id: string, file: File, endpoint: string): Promise<ImportPptResponse> {
  const apiKey = getApiKey();
  const formData = new FormData();
  formData.append('file', file);
  return fetch(`${BASE_URL}/session/${id}/${endpoint}`, {
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
}
