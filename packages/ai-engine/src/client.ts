// Multi-provider AI client supporting OpenAI, DeepSeek, Doubao, and ERNIE (Wenxin Yiyan).
// All providers use OpenAI-compatible Chat Completions API format.

let proxyDispatcher: { dispatch: (opts: unknown, handler: unknown) => void } | null = null;

function getProxyUrl(): string | null {
  return (
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    null
  );
}

async function ensureProxy(): Promise<void> {
  if (proxyDispatcher) return;
  const proxyUrl = getProxyUrl();
  if (!proxyUrl) return;
  try {
    const undici = await import('undici');
    const ProxyAgent = (undici as unknown as { ProxyAgent: new (url: string) => { dispatch: (opts: unknown, handler: unknown) => void } }).ProxyAgent;
    proxyDispatcher = new ProxyAgent(proxyUrl);
    const setGlobalDispatcher = (undici as unknown as { setGlobalDispatcher: (agent: unknown) => void }).setGlobalDispatcher;
    setGlobalDispatcher(proxyDispatcher);
  } catch {
    // undici not available, fetch will work without proxy
  }
}

// === Provider configuration ===

export type ModelProvider = 'openai' | 'deepseek' | 'doubao' | 'ernie';

export interface ProviderConfig {
  provider: ModelProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Doubao Flex tier mode (only for doubao provider). */
  flexMode?: 'always' | 'auto' | 'never';
  /** Doubao Flex max server-side wait timeout in ms. */
  flexMaxWaitMs?: number;
}

function getProviderConfig(): ProviderConfig {
  const provider = (process.env.AI_PROVIDER || 'openai') as ModelProvider;

  switch (provider) {
    case 'deepseek':
      return {
        provider: 'deepseek',
        apiKey: process.env.DEEPSEEK_API_KEY?.trim() ?? '',
        baseUrl: (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/+$/, ''),
        model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      };
    case 'doubao':
      return {
        provider: 'doubao',
        apiKey: process.env.DOUBAO_API_KEY?.trim() ?? '',
        baseUrl: (process.env.DOUBAO_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, ''),
        // Doubao Seed 2.1 Pro (2026-09): production-grade reasoning model
        // Replaces the older doubao-pro-32k model
        model: process.env.DOUBAO_MODEL || 'doubao-seed-2-1-pro-260915',
        // Doubao Flex (low-priority) tier: "always" | "auto" | "never"
        // See: https://ark.volcengine.com/region:cn-beijing/docs/online-inference-flex
        flexMode: (process.env.DOUBAO_FLEX_MODE?.trim().toLowerCase() || 'never') as 'always' | 'auto' | 'never',
        flexMaxWaitMs: parseInt(process.env.DOUBAO_FLEX_MAX_WAIT_MS || '0', 10) || 300_000,
      };
    case 'ernie':
      return {
        provider: 'ernie',
        apiKey: process.env.ERNIE_API_KEY?.trim() ?? '',
        baseUrl: (process.env.ERNIE_BASE_URL || 'https://qianfan.baidubce.com/v1').replace(/\/+$/, ''),
        model: process.env.ERNIE_MODEL || 'ernie-4.0-8k',
      };
    case 'openai':
    default:
      return {
        provider: 'openai',
        apiKey: process.env.OPENAI_API_KEY?.trim() ?? '',
        baseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      };
  }
}

function hasUsableApiKey(apiKey: string): boolean {
  return Boolean(apiKey) && !/^sk-your-api-key-here$/i.test(apiKey);
}

export function isAIAvailable(): boolean {
  const config = getProviderConfig();
  return hasUsableApiKey(config.apiKey);
}

export function getActiveModel(): string {
  return getProviderConfig().model;
}

export function getActiveProvider(): ModelProvider {
  return getProviderConfig().provider;
}

export interface ChatCompletionOptions {
  temperature?: number;
  maxTokens?: number;
}

/**
 * 模型输出因 max_tokens 用尽被截断时抛出。
 * 调用方据此区分「模型不可用」与「预算不足」，避免截断被静默当作 JSON 解析失败。
 */
export class AIResponseTruncatedError extends Error {
  constructor(
    readonly model: string,
    readonly maxTokens: number,
    readonly finishReason: string,
  ) {
    super(`AI response truncated by max_tokens (model=${model}, max_tokens=${maxTokens}, finish_reason=${finishReason})`);
    this.name = 'AIResponseTruncatedError';
  }
}

/** 截断后自动放大预算的上限，防止无限重试 */
const MAX_TOKEN_ESCALATION_CAP = 16384;

/**
 * Unified chat completion function supporting multiple AI providers.
 * Uses OpenAI-compatible Chat Completions API for all providers.
 * For OpenAI, also tries the Responses API first (supports gpt-5.x models).
 */
export async function chatCompletion(
  systemPrompt: string,
  userMessage: string,
  options?: ChatCompletionOptions,
): Promise<string> {
  const config = getProviderConfig();
  if (!hasUsableApiKey(config.apiKey)) {
    const envVarMap: Record<ModelProvider, string> = {
      openai: 'OPENAI_API_KEY',
      deepseek: 'DEEPSEEK_API_KEY',
      doubao: 'DOUBAO_API_KEY',
      ernie: 'ERNIE_API_KEY',
    };
    throw new Error(`${envVarMap[config.provider]} environment variable is required`);
  }

  await ensureProxy();

  const temperature = options?.temperature ?? 0.7;
  let maxTokens = options?.maxTokens ?? 1024;

  // OpenAI: try Responses API first for gpt-5.x models
  if (config.provider === 'openai') {
    const responsesResult = await tryOpenAIResponsesApi(config, systemPrompt, userMessage, temperature, maxTokens);
    if (responsesResult.ok) return responsesResult.text;
  }

  // Chat Completions API (all providers).
  // 推理型模型的 reasoning_tokens 与正文共享 max_tokens 配额，长 JSON 容易在末尾被截断。
  // 检测到 finish_reason=length 时放大预算重试一次，仍不足则抛出明确错误。
  for (;;) {
    const { text, finishReason } = await fetchChatCompletions(
      config, systemPrompt, userMessage, temperature, maxTokens,
    );
    if (finishReason !== 'length') return text;

    const escalated = Math.min(maxTokens * 2, MAX_TOKEN_ESCALATION_CAP);
    if (escalated <= maxTokens) {
      throw new AIResponseTruncatedError(config.model, maxTokens, finishReason);
    }
    console.warn(
      `[ai-engine] 模型输出被 max_tokens 截断 (model=${config.model}, max_tokens=${maxTokens})，提升至 ${escalated} 重试`,
    );
    maxTokens = escalated;
  }
}

/**
 * Try OpenAI Responses API (used by gpt-5.x models).
 * Returns { ok: true, text } on success, { ok: false } when falling back to Chat Completions.
 */
async function tryOpenAIResponsesApi(
  config: ProviderConfig,
  systemPrompt: string,
  userMessage: string,
  temperature: number,
  maxTokens: number,
): Promise<{ ok: true; text: string } | { ok: false }> {
  try {
    const res = await fetch(`${config.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        input: userMessage,
        instructions: systemPrompt,
        temperature,
        max_output_tokens: maxTokens,
        store: false,
      }),
    });

    if (res.ok) {
      const data = await res.json() as {
        output?: Array<{
          content?: Array<{ type: string; text?: string }>;
        }>;
        output_text?: string;
      };
      if (data.output_text) return { ok: true, text: data.output_text };
      const msg = data.output?.find((o) => o.content?.some((c) => c.type === 'output_text'));
      const text = msg?.content?.find((c) => c.type === 'output_text')?.text;
      if (text) return { ok: true, text };
    }

    // Status 400 means the model doesn't support Responses API — fall back silently
    if (res.status !== 400) {
      const errText = await res.text();
      throw new Error(`Responses API error (${res.status}): ${errText}`);
    }
  } catch (err) {
    if (err instanceof TypeError) throw err;
  }
  return { ok: false };
}

/**
 * Call the Chat Completions API (works for all providers).
 */
async function fetchChatCompletions(
  config: ProviderConfig,
  systemPrompt: string,
  userMessage: string,
  temperature: number,
  maxTokens: number,
): Promise<{ text: string; finishReason: string | null }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.apiKey}`,
  };

  // Doubao Flex low-priority tier: add service_tier to body and timeout header
  // See: https://ark.volcengine.com/region:cn-beijing/docs/online-inference-flex
  const isDoubaoFlex = config.provider === 'doubao' && config.flexMode === 'always';
  if (isDoubaoFlex && config.flexMaxWaitMs) {
    headers['X-Ark-Max-Wait-Timeout-Ms'] = String(config.flexMaxWaitMs);
  }

  const body: Record<string, unknown> = {
    model: config.model,
    temperature,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  };
  if (isDoubaoFlex) {
    body.service_tier = 'flex';
  }

  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Chat Completions API error (${res.status}): ${errText}`);
  }

  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string | null }>;
  };
  const choice = data.choices?.[0];
  return {
    text: choice?.message?.content ?? '',
    finishReason: choice?.finish_reason ?? null,
  };
}
