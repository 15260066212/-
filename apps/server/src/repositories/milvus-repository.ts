/**
 * MilvusRepository — 芯图EK 知识库向量存储（SDK 2.6.x 兼容版）。
 *
 * 设计：单 collection（enterprise_sources），enterprise_id 做 partition key。
 *       每个 L2 信源 / L3 AI 名片各占一行，payload 存标题、keyFacts、usageCount 等。
 *       向量列存 keyFacts 拼接后的文本 embedding。
 */

import type { MilvusClient } from '@zilliz/milvus2-sdk-node';
import type { EmbeddingProvider } from '../services/embedding.js';

/**
 * 懒加载 Milvus SDK。
 * SDK 属于可选依赖：未配置 MILVUS_URI 时不应因缺少该包导致进程启动失败，
 * 因此把 import 推迟到真正使用时（所有调用点均已在 try/catch 或 async 中）。
 */
async function loadMilvusSdk() {
  return import('@zilliz/milvus2-sdk-node');
}

export interface MilvusSourceRow {
  source_id: string;
  session_id: string;
  enterprise_id: string;
  layer: number;
  type: string;
  title: string;
  keyfacts_text: string;
  usage_count: number;
  metadata_json: string;
  vector: number[];
}

export interface MilvusSearchHit {
  sourceId: string;
  score: number;
}

const COLLECTION_NAME = 'enterprise_sources';
const INDEX_NAME = 'vector_idx';
const METRIC_TYPE = 'COSINE';

export class MilvusRepository {
  private client: MilvusClient | null = null;
  private connected = false;
  public readonly dim: number;

  constructor(
    private readonly uri: string,
    public readonly embedding: EmbeddingProvider,
    private readonly apiKey?: string,
  ) {
    this.dim = embedding.dim;
  }

  /**
   * 懒加载连接 Milvus。SDK 2.6.x 构造函数已触发连接，这里仅做可用性探测。
   */
  async connect(): Promise<boolean> {
    if (this.connected && this.client) return true;
    try {
      const { MilvusClient } = await loadMilvusSdk();
      this.client = new MilvusClient({
        address: this.uri,
        token: this.apiKey,
      });
      // 用一个轻量请求探测连接是否真正可用
      await this.client.listCollections();
      this.connected = true;
      return true;
    } catch (e) {
      console.warn('[Milvus] connect failed:', e instanceof Error ? e.message : e);
      this.client = null;
      this.connected = false;
      return false;
    }
  }

  /** 确保 collection 存在，不存在则创建。dim 一旦创建不可更改。 */
  async ensureCollection(): Promise<void> {
    if (!(await this.connect()) || !this.client) return;

    const has = await this.client.hasCollection({ collection_name: COLLECTION_NAME });
    if (has.value) {
      console.log(`[Milvus] collection ${COLLECTION_NAME} exists (dim=${this.dim})`);
      return;
    }

    console.log(`[Milvus] creating collection ${COLLECTION_NAME} dim=${this.dim} ...`);
    const { DataType } = await loadMilvusSdk();
    await this.client.createCollection({
      collection_name: COLLECTION_NAME,
      fields: [
        { name: 'source_id', data_type: DataType.VarChar, is_primary_key: true, max_length: 128 },
        { name: 'session_id', data_type: DataType.VarChar, max_length: 128 },
        { name: 'enterprise_id', data_type: DataType.VarChar, max_length: 128, is_partition_key: true },
        { name: 'layer', data_type: DataType.Int8 },
        { name: 'type', data_type: DataType.VarChar, max_length: 64 },
        { name: 'title', data_type: DataType.VarChar, max_length: 512 },
        { name: 'keyfacts_text', data_type: DataType.VarChar, max_length: 4096 },
        { name: 'usage_count', data_type: DataType.Int32 },
        { name: 'metadata_json', data_type: DataType.JSON },
        { name: 'vector', data_type: DataType.FloatVector, dim: this.dim },
      ],
    });

    await this.client.createIndex({
      collection_name: COLLECTION_NAME,
      field_name: 'vector',
      index_name: INDEX_NAME,
      index_type: 'IVF_FLAT',
      metric_type: METRIC_TYPE,
      params: { nlist: 1024 },
    });

    await this.client.loadCollection({ collection_name: COLLECTION_NAME });
    console.log('[Milvus] collection + index ready');
  }

  /** 写入 / 覆盖 — 信源 id 为主键。 */
  async upsertSources(rows: MilvusSourceRow[]): Promise<number> {
    if (!(await this.connect()) || !this.client || rows.length === 0) return 0;

    const res = await this.client.insert({
      collection_name: COLLECTION_NAME,
      data: rows.map((r) => ({
        source_id: r.source_id,
        session_id: r.session_id,
        enterprise_id: r.enterprise_id,
        layer: r.layer,
        type: r.type,
        title: r.title,
        keyfacts_text: r.keyfacts_text,
        usage_count: r.usage_count,
        metadata_json: JSON.parse(r.metadata_json),
        vector: r.vector,
      })),
    });

    return parseInt(res.insert_cnt, 10) || rows.length;
  }

  /** 企业内语义搜索 — 仅在该企业 partition 内查。 */
  async semanticSearch(
    enterpriseId: string,
    queryText: string,
    topK = 20,
  ): Promise<MilvusSearchHit[]> {
    if (!(await this.connect()) || !this.client) return [];

    const [queryVector] = await this.embedding.embedTexts([queryText]);

    // SearchSimpleReq 是 SDK 2.6.x 提供的简洁搜索接口
    const res = await this.client.search({
      collection_name: COLLECTION_NAME,
      vector: queryVector,
      topk: topK,
      metric_type: METRIC_TYPE,
      output_fields: ['source_id'],
      filter: `enterprise_id == "${this.escapeFilter(enterpriseId)}"`,
    });

    const hits: MilvusSearchHit[] = [];
    // SDK 2.6 的 search 结果项把 output_fields 平铺到顶层，主键也在 id 字段；
    // 两种形态都兼容，避免 sourceId 丢失导致候选过滤失效。
    const results = (res.results ?? []) as Array<{ id?: string; source_id?: string; score: number }>;
    for (const item of results) {
      const sourceId = item.id ?? item.source_id;
      if (sourceId) hits.push({ sourceId, score: item.score });
    }
    return hits;
  }

  /** 按企业删除所有行 — session 删除时级联清理。 */
  async deleteByEnterprise(enterpriseId: string): Promise<void> {
    if (!(await this.connect()) || !this.client) return;
    await this.client.deleteEntities({
      collection_name: COLLECTION_NAME,
      filter: `enterprise_id == "${this.escapeFilter(enterpriseId)}"`,
    });
  }

  /** 单条更新 usageCount — 审核通过后同步计数。 */
  async updateUsageCount(sourceId: string, usageCount: number): Promise<void> {
    if (!(await this.connect()) || !this.client) return;
    await this.client.upsert({
      collection_name: COLLECTION_NAME,
      data: [{ source_id: sourceId, usage_count: usageCount }],
    });
  }

  /** 拉取某企业所有 L2 信源（回退模式）。 */
  async fetchByEnterprise(enterpriseId: string): Promise<Array<{ source_id: string; usage_count: number }>> {
    if (!(await this.connect()) || !this.client) return [];

    const res = await this.client.query({
      collection_name: COLLECTION_NAME,
      filter: `enterprise_id == "${this.escapeFilter(enterpriseId)}" and layer == 2`,
      output_fields: ['source_id', 'usage_count'],
      limit: 1000,
    });

    return ((res.data ?? []) as Array<{ source_id: string; usage_count: number }>);
  }

  /**
   * 是否已配置启用（MILVUS_URI 存在才会构造本实例）。
   * 注意：连接是懒加载的，不能用 connected 判断，否则首次请求永远跳过 Milvus。
   * 调用方在 isEnabled() 为 true 时直接调用业务方法，方法内部自行懒连接 + 失败降级。
   */
  isEnabled(): boolean {
    return true;
  }

  private escapeFilter(s: string): string {
    return s.replace(/"/g, '\\"');
  }
}
