// Multi-provider AI client supporting OpenAI, DeepSeek, Doubao, and ERNIE (Wenxin Yiyan).
// All providers use OpenAI-compatible Chat Completions API format.
let proxyDispatcher = null;
function getProxyUrl() {
    return (process.env.HTTPS_PROXY ||
        process.env.https_proxy ||
        process.env.HTTP_PROXY ||
        process.env.http_proxy ||
        null);
}
async function ensureProxy() {
    if (proxyDispatcher)
        return;
    const proxyUrl = getProxyUrl();
    if (!proxyUrl)
        return;
    try {
        const undici = await import('undici');
        const ProxyAgent = undici.ProxyAgent;
        proxyDispatcher = new ProxyAgent(proxyUrl);
        const setGlobalDispatcher = undici.setGlobalDispatcher;
        setGlobalDispatcher(proxyDispatcher);
    }
    catch {
        // undici not available, fetch will work without proxy
    }
}
function getProviderConfig() {
    const provider = (process.env.AI_PROVIDER || 'openai');
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
                model: process.env.DOUBAO_MODEL || 'doubao-pro-32k',
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
function hasUsableApiKey(apiKey) {
    return Boolean(apiKey) && !/^sk-your-api-key-here$/i.test(apiKey);
}
export function isAIAvailable() {
    const config = getProviderConfig();
    return hasUsableApiKey(config.apiKey);
}
export function getActiveModel() {
    return getProviderConfig().model;
}
export function getActiveProvider() {
    return getProviderConfig().provider;
}
/**
 * Unified chat completion function supporting multiple AI providers.
 * Uses OpenAI-compatible Chat Completions API for all providers.
 * For OpenAI, also tries the Responses API first (supports gpt-5.x models).
 */
export async function chatCompletion(systemPrompt, userMessage, options) {
    const config = getProviderConfig();
    if (!hasUsableApiKey(config.apiKey)) {
        const envVarMap = {
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
                const data = await res.json();
                if (data.output_text)
                    return data.output_text;
                const msg = data.output?.find((o) => o.content?.some((c) => c.type === 'output_text'));
                const text = msg?.content?.find((c) => c.type === 'output_text')?.text;
                if (text)
                    return text;
            }
            if (res.status !== 400) {
                const errText = await res.text();
                throw new Error(`Responses API error (${res.status}): ${errText}`);
            }
        }
        catch (err) {
            if (err instanceof TypeError)
                throw err;
        }
    }
    // Chat Completions API (all providers)
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
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
}
//# sourceMappingURL=client.js.map