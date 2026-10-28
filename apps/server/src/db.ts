import Database from 'better-sqlite3';

export type DB = InstanceType<typeof Database>;
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDatabase } from './schema.js';

import { SessionRepository, type SessionListItem as SessionListItemType } from './repositories/session-repository.js';
import { ArticleRepository } from './repositories/article-repository.js';
import { ReviewRepository } from './repositories/review-repository.js';
import { PublishRepository } from './repositories/publish-repository.js';
import { CredentialRepository } from './repositories/credential-repository.js';
import { SelectorRepository } from './repositories/selector-repository.js';
import { PipelineRepository } from './repositories/pipeline-repository.js';
import { MonitorRepository } from './repositories/monitor-repository.js';
import { UserRepository } from './repositories/user-repository.js';
import { PlanRepository } from './repositories/plan-repository.js';
import { MilvusRepository } from './repositories/milvus-repository.js';
import { createEmbeddingProvider } from './services/embedding.js';

// === Server-side types (not in shared package) ===

export interface User {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'user';
  apiKey: string;
  passwordHash?: string;
  createdAt: string;
  lastActiveAt?: string;
}

export type SessionListItem = SessionListItemType;

/** Hono environment type for routes that need access to the authenticated user. */
export type AppEnv = {
  Variables: {
    user?: User;
  };
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DATABASE_PATH ?? join(__dirname, '../../data/geo-assistant.db');

export function createDatabase(): DB {
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new Database(DB_PATH);
  initDatabase(db);
  return db;
}

/**
 * DatabaseAccess — holds the underlying DB connection and exposes the 10
 * domain repositories as public readonly properties.
 *
 * Consumers call repository methods directly, e.g. `db.articles.getArticle(id)`,
 * `db.sessions.upsertSession(...)`, keeping DatabaseAccess a thin composition
 * root rather than a God Object facade.
 *
 * Only cross-cutting concerns (transactions, health checks, connection
 * lifecycle) live on this class.
 */
export class DatabaseAccess {
  public readonly sessions: SessionRepository;
  public readonly articles: ArticleRepository;
  public readonly reviews: ReviewRepository;
  public readonly publish: PublishRepository;
  public readonly credentials: CredentialRepository;
  public readonly selectors: SelectorRepository;
  public readonly pipeline: PipelineRepository;
  public readonly monitor: MonitorRepository;
  public readonly users: UserRepository;
  public readonly plans: PlanRepository;
  /**
   * Milvus 向量存储 — 芯图EK 知识库 L2 信源语义召回。
   * 未配置 MILVUS_URI 时为 null，检索逻辑自动回退到纯编译式 usageCount 均衡。
   */
  public readonly milvus: MilvusRepository | null;

  constructor(private db: DB) {
    this.sessions = new SessionRepository(db);
    this.articles = new ArticleRepository(db);
    this.reviews = new ReviewRepository(db);
    this.publish = new PublishRepository(db);
    this.credentials = new CredentialRepository(db);
    this.selectors = new SelectorRepository(db);
    this.pipeline = new PipelineRepository(db);
    this.monitor = new MonitorRepository(db);
    this.users = new UserRepository(db);
    this.plans = new PlanRepository(db);

    const milvusUri = process.env.MILVUS_URI;
    if (milvusUri) {
      try {
        const embedding = createEmbeddingProvider();
        if (embedding) {
          this.milvus = new MilvusRepository(
            milvusUri,
            embedding,
            process.env.MILVUS_API_KEY,
          );
          console.log(`[Database] Milvus enabled uri=${milvusUri} embedding=${embedding.model} dim=${embedding.dim}`);
        } else {
          this.milvus = null;
          console.warn('[Database] MILVUS_URI 已设置但 embedding provider 初始化失败，Milvus 已禁用');
        }
      } catch (e) {
        this.milvus = null;
        console.warn('[Database] Milvus 初始化失败，回退到纯 SQLite:', e instanceof Error ? e.message : e);
      }
    } else {
      this.milvus = null;
    }
  }

  // === Transactions ===

  /**
   * Wrap a function in a better-sqlite3 transaction.
   *
   * better-sqlite3's `transaction()` returns a reusable transaction function;
   * invoking it executes the transaction. If the wrapped function throws,
   * the transaction is automatically rolled back.
   */
  private wrapTransaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /**
   * Public entry point for running multiple DB operations atomically.
   * Use this to group related writes that must succeed or fail together.
   *
   * @example
   * db.runInTransaction(() => {
   *   db.publish.updatePublishTask(id, { status: 'published' });
   *   db.articles.updateArticle(articleId, { status: 'published' });
   * });
   */
  runInTransaction<T>(fn: () => T): T {
    return this.wrapTransaction(fn);
  }

  // === Health Check ===

  /**
   * Check the health of the database.
   *
   * Verifies that every expected table exists and is queryable, gathers
   * per-table row counts, and reports the WAL file size when available.
   * The check never throws - a table that fails to query is reported as
   * missing and marks the overall result as unhealthy.
   */
  healthCheck(): { healthy: boolean; details: Record<string, unknown> } {
    const tables = [
      'sessions',
      'articles',
      'reviews',
      'publish_tasks',
      'publish_logs',
      'platform_credentials',
      'pipeline_runs',
      'schema_version',
      'users',
    ];

    const tableExists: Record<string, boolean> = {};
    const tableCounts: Record<string, number> = {};
    let healthy = true;

    for (const table of tables) {
      try {
        // Verify the table is queryable
        this.db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
        tableExists[table] = true;
        const row = this.db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number };
        tableCounts[table] = Number(row.c) || 0;
      } catch {
        tableExists[table] = false;
        tableCounts[table] = 0;
        healthy = false;
      }
    }

    // Report WAL file size when the database is file-backed
    let walSize: number | null = null;
    try {
      const walPath = `${DB_PATH}-wal`;
      if (existsSync(walPath)) {
        walSize = statSync(walPath).size;
      }
    } catch {
      // WAL file may not exist (e.g. in-memory db or not yet created) - ignore
    }

    return {
      healthy,
      details: {
        tables: tableCounts,
        tableExists,
        walSize,
      },
    };
  }

  /** Close the underlying database connection. */
  close(): void {
    this.db.close();
  }
}
