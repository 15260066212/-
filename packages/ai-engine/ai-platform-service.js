const MAINLAND_MONITORING_PLATFORMS = ['doubao', 'deepseek', 'hunyuan', 'qianwen', 'kimi'];
export class AIPlatformService {
    platforms;
    constructor() {
        this.platforms = {
            doubao: {
                name: '豆包',
                apiUrl: process.env.DOUBAO_API_URL || 'https://ark.cn-beijing.volces.com/api/v3/responses',
                apiKey: process.env.DOUBAO_API_KEY || '',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.DOUBAO_API_KEY || ''}` },
            },
            deepseek: {
                name: 'DeepSeek',
                apiUrl: process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions',
                apiKey: process.env.DEEPSEEK_API_KEY || '',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY || ''}` },
            },
            kimi: {
                name: 'Kimi',
                apiUrl: process.env.KIMI_API_URL || 'https://api.moonshot.cn/v1/chat/completions',
                apiKey: process.env.KIMI_API_KEY || '',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.KIMI_API_KEY || ''}` },
            },
            qianwen: {
                name: '千问',
                apiUrl: process.env.QIANWEN_API_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
                apiKey: process.env.QIANWEN_API_KEY || '',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.QIANWEN_API_KEY || ''}` },
            },
            hunyuan: {
                name: '混元',
                apiUrl: process.env.HUNYUAN_API_URL || 'https://tokenhub-intl.tencentmaas.com/v1/chat/completions',
                apiKey: process.env.HUNYUAN_API_KEY || '',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.HUNYUAN_API_KEY || ''}` },
            },
        };
    }
    getApiUrl(platform) {
        const cfg = this.platforms[platform];
        if (!cfg)
            return '';
        if (platform !== 'doubao')
            return cfg.apiUrl;
        const responsesUrl = process.env.DOUBAO_RESPONSES_API_URL?.trim();
        if (responsesUrl)
            return responsesUrl;
        return cfg.apiUrl.replace(/\/chat\/completions\/?$/i, '/responses');
    }
    getDoubaoResponsesModel() {
        return process.env.DOUBAO_RESPONSES_MODEL?.trim() || 'doubao-seed-1-6-250615';
    }
    getModelName(platform) {
        const defaults = {
            doubao: 'doubao-1-5-pro-32k-250115',
            deepseek: 'deepseek-chat',
            kimi: 'moonshot-v1-auto',
            qianwen: 'qwen-turbo',
            hunyuan: 'hy3-preview',
        };
        const key = `${platform.toUpperCase()}_MODEL`;
        return process.env[key]?.trim() || defaults[platform] || 'default';
    }
    getMaxTokens(platform) {
        const envKey = `${platform.toUpperCase()}_MAX_TOKENS`;
        const platformMax = parseInt(process.env[envKey] || '0', 10);
        if (platformMax > 0)
            return platformMax;
        const globalMax = parseInt(process.env.AI_MAX_TOKENS || '0', 10);
        if (globalMax > 0)
            return globalMax;
        return 4096;
    }
    buildRequestData(platform, question) {
        if (platform === 'doubao') {
            return {
                model: this.getDoubaoResponsesModel(),
                input: [{ role: 'user', content: [{ type: 'input_text', text: question }] }],
                temperature: 0.7,
                max_output_tokens: Math.max(this.getMaxTokens(platform), 16384),
            };
        }
        if (platform === 'deepseek') {
            return {
                model: this.getModelName(platform),
                messages: [{ role: 'user', content: question }],
                temperature: 0.7,
                max_tokens: this.getMaxTokens(platform),
                search: { enabled: true, depth: 'deep' },
            };
        }
        if (platform === 'qianwen') {
            return {
                model: this.getModelName(platform),
                messages: [{ role: 'user', content: question }],
                temperature: 0.7,
                max_tokens: this.getMaxTokens(platform),
                enable_search: true,
            };
        }
        if (platform === 'kimi') {
            return {
                model: this.getModelName(platform),
                messages: [{ role: 'user', content: question }],
                temperature: 0.7,
                max_tokens: this.getMaxTokens(platform),
                use_search: true,
            };
        }
        if (platform === 'hunyuan') {
            return {
                model: this.getModelName(platform),
                messages: [{ role: 'user', content: question }],
                temperature: 0.7,
                max_tokens: this.getMaxTokens(platform),
                enable_enhancement: true,
            };
        }
        return {
            model: this.getModelName(platform),
            messages: [{ role: 'user', content: question }],
            temperature: 0.7,
            max_tokens: this.getMaxTokens(platform),
        };
    }
    getAvailablePlatforms() {
        return MAINLAND_MONITORING_PLATFORMS.filter((p) => this.platforms[p]?.apiKey);
    }
    async queryPlatform(platform, question) {
        const cfg = this.platforms[platform];
        if (!cfg)
            return { success: false, error: `不支持的AI平台: ${platform}`, platform };
        if (!cfg.apiKey)
            return { success: false, error: `${cfg.name} API密钥未配置`, platform };
        const requestData = this.buildRequestData(platform, question);
        const requestUrl = this.getApiUrl(platform);
        const MAX_ATTEMPTS = 4;
        let lastError = null;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
                const startedAt = Date.now();
                const headers = { ...cfg.headers, Accept: 'application/json' };
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 180000);
                const response = await fetch(requestUrl, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(requestData),
                    signal: controller.signal,
                });
                clearTimeout(timeoutId);
                const responseTime = Math.max(0, Date.now() - startedAt);
                if (!response.ok) {
                    const errText = await response.text().catch(() => '');
                    throw { code: `HTTP_${response.status}`, message: `HTTP ${response.status}`, response: { status: response.status, data: errText } };
                }
                const data = await response.json();
                return { success: true, data, platform, responseTime };
            }
            catch (error) {
                lastError = error;
                const code = error.code || '';
                const status = error.response?.status;
                const retryable = code === 'ECONNABORTED' || code === 'ENOTFOUND' || code === 'ECONNRESET' || status === 429 || (status && status >= 500);
                if (attempt < MAX_ATTEMPTS && retryable) {
                    const baseDelay = Math.min(5000, 1000 * Math.pow(2, attempt));
                    const jitter = Math.floor(Math.random() * 500);
                    await new Promise((r) => setTimeout(r, baseDelay + jitter));
                    continue;
                }
                return { success: false, error: `[${platform}] ${code} ${error.message}${status ? ` (status ${status})` : ''}`, platform };
            }
        }
        return { success: false, error: lastError?.message || '未知错误', platform };
    }
    async queryMultiplePlatforms(platforms, question) {
        const results = await Promise.allSettled(platforms.map((p) => this.queryPlatform(p, question)));
        return results.map((r, i) => (r.status === 'fulfilled' ? r.value : { success: false, error: r.reason?.message, platform: platforms[i] }));
    }
}
export const aiPlatformService = new AIPlatformService();
//# sourceMappingURL=ai-platform-service.js.map