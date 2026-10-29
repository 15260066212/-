/**
 * migrate-to-milvus.ts — 从 SQLite 批量迁移所有 session 的 L2/L3 信源到 Milvus。
 *
 * 用法：
 *   cd apps/server
 *   npx tsc
 *   npx node dist/scripts/migrate-to-milvus.js
 *
 * 或者跳过 tsc 直接用 tsx：
 *   npx tsx src/scripts/migrate-to-milvus.ts
 *
 * 依赖：
 *   - Milvus 已在 MILVUS_URI 上就绪
 *   - SQLite DB 在 DATABASE_PATH（默认 apps/data/geo-assistant.db）
 *   - Embedding 配置（豆包方舟 VOLCENGINE_API_KEY + DOUBAO_EMBEDDING_ENDPOINT）
 *
 * 迁移逻辑：
 *   对每个 session，取 enterprise_id = shortName ?? fullName ?? sessionId，
 *   收集 enabled 的 L2 信源 + L3 AI 名片，组装 Milvus row，
 *   按 30 条批次 embed + upsert。
 */

import dotenv from 'dotenv';
dotenv.config({ override: true });

import { DatabaseSync } from 'node:sqlite';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmbeddingProvider, EmbeddingProvider } from '../services/embedding.js';
import { MilvusRepository, MilvusSourceRow } from '../repositories/milvus-repository.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DATABASE_PATH ?? join(__dirname, '../../../data/geo-assistant.db');
const COLLECTION = 'enterprise_sources';
const BATCH_SIZE = 30;

interface SourceRow {
  id: string;
  layer: number;
  type: string;
  title: string;
  keyfacts: string[];
  tags: string[];
  usageCount: number;
  keyfacts_text: string;
}

function buildKeyfactsText(s: { title: string; keyFacts?: string[]; sections?: Array<{ bullets?: string[] }> }): string {
  const parts: string[] = [s.title];
  // keyFacts 优先（结构化的要点）
  if (s.keyFacts && s.keyFacts.length > 0) {
    parts.push(...s.keyFacts.filter(Boolean));
  }
  // 兜底：sections 里的 bullets
  if (s.sections) {
    for (const sec of s.sections) {
      if (sec.bullets) parts.push(...sec.bullets.filter(Boolean));
    }
  }
  return parts.join('\n');
}

async function main() {
  const milvusUri = process.env.MILVUS_URI;
  if (!milvusUri) {
    console.error('[migrate] MILVUS_URI 未设置，退出。要启用 Milvus 请取消 .env 注释。');
    process.exit(1);
  }

  console.log(`[migrate] DB = ${DB_PATH}`);
  console.log(`[migrate] Milvus = ${milvusUri}`);

  // 1. 连 SQLite（node:sqlite，避免 better-sqlite3 原生模块版本锁）
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const sessions = db.prepare('SELECT id, data FROM sessions').all() as unknown as Array<{ id: string; data: string }>;
  console.log(`[migrate] 共 ${sessions.length} 个 session`);

  // 2. 连 Milvus + Embedding
  const embedding = createEmbeddingProvider();
  if (!embedding) {
    console.error('[migrate] createEmbeddingProvider() 返回 null（MILVUS_URI 未设？）');
    process.exit(1);
  }
  console.log(`[migrate] Embedding = ${embedding.model} dim=${embedding.dim}`);

  const milvus = new MilvusRepository(milvusUri, embedding, process.env.MILVUS_API_KEY);
  const connected = await milvus.connect();
  if (!connected) {
    console.error('[migrate] Milvus connect 失败，确认 docker compose -f docker-compose.milvus.yml up -d');
    process.exit(1);
  }
  await milvus.ensureCollection();

  // 3. 收集所有行
  const allRows: MilvusSourceRow[] = [];
  const sessionSummary: string[] = [];

  for (const { id, data } of sessions) {
    const s = JSON.parse(data);
    const ent = s.enterprise ?? {};
    const enterpriseId = ent.shortName || ent.fullName || id;
    const kb = s.knowledgeBase ?? {};

    // L2: enabled 的 sources
    const l2Sources: SourceRow[] = (kb.sources ?? [])
      .filter((src: any) => src.enabled !== false)
      .map((src: any) => ({
        id: src.id,
        layer: 2,
        type: src.type ?? 'capability',
        title: src.title ?? src.id,
        keyfacts: src.keyFacts ?? [],
        tags: src.tags ?? [],
        usageCount: src.usageCount ?? 0,
        keyfacts_text: buildKeyfactsText(src),
      }));

    // L3: card.source
    let l3Source: SourceRow | null = null;
    const cardSrc = kb.card?.source;
    if (cardSrc) {
      l3Source = {
        id: cardSrc.id ?? 'l3-ai-card',
        layer: 3,
        type: cardSrc.type ?? 'brand',
        title: cardSrc.title ?? 'AI 名片',
        keyfacts: cardSrc.keyFacts ?? [],
        tags: cardSrc.tags ?? [],
        usageCount: 0,
        keyfacts_text: buildKeyfactsText(cardSrc),
      };
    }

    const rows: MilvusSourceRow[] = [];
    for (const src of l2Sources) {
      rows.push({
        source_id: src.id,
        session_id: id,
        enterprise_id: enterpriseId,
        layer: 2,
        type: src.type,
        title: src.title,
        keyfacts_text: src.keyfacts_text.slice(0, 4000),
        usage_count: src.usageCount,
        metadata_json: JSON.stringify({ tags: src.tags.slice(0, 32) }),
        vector: new Array(embedding.dim).fill(0), // 先占位，后面 embed 填充
      });
    }
    if (l3Source) {
      rows.push({
        source_id: l3Source.id,
        session_id: id,
        enterprise_id: enterpriseId,
        layer: 3,
        type: l3Source.type,
        title: l3Source.title,
        keyfacts_text: l3Source.keyfacts_text.slice(0, 4000),
        usage_count: 0,
        metadata_json: JSON.stringify({ tags: l3Source.tags.slice(0, 32) }),
        vector: new Array(embedding.dim).fill(0),
      });
    }

    allRows.push(...rows);
    sessionSummary.push(`  ${id} | ${enterpriseId} | ${l2Sources.length} L2 + ${l3Source ? 1 : 0} L3`);
  }

  console.log(`\n[migrate] 待迁移 ${allRows.length} 行来自 ${sessions.length} 个 session：`);
  console.log(sessionSummary.join('\n'));

  if (allRows.length === 0) {
    console.log('[migrate] 没有可迁移的行，退出');
    db.close();
    return;
  }

  // 4. 分批 embed + upsert
  const textBatch: string[] = [];
  const rowIndexMap: number[] = []; // textBatch[i] 对应 allRows[rowIndexMap[i]]
  let totalInserted = 0;

  const flush = async () => {
    if (textBatch.length === 0) return;
    console.log(`[migrate] embedding ${textBatch.length} 条...`);
    const vectors = await embedding.embedTexts(textBatch);
    for (let i = 0; i < vectors.length; i++) {
      allRows[rowIndexMap[i]].vector = vectors[i];
    }
    console.log(`[migrate] upsert ${vectors.length} 条...`);
    const inserted = await milvus.upsertSources(
      rowIndexMap.map((idx) => allRows[idx]),
    );
    totalInserted += inserted;
    textBatch.length = 0;
    rowIndexMap.length = 0;
  };

  for (let i = 0; i < allRows.length; i++) {
    const row = allRows[i];
    // 跳过全 0 占位的（layer=3 没什么信息的也 embed 一下）
    textBatch.push(row.keyfacts_text || row.title);
    rowIndexMap.push(i);
    if (textBatch.length >= BATCH_SIZE) await flush();
  }
  await flush();

  console.log(`\n✅ [migrate] 完成：upsert ${totalInserted} 条到 ${COLLECTION}`);
  db.close();
}

main().catch((e) => {
  console.error('[migrate] 失败:', e);
  process.exit(1);
});
