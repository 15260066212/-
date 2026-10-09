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
  const maxTokens = options?.maxTokens ?? 1024;

  // OpenAI: try Responses API first for gpt-5.x models
  if (config.provider === 'openai') {
    const responsesResult = await tryOpenAIResponsesApi(config, systemPrompt, userMessage, temperature, maxTokens);
    if (responsesResult.ok) return responsesResult.text;
  }

  // Chat Completions API (all providers)
  return fetchChatCompletions(config, systemPrompt, userMessage, temperature, maxTokens);
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
): Promise<string> {
  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Chat Completions API error (${res.status}): ${errText}`);
  }

  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? '';
}
