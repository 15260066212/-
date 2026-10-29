/**
 * Embedding 服务 — 统一接口，可插拔后端（OpenAI 协议兼容）。
 *
 * 当前支持：
 *   - SiliconFlow（BAAI/bge-m3 等稳定中文模型，推荐，国内直连）
 *   - 火山方舟豆包（接入点模式，`ep-xxx` 作为 model 参数）
 *
 * 两个 provider 都走 OpenAI `/v1/embeddings` 协议，这里合并成一个通用实现，
 * 工厂按环境变量优先级选，避免为每个平台各写一个类。
 */

export interface EmbeddingProvider {
  embedTexts(texts: string[]): Promise<number[][]>;
  readonly dim: number;
  readonly model: string;
}

/** OpenAI 协议通用 embedding — SiliconFlow / 豆包 / 阿里云百炼兼容模式都走这里。 */
class OpenAICompatibleEmbedding implements EmbeddingProvider {
  readonly dim: number;
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor() {
    const sfKey = process.env.SILICONFLOW_API_KEY;
    const arkKey = process.env.VOLCENGINE_API_KEY ?? process.env.DOUBAO_API_KEY;
    const arkEndpoint = process.env.DOUBAO_EMBEDDING_ENDPOINT;
    const provider = process.env.EMBEDDING_PROVIDER; // 'siliconflow' | 'volcengine' | undefined=自动

    if (provider === 'siliconflow' || (!provider && sfKey)) {
      this.apiKey = sfKey!;
      this.baseUrl = process.env.SILICONFLOW_BASE_URL ?? 'https://api.siliconflow.cn/v1';
      this.model = process.env.SILICONFLOW_EMBEDDING_MODEL ?? 'BAAI/bge-m3';
    } else if (provider === 'volcengine' || (!provider && arkKey && arkEndpoint)) {
      this.apiKey = arkKey!;
      this.baseUrl = process.env.DOUBAO_BASE_URL ?? 'https://ark.cn-beijing.volces.com/api/v3';
      this.model = arkEndpoint ?? process.env.DOUBAO_EMBEDDING_MODEL ?? 'doubao-embedding-text';
    } else {
      throw new Error(
        '[Embedding] 未找到可用 provider：需要 SILICONFLOW_API_KEY 或 (VOLCENGINE_API_KEY + DOUBAO_EMBEDDING_ENDPOINT)'
      );
    }

    this.dim = parseInt(process.env.EMBEDDING_DIM ?? '1024', 10);
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const body = JSON.stringify({ model: this.model, input: texts, dim: this.dim });

    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/embeddings`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`[Embedding] HTTP ${res.status} for ${this.model}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    if (!Array.isArray(data?.data)) {
      throw new Error(`[Embedding] 响应异常: ${JSON.stringify(data).slice(0, 200)}`);
    }
    const sorted = [...data.data].sort((a: { index: number }, b: { index: number }) => a.index - b.index);
    return sorted.map((item: { embedding: number[] }) => item.embedding);
  }
}

/**
 * 占位 embedding — 当未配置真实 embedding 时返回全 0 向量。
 * 让 MilvusRepository 能正常写入和查询，但语义召回效果为零。
 * 后续接入真实 embedding 只需切换 createEmbeddingProvider 的返回值。
 */
class ZeroEmbedding implements EmbeddingProvider {
  readonly dim: number;
  readonly model = 'zero-placeholder';

  constructor(dim = 1024) {
    this.dim = dim;
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
    return texts.map(() => new Array(this.dim).fill(0));
  }
}

/**
 * 工厂函数 — 根据环境变量选 provider。
 *
 * - MILVUS_URI 未设置 → 返回 null（Milvus 整体未启用）
 * - SILICONFLOW_API_KEY 存在 → SiliconFlow（推荐，自动优先）
 * - 否则若 VOLCENGINE_API_KEY + DOUBAO_EMBEDDING_ENDPOINT 都在 → 豆包方舟
 * - 都没有 → 返回 ZeroEmbedding（Milvus 写入能跑，语义召回暂为零）
 *
 * EMBEDDING_PROVIDER='siliconflow' | 'volcengine' 可强制切换优先级。
 */
export function createEmbeddingProvider(): EmbeddingProvider | null {
  if (!process.env.MILVUS_URI) return null;

  try {
    if (process.env.SILICONFLOW_API_KEY) {
      return new OpenAICompatibleEmbedding();
    }
    if (process.env.VOLCENGINE_API_KEY && process.env.DOUBAO_EMBEDDING_ENDPOINT) {
      return new OpenAICompatibleEmbedding();
    }
    const dim = parseInt(process.env.EMBEDDING_DIM ?? '1024', 10);
    return new ZeroEmbedding(dim);
  } catch (e) {
    console.warn('[Embedding] 真实 embedding 初始化失败，回退到 ZeroEmbedding:', e instanceof Error ? e.message : e);
    const dim = parseInt(process.env.EMBEDDING_DIM ?? '1024', 10);
    return new ZeroEmbedding(dim);
  }
}
