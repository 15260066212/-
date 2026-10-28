/**
 * Embedding 服务 — 统一接口，可插拔后端。
 *
 * 芯图EK 的 L2 信源写入 Milvus 前需要向量化。此文件封装 embedding 提供方，
 * 让 MilvusRepository 和 stage4-knowledge 不关心底层调用哪个 API。
 *
 * 当前支持：豆包火山方舟（doubao-embedding）。
 * 后续可扩展：OpenAI / 本地 BGE ONNX sidecar。
 */

export interface EmbeddingProvider {
  embedTexts(texts: string[]): Promise<number[][]>;
  readonly dim: number;
  readonly model: string;
}

class VolcengineEmbedding implements EmbeddingProvider {
  readonly dim: number;
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor() {
    const apiKey = process.env.VOLCENGINE_API_KEY ?? process.env.DOUBAO_API_KEY;
    const endpointId = process.env.DOUBAO_EMBEDDING_ENDPOINT;
    const modelName = process.env.DOUBAO_EMBEDDING_MODEL ?? 'doubao-embedding-text';
    const dim = parseInt(process.env.EMBEDDING_DIM ?? '1024', 10);

    if (!apiKey) {
      throw new Error('[Embedding] 缺少 VOLCENGINE_API_KEY / DOUBAO_API_KEY');
    }

    // 火山方舟走接入点模式 — 如果用户提供了 endpoint ID，就用它作为 model 参数
    // 否则回退到直接模型名（某些账号可能直接用模型名）
    this.model = endpointId ?? modelName;
    this.apiKey = apiKey;
    this.baseUrl = process.env.DOUBAO_BASE_URL ?? 'https://ark.cn-beijing.volces.com/api/v3';
    this.dim = dim;
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    // 豆包 embedding 支持 batch，但单批有上限，这里简单地单条调用
    // 生产环境可改为批量以提升吞吐
    const results: number[][] = [];
    for (const text of texts) {
      const body = JSON.stringify({
        model: this.model,
        input: text,
        dim: this.dim,
      });

      const res = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body,
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(
          `[Embedding] HTTP ${res.status} for ${this.model}: ${errText.slice(0, 200)}`
        );
      }

      const data = await res.json();
      if (data?.data?.[0]?.embedding) {
        results.push(data.data[0].embedding);
      } else {
        throw new Error(`[Embedding] 响应异常: ${JSON.stringify(data).slice(0, 200)}`);
      }
    }

    return results;
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
 * - 若 MILVUS_URI 未设置 → 返回 null（表示 Milvus 整体未启用，上层应该跳过向量操作）
 * - 若 VOLCENGINE_API_KEY 或 DOUBAO_API_KEY 设置了 → 使用豆包 embedding
 * - 否则 → 返回 ZeroEmbedding（Milvus 写入可跑，语义召回暂不可用）
 */
export function createEmbeddingProvider(): EmbeddingProvider | null {
  if (!process.env.MILVUS_URI) return null;

  // 方舟是接入点模式：没有 DOUBAO_EMBEDDING_ENDPOINT（ep-xxxx）时调用必然 404，
  // 直接用 ZeroEmbedding 占位，避免每次召回都白白发起一次必失败的网络请求。
  if (process.env.DOUBAO_EMBEDDING_ENDPOINT && (process.env.VOLCENGINE_API_KEY || process.env.DOUBAO_API_KEY)) {
    try {
      return new VolcengineEmbedding();
    } catch (e) {
      console.warn('[Embedding] 豆包初始化失败，回退到 ZeroEmbedding:', e instanceof Error ? e.message : e);
    }
  }

  const dim = parseInt(process.env.EMBEDDING_DIM ?? '1024', 10);
  return new ZeroEmbedding(dim);
}
