const MAINLAND_MONITORING_PLATFORMS = ['doubao', 'deepseek', 'hunyuan', 'qianwen', 'kimi'];

/** Default max tokens for AI responses when no platform-specific override exists. */
const DEFAULT_MAX_TOKENS = 4096;

/** Default request timeout in milliseconds (3 minutes). */
const REQUEST_TIMEOUT_MS = 180_000;

/** Maximum retry delay cap in milliseconds (exponential backoff ceiling). */
const MAX_RETRY_DELAY_MS = 5000;

/** Minimum output tokens enforced for Doubao Responses API (large-context model). */
const DOUBAO_MIN_OUTPUT_TOKENS = 16_384;

/** Default sampling temperature across all platforms. */
const DEFAULT_TEMPERATURE = 0.7;

/** Maximum number of retry attempts for transient failures. */
const MAX_RETRY_ATTEMPTS = 4;

/** Base retry delay in milliseconds for exponential backoff. */
const BASE_RETRY_DELAY_MS = 1000;

/** Maximum jitter added to retry delay in milliseconds. */
const RETRY_JITTER_MAX_MS = 500;

interface PlatformConfig {
  name: string;
  apiUrl: string;
  apiKey: string;
  headers: Record<string, string>;
}

interface QueryResult {
  success: boolean;
  data?: any;
  error?: string;
  platform: string;
  responseTime?: number;
}

export class AIPlatformService {
  platforms: Record<string, PlatformConfig>;

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

  getApiUrl(platform: string): string {
    const cfg = this.platforms[platform];
    if (!cfg) return '';
    if (platform !== 'doubao') return cfg.apiUrl;
    const responsesUrl = process.env.DOUBAO_RESPONSES_API_URL?.trim();
    if (responsesUrl) return responsesUrl;
    return cfg.apiUrl.replace(/\/chat\/completions\/?$/i, '/responses');
  }

  getDoubaoResponsesModel(): string {
    return process.env.DOUBAO_RESPONSES_MODEL?.trim() || 'doubao-seed-2-1-pro-260915';
  }

  /**
   * Whether to enable Doubao Web Search tool in Responses API.
   * Uses the "doubao" search source (Custom Edition) for higher quality results.
   * Default: true — Doubao Custom Edition search provides the best Chinese-language
   * source coverage for GEO monitoring (60-85% ByteDance ecosystem citations).
   * See: https://docs.volcengine.com/docs/82379/1756990
   */
  isDoubaoWebSearchEnabled(): boolean {
    const val = process.env.DOUBAO_WEB_SEARCH_ENABLED?.trim().toLowerCase();
    return val !== 'false';
  }

  /**
   * Time range for Doubao web search results (freshness control).
   * Doubao weights content from the last 1-2 weeks most heavily; citation rates
   * drop sharply after 1 month. Default: "1m" (1 month). Options: "1d","1w","1m","6m","1y".
   * See: https://www.volcengine.com/docs/87772/2272953
   */
  getDoubaoSearchTimeRange(): string {
    return process.env.DOUBAO_SEARCH_TIME_RANGE?.trim() || '1m';
  }

  /**
   * Authority level filter for Doubao web search (source credibility grading).
   * L1=非常权威 (gov/央媒/985大学/500强/字节高质量)
   * L2=正常权威 (行业垂直站点/综合平台)
   * L3=一般权威 (普通网站)
   * L4=一般不权威 (内容农场/SEO灌水站)
   * Default: "2" (L1-L2 only) to filter out low-quality content farms.
   * See: https://www.volcengine.com/docs/87772/2518319
   */
  getDoubaoSearchAuthLevel(): number {
    const val = parseInt(process.env.DOUBAO_SEARCH_AUTH_LEVEL?.trim() || '2', 10);
    return Math.min(Math.max(val, 1), 4);
  }

  getModelName(platform: string): string {
    const defaults: Record<string, string> = {
      // Doubao Seed 2.1 Pro (2026-09): production-grade reasoning model with 1M context
      // See model release notes: https://docs.volcengine.com/docs/82379/1159178
      doubao: 'doubao-seed-2-1-pro-260915',
      deepseek: 'deepseek-chat',
      // Kimi K3 (2026-07): flagship model with 1M token context, moonshot-v1 series retired in Aug 2026
      // See: https://platform.kimi.ai/docs/platform-changelog
      kimi: 'kimi-k3',
      qianwen: 'qwen-turbo',
      // Hunyuan Hy3 (GA): hy3-preview auto-routed to Hy3 since 2026-07-24
      // See: https://cloud.tencent.com/announce/detail/2384
      hunyuan: 'hy3',
    };
    const key = `${platform.toUpperCase()}_MODEL`;
    return process.env[key]?.trim() || defaults[platform] || 'default';
  }

  getMaxTokens(platform: string): number {
    const envKey = `${platform.toUpperCase()}_MAX_TOKENS`;
    const platformMax = parseInt(process.env[envKey] || '0', 10);
    if (platformMax > 0) return platformMax;
    const globalMax = parseInt(process.env.AI_MAX_TOKENS || '0', 10);
    if (globalMax > 0) return globalMax;
    return DEFAULT_MAX_TOKENS;
  }

  buildRequestData(platform: string, question: string): any {
    switch (platform) {
      case 'doubao':
        return this.buildDoubaoRequest(question);
      case 'deepseek':
        return this.buildDeepSeekRequest(platform, question);
      case 'qianwen':
        return this.buildQianwenRequest(platform, question);
      case 'kimi':
        return this.buildKimiRequest(platform, question);
      case 'hunyuan':
        return this.buildHunyuanRequest(platform, question);
      default:
        return this.buildDefaultRequest(platform, question);
    }
  }

  private buildDoubaoRequest(question: string): any {
    const body: any = {
      model: this.getDoubaoResponsesModel(),
      input: [{ role: 'user', content: [{ type: 'input_text', text: question }] }],
      temperature: DEFAULT_TEMPERATURE,
      max_output_tokens: Math.max(this.getMaxTokens('doubao'), DOUBAO_MIN_OUTPUT_TOKENS),
    };
    // Enable Doubao Web Search (Custom Edition) for GEO monitoring queries
    // Configures: sources=["doubao"], time_range (freshness), auth_level (credibility filter)
    // See: https://docs.volcengine.com/docs/82379/1756990
    //      https://www.volcengine.com/docs/87772/2518319 (authority grading)
    if (this.isDoubaoWebSearchEnabled()) {
      const webSearch: any = {
        sources: ['doubao'],
      };
      // Freshness control: Doubao weights 1-2 week content highest, drops sharply after 1 month
      const timeRange = this.getDoubaoSearchTimeRange();
      if (timeRange) {
        webSearch.search_filter = { time_range: timeRange };
      }
      // Authority filter: L1-L2 by default to exclude content farms and SEO spam
      const authLevel = this.getDoubaoSearchAuthLevel();
      if (authLevel < 4) {
        webSearch.search_filter = {
          ...webSearch.search_filter,
          auth_info_level: authLevel,
        };
      }
      body.tools = [{ type: 'web_search', web_search: webSearch }];
    }
    return body;
  }

  private buildDeepSeekRequest(platform: string, question: string): any {
    return {
      model: this.getModelName(platform),
      messages: [{ role: 'user', content: question }],
      temperature: DEFAULT_TEMPERATURE,
      max_tokens: this.getMaxTokens(platform),
      search: { enabled: true, depth: 'deep' },
    };
  }

  private buildQianwenRequest(platform: string, question: string): any {
    return {
      model: this.getModelName(platform),
      messages: [{ role: 'user', content: question }],
      temperature: DEFAULT_TEMPERATURE,
      max_tokens: this.getMaxTokens(platform),
      enable_search: true,
    };
  }

  private buildKimiRequest(platform: string, question: string): any {
    return {
      model: this.getModelName(platform),
      messages: [{ role: 'user', content: question }],
      temperature: DEFAULT_TEMPERATURE,
      max_tokens: this.getMaxTokens(platform),
      use_search: true,
    };
  }

  private buildHunyuanRequest(platform: string, question: string): any {
    return {
      model: this.getModelName(platform),
      messages: [{ role: 'user', content: question }],
      temperature: DEFAULT_TEMPERATURE,
      max_tokens: this.getMaxTokens(platform),
      enable_enhancement: true,
    };
  }

  private buildDefaultRequest(platform: string, question: string): any {
    return {
      model: this.getModelName(platform),
      messages: [{ role: 'user', content: question }],
      temperature: DEFAULT_TEMPERATURE,
      max_tokens: this.getMaxTokens(platform),
    };
  }

  getAvailablePlatforms(): string[] {
    return MAINLAND_MONITORING_PLATFORMS.filter((p) => this.platforms[p]?.apiKey);
  }

  async queryPlatform(platform: string, question: string): Promise<QueryResult> {
    const cfg = this.platforms[platform];
    if (!cfg) return { success: false, error: `不支持的AI平台: ${platform}`, platform };
    if (!cfg.apiKey) return { success: false, error: `${cfg.name} API密钥未配置`, platform };

    const requestData = this.buildRequestData(platform, question);
    const requestUrl = this.getApiUrl(platform);
    let lastError: any = null;

    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        const startedAt = Date.now();
        const headers = { ...cfg.headers, Accept: 'application/json' };

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
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
      } catch (error: any) {
        lastError = error;
        const code = error.code || '';
        const status = error.response?.status;
        const retryable = code === 'ECONNABORTED' || code === 'ENOTFOUND' || code === 'ECONNRESET' || status === 429 || (status && status >= 500);
        if (attempt < MAX_RETRY_ATTEMPTS && retryable) {
          const baseDelay = Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * Math.pow(2, attempt));
          const jitter = Math.floor(Math.random() * RETRY_JITTER_MAX_MS);
          await new Promise((r) => setTimeout(r, baseDelay + jitter));
          continue;
        }
        return { success: false, error: `[${platform}] ${code} ${error.message}${status ? ` (status ${status})` : ''}`, platform };
      }
    }
    return { success: false, error: lastError?.message || '未知错误', platform };
  }

  async queryMultiplePlatforms(platforms: string[], question: string): Promise<QueryResult[]> {
    const results = await Promise.allSettled(platforms.map((p) => this.queryPlatform(p, question)));
    return results.map((r, i) => (r.status === 'fulfilled' ? r.value : { success: false, error: r.reason?.message, platform: platforms[i] }));
  }
}

export const aiPlatformService = new AIPlatformService();
