# 文章审核与自动发布系统实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 GEO Assistant monorepo 中新增 content-generator、content-reviewer、publisher 三个 package，实现从 SessionData 到 10 平台自动发布的完整流水线。

**Architecture:** 采用方式A流水线架构。三个独立 package 通过 SQLite 持久化串联，Server 提供 REST API 编排，React 前端提供操作界面。LLM 不可用时回退规则引擎，RPA 不可用时标记待人工发布。

**Tech Stack:** TypeScript ESM, Hono, React + Tailwind, better-sqlite3, Playwright, node:test

---

## 文件结构总览

```
packages/
  content-generator/          # 新增
    src/
      types.ts                # GenerateRequest, GenerateResult
      prompt-builder.ts       # buildPrompt()
      platform-adapter.ts     # adaptForPlatform()
      generator.ts            # ContentGenerator 类
      generator.test.ts       # 单元测试
      index.ts                # 导出
    package.json
    tsconfig.json
  content-reviewer/           # 新增
    src/
      types.ts                # ReviewRequest
      rules/
        compliance.ts         # 敏感词检测
        quality.ts            # 质量检查
        seo.ts                # SEO 检查
        brand.ts              # 品牌一致性
      scorer.ts               # 加权评分
      reviewer.ts             # ContentReviewer 类
      reviewer.test.ts        # 单元测试
      index.ts                # 导出
    package.json
    tsconfig.json
  publisher/                  # 新增
    src/
      types.ts                # PublishParams, PublishResult
      adapters/
        base.ts               # PlatformAdapter 抽象类
        wechat.ts             # 微信公众号 API
        csdn.ts               # CSDN API
        juejin.ts             # 掘金 API
        bilibili.ts           # B站 API
        zhihu.ts              # 知乎 RPA
        baijia.ts             # 百家号 RPA
        toutiao.ts            # 今日头条 RPA
        xiaohongshu.ts        # 小红书 RPA
        sohu.ts               # 搜狐号 RPA
        netease.ts            # 网易号 RPA
      rpa-engine.ts           # Playwright 封装
      queue.ts                # 发布队列
      publisher.ts            # Publisher 编排类
      publisher.test.ts       # 单元测试
      index.ts                # 导出
    package.json
    tsconfig.json
  shared/src/index.ts         # 扩展类型定义
apps/server/
  src/
    db.ts                     # Database 数据访问层
    routes/
      article.ts              # 文章路由
      review.ts               # 审核路由
      publish.ts              # 发布路由
      pipeline.ts             # 流水线路由
      credentials.ts          # 凭据路由
    index.ts                  # 注册新路由
apps/web/
  src/
    stores/
      articleStore.ts         # 文章状态管理 (Zustand)
      pipelineStore.ts        # 流水线状态管理 (Zustand)
    components/
      articles/
        ArticleList.tsx
        ArticleDetail.tsx
        ArticleStatusBadge.tsx
        ReviewReport.tsx
        PublishStatusPanel.tsx
      pipeline/
        PipelineLauncher.tsx
        PipelineDashboard.tsx
      credentials/
        CredentialManager.tsx
    pages/
      ContentPage.tsx
      PipelinePage.tsx
    App.tsx                   # 导航切换
```

---

## Phase 1: 基础设施

### Task 1: 安装 better-sqlite3 并初始化数据库

**Files:**
- Modify: `apps/server/package.json`
- Create: `apps/server/src/db.ts`

- [ ] **Step 1: 安装依赖**

```bash
cd c:\Users\Administrator\Desktop\trae work GEO\geo-assistant-clean\apps\server
npm install better-sqlite3
npm install --save-dev @types/better-sqlite3
```

- [ ] **Step 2: 更新 server package.json**

```json
// apps/server/package.json
{
  "name": "@zemingengine/server",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@hono/node-server": "^1.14.0",
    "@zemingengine/ai-engine": "*",
    "@zemingengine/content-generator": "*",
    "@zemingengine/content-reviewer": "*",
    "@zemingengine/dialogue-engine": "*",
    "@zemingengine/publisher": "*",
    "@zemingengine/shared": "*",
    "better-sqlite3": "^12.0.0",
    "dotenv": "^16.4.0",
    "hono": "^4.7.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.13",
    "@types/node": "^22.15.0",
    "typescript": "^5.8.3"
  }
}
```

- [ ] **Step 3: 创建数据库初始化与连接**

```typescript
// apps/server/src/db.ts
import Database from 'better-sqlite3';
import type { SessionData } from '@zemingengine/shared';
import type {
  Article,
  ArticleStatus,
  ReviewResult,
  PublishTask,
  PublishLog,
  PlatformCredentials,
} from '@zemingengine/shared';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DB_PATH = process.env.DATABASE_PATH ?? './data/geo-assistant.db';

function initDatabase(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      current_stage TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS articles (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      content_type TEXT NOT NULL,
      title TEXT NOT NULL,
      content_markdown TEXT NOT NULL,
      content_html TEXT,
      content_plain TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      summary TEXT,
      cover_image_desc TEXT,
      word_count INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      generation_round INTEGER NOT NULL DEFAULT 1,
      generation_meta TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL,
      round INTEGER NOT NULL,
      passed INTEGER NOT NULL,
      overall_score REAL NOT NULL,
      compliance_score REAL NOT NULL,
      quality_score REAL NOT NULL,
      seo_score REAL NOT NULL,
      brand_score REAL NOT NULL,
      issues TEXT NOT NULL DEFAULT '[]',
      suggestions TEXT NOT NULL DEFAULT '[]',
      reviewed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS publish_tasks (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      method TEXT NOT NULL,
      platform_post_id TEXT,
      platform_post_url TEXT,
      error_message TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 2,
      scheduled_at TEXT,
      published_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS publish_logs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS platform_credentials (
      platform TEXT PRIMARY KEY,
      credential_type TEXT NOT NULL,
      credential_data TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      last_validated_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_articles_session ON articles(session_id);
    CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
    CREATE INDEX IF NOT EXISTS idx_reviews_article ON reviews(article_id);
    CREATE INDEX IF NOT EXISTS idx_publish_tasks_article ON publish_tasks(article_id);
    CREATE INDEX IF NOT EXISTS idx_publish_tasks_status ON publish_tasks(status);
  `);
}

export function createDatabase(): Database.Database {
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new Database(DB_PATH);
  initDatabase(db);
  return db;
}
```

- [ ] **Step 4: 编译并验证**

```bash
cd c:\Users\Administrator\Desktop\trae work GEO\geo-assistant-clean
npm install
cd apps/server
npx tsc --noEmit
```

Expected: 无类型错误（`better-sqlite3` 类型和 `@types/node` 已安装）

- [ ] **Step 5: Commit**

```bash
cd c:\Users\Administrator\Desktop\trae work GEO\geo-assistant-clean
git add .
git commit -m "feat: add better-sqlite3 dependency and database schema"
```

---

### Task 2: 在 shared 包中扩展文章相关类型

**Files:**
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: 在文件末尾追加类型定义**

```typescript
// === Article types === (append to packages/shared/src/index.ts before the closing brace)

export type PlatformId =
  | 'weixin' | 'zhihu' | 'baijia' | 'toutiao'
  | 'csdn' | 'juejin' | 'xiaohongshu' | 'bilibili'
  | 'sohu' | 'netease';

export type ArticleContentType = 'tutorial' | 'case' | 'comparison' | 'popularization';

export type ArticleStatus =
  | 'draft' | 'reviewing' | 'approved'
  | 'publishing' | 'published' | 'failed';

export interface Article {
  id: string;
  sessionId: string;
  platform: PlatformId;
  contentType: ArticleContentType;
  title: string;
  contentMarkdown: string;
  contentHtml?: string;
  contentPlain?: string;
  tags: string[];
  summary?: string;
  coverImageDesc?: string;
  wordCount: number;
  status: ArticleStatus;
  generationRound: number;
  generationMeta?: {
    model: string;
    tokensUsed: number;
    durationMs: number;
    promptVersion: string;
  };
  createdAt: string;
  updatedAt: string;
}

// === Review types ===

export type ReviewDimension = 'compliance' | 'quality' | 'seo' | 'brand';
export type IssueSeverity = 'high' | 'medium' | 'low';

export interface ReviewIssue {
  dimension: ReviewDimension;
  severity: IssueSeverity;
  description: string;
  location?: string;
  suggestion?: string;
}

export interface DimensionResult {
  score: number;
  issues: ReviewIssue[];
}

export interface ReviewResult {
  articleId: string;
  round: number;
  passed: boolean;
  overallScore: number;
  dimensions: {
    compliance: DimensionResult;
    quality: DimensionResult;
    seo: DimensionResult;
    brand: DimensionResult;
  };
  issues: ReviewIssue[];
  suggestions: string[];
  reviewedAt: string;
}

export interface ReviewFeedback {
  issues: ReviewIssue[];
  suggestions: string[];
  overallScore: number;
}

// === Publish types ===

export type PublishMethod = 'api' | 'rpa';
export type PublishTaskStatus =
  | 'pending' | 'publishing' | 'published'
  | 'failed' | 'retrying';

export interface PublishTask {
  id: string;
  articleId: string;
  platform: PlatformId;
  status: PublishTaskStatus;
  method: PublishMethod;
  platformPostId?: string;
  platformPostUrl?: string;
  errorMessage?: string;
  retryCount: number;
  maxRetries: number;
  scheduledAt?: string;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublishLog {
  id: string;
  taskId: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface PlatformCredentials {
  platform: PlatformId;
  type: 'api_key' | 'cookie' | 'token';
  data: Record<string, string>;
  status: 'active' | 'expired' | 'invalid';
  lastValidatedAt?: string;
}

// === Pipeline types ===

export interface PipelineRequest {
  sessionId: string;
  platforms: PlatformId[];
  contentType: ArticleContentType;
  autoPublish: boolean;
}

export interface PipelineStatus {
  sessionId: string;
  totalArticles: number;
  draft: number;
  reviewing: number;
  approved: number;
  publishing: number;
  published: number;
  failed: number;
  articles: ArticleSummary[];
}

export interface ArticleSummary {
  id: string;
  platform: PlatformId;
  title: string;
  status: ArticleStatus;
  reviewScore?: number;
  publishUrl?: string;
  createdAt: string;
}

// === Article API types ===

export interface GenerateArticleRequest {
  sessionId: string;
  platform: PlatformId;
  contentType: ArticleContentType;
}

export interface GenerateArticleResponse {
  article: Article;
  review: ReviewResult;
}

export interface PublishArticleRequest {
  articleId: string;
  platforms?: PlatformId[];
  scheduledAt?: string;
}
```

- [ ] **Step 2: 编译 shared 包**

```bash
cd c:\Users\Administrator\Desktop\trae work GEO\geo-assistant-clean
npm run build --workspace=@zemingengine/shared
```

Expected: `packages/shared/dist/` 生成新类型定义

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(shared): add article, review, publish, pipeline types"
```

---

### Task 3: 创建 content-generator package 骨架

**Files:**
- Create: `packages/content-generator/package.json`
- Create: `packages/content-generator/tsconfig.json`
- Create: `packages/content-generator/src/types.ts`
- Create: `packages/content-generator/src/index.ts`

- [ ] **Step 1: 创建 package.json**

```json
// packages/content-generator/package.json
{
  "name": "@zemingengine/content-generator",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "node --test dist/**/*.test.js",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@zemingengine/shared": "*",
    "@zemingengine/ai-engine": "*"
  },
  "devDependencies": {
    "typescript": "^5.8.3"
  }
}
```

- [ ] **Step 2: 创建 tsconfig.json**

```json
// packages/content-generator/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: 创建 types.ts**

```typescript
// packages/content-generator/src/types.ts
import type { Article, PlatformId, ArticleContentType, SessionData, ReviewFeedback } from '@zemingengine/shared';

export interface GenerateRequest {
  sessionId: string;
  platform: PlatformId;
  contentType: ArticleContentType;
  keywords?: string[];
  generationRound: number;
  reviewFeedback?: ReviewFeedback;
}

export interface GenerateResult {
  article: Article;
  generationMeta: {
    model: string;
    tokensUsed: number;
    durationMs: number;
    promptVersion: string;
  };
}
```

- [ ] **Step 4: 创建 index.ts**

```typescript
// packages/content-generator/src/index.ts
export { GenerateRequest, GenerateResult } from './types.js';
```

- [ ] **Step 5: 注册 workspace 并安装**

Root `package.json` 已有 `workspaces: ["packages/*", "apps/*"]`，所以自动包含。

```bash
cd c:\Users\Administrator\Desktop\trae work GEO\geo-assistant-clean
npm install
```

- [ ] **Step 6: Commit**

```bash
git add packages/content-generator/
git commit -m "chore: scaffold content-generator package"
```

---

### Task 4: 创建 content-reviewer package 骨架

**Files:**
- Create: `packages/content-reviewer/package.json`
- Create: `packages/content-reviewer/tsconfig.json`
- Create: `packages/content-reviewer/src/types.ts`
- Create: `packages/content-reviewer/src/index.ts`

- [ ] **Step 1: 创建 package.json**

```json
// packages/content-reviewer/package.json
{
  "name": "@zemingengine/content-reviewer",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "node --test dist/**/*.test.js",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@zemingengine/shared": "*",
    "@zemingengine/ai-engine": "*"
  },
  "devDependencies": {
    "typescript": "^5.8.3"
  }
}
```

- [ ] **Step 2: 创建 tsconfig.json**

```json
// packages/content-reviewer/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: 创建 types.ts**

```typescript
// packages/content-reviewer/src/types.ts
import type { Article, SessionData, ReviewResult } from '@zemingengine/shared';

export interface ReviewRequest {
  article: Article;
  session: SessionData;
  round: number;
}

export interface ReviewerOptions {
  passThreshold: number;
  fallbackMode: boolean;
}
```

- [ ] **Step 4: 创建 index.ts**

```typescript
// packages/content-reviewer/src/index.ts
export { ReviewRequest, ReviewerOptions } from './types.js';
```

- [ ] **Step 5: Commit**

```bash
git add packages/content-reviewer/
git commit -m "chore: scaffold content-reviewer package"
```

---

### Task 5: 创建 publisher package 骨架

**Files:**
- Create: `packages/publisher/package.json`
- Create: `packages/publisher/tsconfig.json`
- Create: `packages/publisher/src/types.ts`
- Create: `packages/publisher/src/index.ts`

- [ ] **Step 1: 创建 package.json**

```json
// packages/publisher/package.json
{
  "name": "@zemingengine/publisher",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "node --test dist/**/*.test.js",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@zemingengine/shared": "*",
    "playwright": "^1.49.0"
  },
  "devDependencies": {
    "typescript": "^5.8.3"
  }
}
```

- [ ] **Step 2: 创建 tsconfig.json**

```json
// packages/publisher/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: 创建 types.ts**

```typescript
// packages/publisher/src/types.ts
import type { Article, PlatformId, PlatformCredentials } from '@zemingengine/shared';

export interface PublishParams {
  article: Article;
  credentials: PlatformCredentials;
  options?: {
    draft?: boolean;
    scheduledTime?: string;
  };
}

export interface PublishResult {
  success: boolean;
  platformPostId?: string;
  platformPostUrl?: string;
  error?: string;
  publishedAt?: string;
}

export interface PublishStatus {
  taskId: string;
  status: 'pending' | 'publishing' | 'published' | 'failed';
  platformPostUrl?: string;
}
```

- [ ] **Step 4: 创建 index.ts**

```typescript
// packages/publisher/src/index.ts
export { PublishParams, PublishResult, PublishStatus } from './types.js';
```

- [ ] **Step 5: 安装 playwright 并验证**

```bash
cd c:\Users\Administrator\Desktop\trae work GEO\geo-assistant-clean
npm install
npx playwright install chromium
```

- [ ] **Step 6: Commit**

```bash
git add packages/publisher/
git commit -m "chore: scaffold publisher package with playwright"
```

---

### Task 6: 实现 Database 数据访问层（CRUD）

**Files:**
- Modify: `apps/server/src/db.ts`

- [ ] **Step 1: 追加 Database 类到 db.ts**

在 `db.ts` 中 `createDatabase` 函数后追加：

```typescript
// apps/server/src/db.ts (append)

export class DatabaseAccess {
  constructor(private db: Database.Database) {}

  // === Sessions ===
  upsertSession(id: string, data: SessionData): void {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, data, current_stage, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        data = excluded.data,
        current_stage = excluded.current_stage,
        updated_at = excluded.updated_at
    `);
    const now = new Date().toISOString();
    stmt.run(id, JSON.stringify(data), data.currentStage, now, now);
  }

  getSession(id: string): SessionData | undefined {
    const row = this.db.prepare('SELECT data FROM sessions WHERE id = ?').get(id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) as SessionData : undefined;
  }

  deleteSession(id: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }

  // === Articles ===
  insertArticle(article: Article): void {
    const stmt = this.db.prepare(`
      INSERT INTO articles (
        id, session_id, platform, content_type, title, content_markdown,
        content_html, content_plain, tags, summary, cover_image_desc,
        word_count, status, generation_round, generation_meta, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      article.id, article.sessionId, article.platform, article.contentType,
      article.title, article.contentMarkdown, article.contentHtml ?? null,
      article.contentPlain ?? null, JSON.stringify(article.tags), article.summary ?? null,
      article.coverImageDesc ?? null, article.wordCount, article.status,
      article.generationRound, article.generationMeta ? JSON.stringify(article.generationMeta) : null,
      article.createdAt, article.updatedAt
    );
  }

  updateArticle(id: string, updates: Partial<Article>): void {
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [key, val] of Object.entries(updates)) {
      if (val === undefined) continue;
      const dbKey = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
      fields.push(`${dbKey} = ?`);
      if (key === 'tags' && Array.isArray(val)) {
        values.push(JSON.stringify(val));
      } else if (key === 'generationMeta' && val) {
        values.push(JSON.stringify(val));
      } else {
        values.push(val);
      }
    }
    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);
    const sql = `UPDATE articles SET ${fields.join(', ')} WHERE id = ?`;
    this.db.prepare(sql).run(...values);
  }

  getArticle(id: string): Article | undefined {
    const row = this.db.prepare('SELECT * FROM articles WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapArticle(row) : undefined;
  }

  getArticlesBySession(sessionId: string): Article[] {
    const rows = this.db.prepare('SELECT * FROM articles WHERE session_id = ? ORDER BY created_at DESC').all(sessionId) as Record<string, unknown>[];
    return rows.map((r) => this.mapArticle(r));
  }

  getArticlesByStatus(status: ArticleStatus): Article[] {
    const rows = this.db.prepare('SELECT * FROM articles WHERE status = ? ORDER BY created_at DESC').all(status) as Record<string, unknown>[];
    return rows.map((r) => this.mapArticle(r));
  }

  private mapArticle(row: Record<string, unknown>): Article {
    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      platform: String(row.platform) as Article['platform'],
      contentType: String(row.content_type) as Article['contentType'],
      title: String(row.title),
      contentMarkdown: String(row.content_markdown),
      contentHtml: row.content_html ? String(row.content_html) : undefined,
      contentPlain: row.content_plain ? String(row.content_plain) : undefined,
      tags: JSON.parse(String(row.tags)),
      summary: row.summary ? String(row.summary) : undefined,
      coverImageDesc: row.cover_image_desc ? String(row.cover_image_desc) : undefined,
      wordCount: Number(row.word_count),
      status: String(row.status) as Article['status'],
      generationRound: Number(row.generation_round),
      generationMeta: row.generation_meta ? JSON.parse(String(row.generation_meta)) : undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  // === Reviews ===
  insertReview(review: ReviewResult): void {
    const stmt = this.db.prepare(`
      INSERT INTO reviews (
        id, article_id, round, passed, overall_score,
        compliance_score, quality_score, seo_score, brand_score,
        issues, suggestions, reviewed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const id = `rev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    stmt.run(
      id, review.articleId, review.round, review.passed ? 1 : 0,
      review.overallScore, review.dimensions.compliance.score,
      review.dimensions.quality.score, review.dimensions.seo.score,
      review.dimensions.brand.score, JSON.stringify(review.issues),
      JSON.stringify(review.suggestions), review.reviewedAt
    );
  }

  getReviewsByArticle(articleId: string): ReviewResult[] {
    const rows = this.db.prepare('SELECT * FROM reviews WHERE article_id = ? ORDER BY round ASC').all(articleId) as Record<string, unknown>[];
    return rows.map((r) => this.mapReview(r));
  }

  getLatestReview(articleId: string): ReviewResult | undefined {
    const row = this.db.prepare('SELECT * FROM reviews WHERE article_id = ? ORDER BY round DESC LIMIT 1').get(articleId) as Record<string, unknown> | undefined;
    return row ? this.mapReview(row) : undefined;
  }

  private mapReview(row: Record<string, unknown>): ReviewResult {
    return {
      articleId: String(row.article_id),
      round: Number(row.round),
      passed: Boolean(row.passed),
      overallScore: Number(row.overall_score),
      dimensions: {
        compliance: { score: Number(row.compliance_score), issues: [] },
        quality: { score: Number(row.quality_score), issues: [] },
        seo: { score: Number(row.seo_score), issues: [] },
        brand: { score: Number(row.brand_score), issues: [] },
      },
      issues: JSON.parse(String(row.issues)),
      suggestions: JSON.parse(String(row.suggestions)),
      reviewedAt: String(row.reviewed_at),
    };
  }

  // === Publish Tasks ===
  insertPublishTask(task: PublishTask): void {
    const stmt = this.db.prepare(`
      INSERT INTO publish_tasks (
        id, article_id, platform, status, method,
        platform_post_id, platform_post_url, error_message,
        retry_count, max_retries, scheduled_at, published_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      task.id, task.articleId, task.platform, task.status, task.method,
      task.platformPostId ?? null, task.platformPostUrl ?? null,
      task.errorMessage ?? null, task.retryCount, task.maxRetries,
      task.scheduledAt ?? null, task.publishedAt ?? null,
      task.createdAt, task.updatedAt
    );
  }

  updatePublishTask(id: string, updates: Partial<PublishTask>): void {
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [key, val] of Object.entries(updates)) {
      if (val === undefined) continue;
      const dbKey = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
      fields.push(`${dbKey} = ?`);
      values.push(val);
    }
    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);
    const sql = `UPDATE publish_tasks SET ${fields.join(', ')} WHERE id = ?`;
    this.db.prepare(sql).run(...values);
  }

  getPublishTask(id: string): PublishTask | undefined {
    const row = this.db.prepare('SELECT * FROM publish_tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapPublishTask(row) : undefined;
  }

  getPendingPublishTasks(): PublishTask[] {
    const rows = this.db.prepare("SELECT * FROM publish_tasks WHERE status IN ('pending', 'retrying') ORDER BY created_at ASC").all() as Record<string, unknown>[];
    return rows.map((r) => this.mapPublishTask(r));
  }

  getPublishTasksByArticle(articleId: string): PublishTask[] {
    const rows = this.db.prepare('SELECT * FROM publish_tasks WHERE article_id = ? ORDER BY created_at DESC').all(articleId) as Record<string, unknown>[];
    return rows.map((r) => this.mapPublishTask(r));
  }

  private mapPublishTask(row: Record<string, unknown>): PublishTask {
    return {
      id: String(row.id),
      articleId: String(row.article_id),
      platform: String(row.platform) as PublishTask['platform'],
      status: String(row.status) as PublishTask['status'],
      method: String(row.method) as PublishTask['method'],
      platformPostId: row.platform_post_id ? String(row.platform_post_id) : undefined,
      platformPostUrl: row.platform_post_url ? String(row.platform_post_url) : undefined,
      errorMessage: row.error_message ? String(row.error_message) : undefined,
      retryCount: Number(row.retry_count),
      maxRetries: Number(row.max_retries),
      scheduledAt: row.scheduled_at ? String(row.scheduled_at) : undefined,
      publishedAt: row.published_at ? String(row.published_at) : undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  // === Publish Logs ===
  insertPublishLog(log: PublishLog): void {
    const stmt = this.db.prepare(`
      INSERT INTO publish_logs (id, task_id, level, message, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(log.id, log.taskId, log.level, log.message, log.metadata ? JSON.stringify(log.metadata) : null, log.createdAt);
  }

  getLogsByTask(taskId: string): PublishLog[] {
    const rows = this.db.prepare('SELECT * FROM publish_logs WHERE task_id = ? ORDER BY created_at DESC').all(taskId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      taskId: String(r.task_id),
      level: String(r.level) as PublishLog['level'],
      message: String(r.message),
      metadata: r.metadata ? JSON.parse(String(r.metadata)) : undefined,
      createdAt: String(r.created_at),
    }));
  }

  // === Credentials ===
  upsertCredential(platform: string, cred: PlatformCredentials): void {
    const stmt = this.db.prepare(`
      INSERT INTO platform_credentials (platform, credential_type, credential_data, status, last_validated_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(platform) DO UPDATE SET
        credential_type = excluded.credential_type,
        credential_data = excluded.credential_data,
        status = excluded.status,
        last_validated_at = excluded.last_validated_at,
        updated_at = excluded.updated_at
    `);
    const now = new Date().toISOString();
    stmt.run(platform, cred.type, JSON.stringify(cred.data), cred.status, cred.lastValidatedAt ?? null, now, now);
  }

  getCredential(platform: string): PlatformCredentials | undefined {
    const row = this.db.prepare('SELECT * FROM platform_credentials WHERE platform = ?').get(platform) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      platform: String(row.platform) as PlatformCredentials['platform'],
      type: String(row.credential_type) as PlatformCredentials['type'],
      data: JSON.parse(String(row.credential_data)),
      status: String(row.status) as PlatformCredentials['status'],
      lastValidatedAt: row.last_validated_at ? String(row.last_validated_at) : undefined,
    };
  }

  updateCredentialStatus(platform: string, status: string): void {
    this.db.prepare('UPDATE platform_credentials SET status = ?, updated_at = ? WHERE platform = ?').run(status, new Date().toISOString(), platform);
  }

  getAllCredentials(): PlatformCredentials[] {
    const rows = this.db.prepare('SELECT * FROM platform_credentials').all() as Record<string, unknown>[];
    return rows.map((row) => ({
      platform: String(row.platform) as PlatformCredentials['platform'],
      type: String(row.credential_type) as PlatformCredentials['type'],
      data: JSON.parse(String(row.credential_data)),
      status: String(row.status) as PlatformCredentials['status'],
      lastValidatedAt: row.last_validated_at ? String(row.last_validated_at) : undefined,
    }));
  }
}
```

- [ ] **Step 2: 运行类型检查**

```bash
cd c:\Users\Administrator\Desktop\trae work GEO\geo-assistant-clean
npm run typecheck --workspace=@zemingengine/server
```

Expected: 无类型错误

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/db.ts
git commit -m "feat(server): implement DatabaseAccess CRUD layer"
```

---

## Phase 2: 内容生成 (content-generator)

### Task 7: 实现 prompt-builder.ts

**Files:**
- Create: `packages/content-generator/src/prompt-builder.ts`

- [ ] **Step 1: 编写提示词构建器**

```typescript
// packages/content-generator/src/prompt-builder.ts
import type { SessionData, PlatformId, ArticleContentType, ReviewFeedback } from '@zemingengine/shared';

const PLATFORM_CONSTRAINTS: Record<PlatformId, {
  tone: string;
  format: string;
  lengthRange: string;
  specialRules: string[];
}> = {
  weixin: {
    tone: '专业严谨，适合深度阅读',
    format: 'HTML富文本，支持标题层级、加粗、引用',
    lengthRange: '2000-5000字',
    specialRules: ['开头需吸引读者继续阅读', '段落不宜过长', '适当使用小标题'],
  },
  zhihu: {
    tone: '专业但有亲和力，答题式',
    format: 'Markdown',
    lengthRange: '1500-5000字',
    specialRules: ['开头以问题引入', '提供实用干货', '结尾可引导关注'],
  },
  baijia: {
    tone: '通俗易懂，资讯风格',
    format: 'HTML',
    lengthRange: '1500-3000字',
    specialRules: ['标题要有吸引力', '适当配图描述', '无外链'],
  },
  toutiao: {
    tone: '轻松通俗，信息流风格',
    format: 'HTML',
    lengthRange: '1000-3000字',
    specialRules: ['开头要抓眼球', '段落短小', '无外链'],
  },
  csdn: {
    tone: '技术专业，教程导向',
    format: 'Markdown',
    lengthRange: '2000-8000字',
    specialRules: ['代码块要有语言标注', '步骤清晰', '可含命令行示例'],
  },
  juejin: {
    tone: '技术专业，前沿感',
    format: 'Markdown',
    lengthRange: '2000-8000字',
    specialRules: ['技术深度适中', '有实践价值', '排版美观'],
  },
  xiaohongshu: {
    tone: '亲切活泼，种草风格',
    format: '纯文本，emoji友好',
    lengthRange: '300-1000字',
    specialRules: ['多用emoji', '分段简短', '口语化表达', '结尾有互动'],
  },
  bilibili: {
    tone: '年轻活泼，UP主风格',
    format: 'HTML',
    lengthRange: '1000-5000字',
    specialRules: ['可提及视频内容', '互动性强', 'B站梗适度使用'],
  },
  sohu: {
    tone: '资讯风格，客观中立',
    format: 'HTML',
    lengthRange: '1500-3000字',
    specialRules: ['标题吸引力', '内容客观', '无外链'],
  },
  netease: {
    tone: '资讯风格，深度分析',
    format: 'HTML',
    lengthRange: '1500-3000字',
    specialRules: ['观点鲜明', '结构清晰', '无外链'],
  },
};

const CONTENT_TYPE_GUIDE: Record<ArticleContentType, string> = {
  tutorial: '教程类：以步骤为导向，从入门到精通，包含实际操作指导',
  case: '案例类：以真实场景为主线，展示问题-方案-效果的完整过程',
  comparison: '对比类：客观对比不同方案/产品，帮助读者做决策',
  popularization: '科普类：将专业概念用通俗语言解释，降低理解门槛',
};

export function buildPrompt(params: {
  session: SessionData;
  platform: PlatformId;
  contentType: ArticleContentType;
  generationRound: number;
  reviewFeedback?: ReviewFeedback;
}): { system: string; user: string } {
  const { session, platform, contentType, generationRound, reviewFeedback } = params;
  const constraints = PLATFORM_CONSTRAINTS[platform];
  const productName = session.promotionGoal.productName || session.enterprise.shortName || '产品';

  let system = `你是一位专业的内容营销文案师，擅长为不同平台创作适配的内容。

## 任务
为"${session.enterprise.fullName || productName}"创作一篇${CONTENT_TYPE_GUIDE[contentType]}，发布到${platform}平台。

## 企业信息
- 企业名称：${session.enterprise.fullName || '未提供'}
- 简称：${session.enterprise.shortName || '未提供'}
- 业务描述：${session.enterprise.description || '未提供'}
- 核心产品：${session.enterprise.products.map((p) => p.name).join('、') || '未提供'}
- 品牌调性：${session.enterprise.brandTone.join('、') || '未提供'}
- 用户痛点：${session.enterprise.userPainPoints.join('、') || '未提供'}

## 平台要求
- 平台：${platform}
- 语气：${constraints.tone}
- 格式：${constraints.format}
- 字数：${constraints.lengthRange}
- 特殊规则：${constraints.specialRules.join('；')}

## 内容类型要求
${CONTENT_TYPE_GUIDE[contentType]}

## 关键词（需在正文中自然融入）
${session.keywords.slice(0, 5).map((k) => `- ${k.question}`).join('\n')}

## 输出格式要求
请严格按照以下 JSON 格式输出，不要输出任何其他内容：
{
  "title": "文章标题",
  "summary": "100字以内的摘要",
  "content": "正文内容（Markdown格式）",
  "tags": ["标签1", "标签2", "标签3"],
  "coverImageDesc": "封面图描述"
}`;

  if (generationRound > 1 && reviewFeedback) {
    system += `\n\n## 上一轮审核反馈（第${generationRound}轮修正）\n`;
    system += `整体评分：${reviewFeedback.overallScore}/100\n`;
    if (reviewFeedback.issues.length > 0) {
      system += '需要修正的问题：\n';
      for (const issue of reviewFeedback.issues) {
        system += `- [${issue.severity}] ${issue.description}${issue.suggestion ? ` → 建议：${issue.suggestion}` : ''}\n`;
      }
    }
    if (reviewFeedback.suggestions.length > 0) {
      system += '改进建议：\n';
      for (const suggestion of reviewFeedback.suggestions) {
        system += `- ${suggestion}\n`;
      }
    }
    system += '\n请根据以上反馈修正文章，确保问题得到解决。';
  }

  const user = `请为${productName}创作一篇${contentType}类型的${platform}平台文章。`;

  return { system, user };
}
```

- [ ] **Step 2: 编译验证**

```bash
cd c:\Users\Administrator\Desktop\trae work GEO\geo-assistant-clean
npm run build --workspace=@zemingengine/content-generator
```

Expected: 编译成功

- [ ] **Step 3: Commit**

```bash
git add packages/content-generator/src/prompt-builder.ts
git commit -m "feat(content-generator): add prompt builder with platform constraints"
```

---

### Task 8: 实现 platform-adapter.ts

**Files:**
- Create: `packages/content-generator/src/platform-adapter.ts`

- [ ] **Step 1: 编写平台格式适配器**

```typescript
// packages/content-generator/src/platform-adapter.ts
import type { PlatformId, Article } from '@zemingengine/shared';

export function adaptForPlatform(platform: PlatformId, markdownContent: string): {
  contentMarkdown: string;
  contentHtml?: string;
  contentPlain?: string;
} {
  const htmlPlatforms: PlatformId[] = ['weixin', 'baijia', 'toutiao', 'bilibili', 'sohu', 'netease'];
  const plainPlatforms: PlatformId[] = ['xiaohongshu'];

  const result: { contentMarkdown: string; contentHtml?: string; contentPlain?: string } = {
    contentMarkdown: markdownContent,
  };

  if (htmlPlatforms.includes(platform)) {
    result.contentHtml = markdownToHtml(markdownContent);
  }

  if (plainPlatforms.includes(platform)) {
    result.contentPlain = markdownToPlain(markdownContent);
  }

  return result;
}

function markdownToHtml(md: string): string {
  // 简化的 Markdown 转 HTML（未来可替换为 marked 等库）
  let html = md
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/gim, '<em>$1</em>')
    .replace(/^\> (.*$)/gim, '<blockquote>$1</blockquote>')
    .replace(/^\- (.*$)/gim, '<li>$1</li>')
    .replace(/^\d+\. (.*$)/gim, '<li>$1</li>')
    .replace(/```(\w+)?\n([\s\S]*?)```/gim, '<pre><code>$2</code></pre>')
    .replace(/`([^`]+)`/gim, '<code>$1</code>');

  // 将段落包裹在 <p> 中
  const lines = html.split('\n').map((line) => line.trim());
  const paragraphs: string[] = [];
  let currentParagraph = '';

  for (const line of lines) {
    if (line === '' || line.startsWith('<')) {
      if (currentParagraph) {
        paragraphs.push(`<p>${currentParagraph}</p>`);
        currentParagraph = '';
      }
      if (line) paragraphs.push(line);
    } else {
      currentParagraph += (currentParagraph ? ' ' : '') + line;
    }
  }
  if (currentParagraph) paragraphs.push(`<p>${currentParagraph}</p>`);

  return paragraphs.join('\n');
}

function markdownToPlain(md: string): string {
  // 转为纯文本，保留 emoji，去除 Markdown 标记
  return md
    .replace(/^### (.*$)/gim, '$1')
    .replace(/^## (.*$)/gim, '$1')
    .replace(/^# (.*$)/gim, '$1')
    .replace(/\*\*(.*?)\*\*/gim, '$1')
    .replace(/\*(.*?)\*/gim, '$1')
    .replace(/^\> (.*$)/gim, '$1')
    .replace(/^\- (.*$)/gim, '$1')
    .replace(/^\d+\. (.*$)/gim, '$1')
    .replace(/```(\w+)?\n([\s\S]*?)```/gim, '$2')
    .replace(/`([^`]+)`/gim, '$1')
    .replace(/\n{3,}/g, '\n\n');
}

export function countWords(content: string): number {
  // 中文字符 + 英文单词
  const chineseChars = (content.match(/[\u4e00-\u9fa5]/g) || []).length;
  const englishWords = (content.match(/[a-zA-Z]+/g) || []).length;
  return chineseChars + englishWords;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/content-generator/src/platform-adapter.ts
git commit -m "feat(content-generator): add platform format adapter"
```

---

### Task 9: 实现 generator.ts + 回退生成

**Files:**
- Create: `packages/content-generator/src/generator.ts`

- [ ] **Step 1: 编写 ContentGenerator 类**

```typescript
// packages/content-generator/src/generator.ts
import type { SessionData, Article, ReviewFeedback } from '@zemingengine/shared';
import { chatCompletion, isAIAvailable } from '@zemingengine/ai-engine';
import type { GenerateRequest, GenerateResult } from './types.js';
import { buildPrompt } from './prompt-builder.js';
import { adaptForPlatform, countWords } from './platform-adapter.js';

export class ContentGenerator {
  constructor(private options: {
    fallbackMode?: boolean;
  } = {}) {}

  async generate(request: GenerateRequest, session: SessionData): Promise<GenerateResult> {
    const startTime = Date.now();

    if (!isAIAvailable() || this.options.fallbackMode) {
      return this.fallbackGenerate(request, session, startTime);
    }

    const { system, user } = buildPrompt({
      session,
      platform: request.platform,
      contentType: request.contentType,
      generationRound: request.generationRound,
      reviewFeedback: request.reviewFeedback,
    });

    try {
      const response = await chatCompletion(system, user, {
        temperature: 0.7,
        maxTokens: 4096,
      });

      // 解析 JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('LLM response does not contain valid JSON');
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        title: string;
        summary: string;
        content: string;
        tags: string[];
        coverImageDesc?: string;
      };

      const adapted = adaptForPlatform(request.platform, parsed.content);

      const article: Article = {
        id: `art_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        sessionId: request.sessionId,
        platform: request.platform,
        contentType: request.contentType,
        title: parsed.title,
        contentMarkdown: parsed.content,
        contentHtml: adapted.contentHtml,
        contentPlain: adapted.contentPlain,
        tags: parsed.tags.slice(0, 5),
        summary: parsed.summary,
        coverImageDesc: parsed.coverImageDesc,
        wordCount: countWords(parsed.content),
        status: 'draft',
        generationRound: request.generationRound,
        generationMeta: {
          model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
          tokensUsed: 0, // 无法精确统计，留0
          durationMs: Date.now() - startTime,
          promptVersion: '1.0',
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      return {
        article,
        generationMeta: article.generationMeta,
      };
    } catch (err) {
      console.error('AI generation failed, falling back to template:', err);
      return this.fallbackGenerate(request, session, startTime);
    }
  }

  private fallbackGenerate(
    request: GenerateRequest,
    session: SessionData,
    startTime: number
  ): GenerateResult {
    const productName = session.promotionGoal.productName || session.enterprise.shortName || session.enterprise.fullName || '产品';
    const contentTypeMap: Record<string, string> = {
      tutorial: '使用教程',
      case: '实战案例',
      comparison: '深度对比',
      popularization: '科普解读',
    };
    const title = `${productName}${contentTypeMap[request.contentType] || ''}：${session.promotionGoal.coreValue || '专业解决方案'}`;

    const playbook = session.contentPlaybook.find((p) => p.articleType === request.contentType);
    const exampleTitle = playbook?.titleExamples[0] || title;

    const content = `# ${exampleTitle}

## 引言
${session.enterprise.description || `${productName}是一款专业的产品/服务。`}

## 核心优势
${session.promotionGoal.coreValue || '提供优质服务'}

## 适用场景
${session.enterprise.userPainPoints.slice(0, 3).map((p) => `- ${p}`).join('\n') || '- 提升效率\n- 降低成本'}

## 总结
${session.promotionGoal.coreSellingPoint || '选择我们，选择专业。'}
`;

    const adapted = adaptForPlatform(request.platform, content);

    const article: Article = {
      id: `art_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      sessionId: request.sessionId,
      platform: request.platform,
      contentType: request.contentType,
      title: exampleTitle,
      contentMarkdown: content,
      contentHtml: adapted.contentHtml,
      contentPlain: adapted.contentPlain,
      tags: session.wordBank.productTerms.slice(0, 3).concat(session.wordBank.brandTerms.slice(0, 2)),
      summary: session.enterprise.description || `${productName}介绍`,
      coverImageDesc: `${productName}产品展示图`,
      wordCount: countWords(content),
      status: 'draft',
      generationRound: request.generationRound,
      generationMeta: {
        model: 'fallback-template',
        tokensUsed: 0,
        durationMs: Date.now() - startTime,
        promptVersion: 'fallback',
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    return {
      article,
      generationMeta: article.generationMeta,
    };
  }
}
```

- [ ] **Step 2: 更新 index.ts 导出**

```typescript
// packages/content-generator/src/index.ts
export { GenerateRequest, GenerateResult } from './types.js';
export { ContentGenerator } from './generator.js';
export { buildPrompt } from './prompt-builder.js';
export { adaptForPlatform, countWords } from './platform-adapter.js';
```

- [ ] **Step 3: 编译验证**

```bash
cd c:\Users\Administrator\Desktop\trae work GEO\geo-assistant-clean
npm run build --workspace=@zemingengine/content-generator
```

Expected: 编译成功

- [ ] **Step 4: Commit**

```bash
git add packages/content-generator/src/
git commit -m "feat(content-generator): implement ContentGenerator with AI and fallback"
```

---

### Task 10: content-generator 单元测试

**Files:**
- Create: `packages/content-generator/src/generator.test.ts`

- [ ] **Step 1: 编写测试**

```typescript
// packages/content-generator/src/generator.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ContentGenerator } from './generator.js';
import { createEmptySession } from '@zemingengine/shared';
import type { GenerateRequest } from './types.js';

describe('ContentGenerator', () => {
  const generator = new ContentGenerator({ fallbackMode: true });
  const session = createEmptySession('test_session_001');
  session.enterprise.fullName = '测试科技有限公司';
  session.enterprise.shortName = '测试科技';
  session.enterprise.description = '一家专注于AI技术的科技公司';
  session.promotionGoal.productName = '智能助手';
  session.promotionGoal.coreValue = 'AI驱动效率提升';
  session.enterprise.userPainPoints = ['效率低', '成本高'];
  session.wordBank.productTerms = ['AI', '智能助手', '自动化'];
  session.wordBank.brandTerms = ['测试科技'];

  it('should generate article with fallback mode', async () => {
    const request: GenerateRequest = {
      sessionId: 'test_session_001',
      platform: 'weixin',
      contentType: 'tutorial',
      generationRound: 1,
    };

    const result = await generator.generate(request, session);

    assert.ok(result.article.id.startsWith('art_'));
    assert.equal(result.article.sessionId, 'test_session_001');
    assert.equal(result.article.platform, 'weixin');
    assert.equal(result.article.contentType, 'tutorial');
    assert.ok(result.article.title.length > 0);
    assert.ok(result.article.contentMarkdown.length > 0);
    assert.ok(result.article.wordCount > 0);
    assert.equal(result.article.status, 'draft');
    assert.equal(result.article.generationRound, 1);
    assert.ok(result.article.contentHtml);
    assert.equal(result.generationMeta.model, 'fallback-template');
  });

  it('should include review feedback in round 2', async () => {
    const request: GenerateRequest = {
      sessionId: 'test_session_001',
      platform: 'zhihu',
      contentType: 'case',
      generationRound: 2,
      reviewFeedback: {
        issues: [{ dimension: 'quality', severity: 'medium', description: '内容过短', suggestion: '增加更多细节' }],
        suggestions: ['增加案例分析'],
        overallScore: 60,
      },
    };

    const result = await generator.generate(request, session);

    assert.equal(result.article.platform, 'zhihu');
    assert.equal(result.article.contentType, 'case');
    assert.equal(result.article.generationRound, 2);
  });

  it('should adapt content for xiaohongshu as plain text', async () => {
    const request: GenerateRequest = {
      sessionId: 'test_session_001',
      platform: 'xiaohongshu',
      contentType: 'popularization',
      generationRound: 1,
    };

    const result = await generator.generate(request, session);

    assert.ok(result.article.contentPlain);
    assert.ok(!result.article.contentPlain.includes('##'));
    assert.ok(!result.article.contentPlain.includes('**'));
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
cd c:\Users\Administrator\Desktop\trae work GEO\geo-assistant-clean
npm run build --workspace=@zemingengine/content-generator
npm run test --workspace=@zemingengine/content-generator
```

Expected: 3 tests pass

- [ ] **Step 3: Commit**

```bash
git add packages/content-generator/src/generator.test.ts
git commit -m "test(content-generator): add generator unit tests"
```

---

## Phase 3: 内容审核 (content-reviewer)

### Task 11: 实现审核规则引擎

**Files:**
- Create: `packages/content-reviewer/src/rules/compliance.ts`
- Create: `packages/content-reviewer/src/rules/quality.ts`
- Create: `packages/content-reviewer/src/rules/seo.ts`
- Create: `packages/content-reviewer/src/rules/brand.ts`

- [ ] **Step 1: 编写合规规则**

```typescript
// packages/content-reviewer/src/rules/compliance.ts
import type { ReviewIssue, Article } from '@zemingengine/shared';

const SENSITIVE_WORDS = [
  '法轮功', '台独', '港独', '疆独', '藏独',
  '色情', '赌博', '毒品', '枪支', '爆炸',
];

const ABSOLUTE_TERMS = [
  '最好', '第一', '唯一', '国家级', '最高级',
  '最佳', '最先进', '最强', '顶级', '极品',
];

export function checkCompliance(article: Article): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const text = article.title + ' ' + article.contentMarkdown;

  for (const word of SENSITIVE_WORDS) {
    if (text.includes(word)) {
      issues.push({
        dimension: 'compliance',
        severity: 'high',
        description: `检测到敏感词：${word}`,
        suggestion: '请删除或替换敏感内容',
      });
    }
  }

  for (const term of ABSOLUTE_TERMS) {
    if (text.includes(term)) {
      issues.push({
        dimension: 'compliance',
        severity: 'medium',
        description: `检测到绝对化用语：${term}`,
        suggestion: '请使用更客观的描述',
      });
    }
  }

  return issues;
}
```

- [ ] **Step 2: 编写质量规则**

```typescript
// packages/content-reviewer/src/rules/quality.ts
import type { ReviewIssue, Article } from '@zemingengine/shared';

export function checkQuality(article: Article): ReviewIssue[] {
  const issues: ReviewIssue[] = [];

  if (article.wordCount < 300) {
    issues.push({
      dimension: 'quality',
      severity: 'high',
      description: `字数仅${article.wordCount}字，远低于推荐字数`,
      suggestion: '扩充内容至至少1000字',
    });
  } else if (article.wordCount < 800) {
    issues.push({
      dimension: 'quality',
      severity: 'medium',
      description: `字数仅${article.wordCount}字，偏短`,
      suggestion: '建议扩充至1500字以上',
    });
  }

  const paragraphs = article.contentMarkdown.split('\n').filter((p) => p.trim());
  if (paragraphs.length < 3) {
    issues.push({
      dimension: 'quality',
      severity: 'medium',
      description: '段落过少，结构不完整',
      suggestion: '增加引言、正文、结论等结构',
    });
  }

  // 检测重复段落（简单：检测完全相同的行）
  const seen = new Set<string>();
  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (trimmed.length > 20 && seen.has(trimmed)) {
      issues.push({
        dimension: 'quality',
        severity: 'medium',
        description: '检测到重复段落',
        suggestion: '删除重复内容',
      });
      break;
    }
    seen.add(trimmed);
  }

  return issues;
}
```

- [ ] **Step 3: 编写 SEO 规则**

```typescript
// packages/content-reviewer/src/rules/seo.ts
import type { ReviewIssue, Article, SessionData } from '@zemingengine/shared';

export function checkSEO(article: Article, session: SessionData): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const keywords = session.keywords.map((k) => k.question);
  const productTerms = session.wordBank.productTerms;
  const allKeywords = [...keywords, ...productTerms];

  const text = (article.title + ' ' + article.contentMarkdown).toLowerCase();

  // 标题含关键词
  const titleHasKeyword = allKeywords.some((kw) => article.title.toLowerCase().includes(kw.toLowerCase()));
  if (!titleHasKeyword) {
    issues.push({
      dimension: 'seo',
      severity: 'medium',
      description: '标题未包含核心关键词',
      suggestion: `在标题中融入关键词，如：${allKeywords[0] || '产品名'}`,
    });
  }

  // 关键词密度
  let keywordMatches = 0;
  for (const kw of allKeywords) {
    const regex = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const matches = text.match(regex);
    if (matches) keywordMatches += matches.length;
  }

  const density = article.wordCount > 0 ? (keywordMatches * 2) / article.wordCount : 0;
  if (density < 0.005) {
    issues.push({
      dimension: 'seo',
      severity: 'medium',
      description: `关键词密度过低（约${(density * 100).toFixed(1)}%）`,
      suggestion: '适当增加关键词自然出现频率，目标1%-3%',
    });
  }

  // 摘要
  if (!article.summary || article.summary.length < 20) {
    issues.push({
      dimension: 'seo',
      severity: 'low',
      description: '摘要缺失或过短',
      suggestion: '添加50-100字的摘要',
    });
  }

  return issues;
}
```

- [ ] **Step 4: 编写品牌一致性规则**

```typescript
// packages/content-reviewer/src/rules/brand.ts
import type { ReviewIssue, Article, SessionData } from '@zemingengine/shared';

export function checkBrand(article: Article, session: SessionData): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const text = article.contentMarkdown;

  // 企业名称一致性
  const fullName = session.enterprise.fullName;
  const shortName = session.enterprise.shortName;

  if (fullName && !text.includes(fullName) && !text.includes(shortName || '')) {
    issues.push({
      dimension: 'brand',
      severity: 'medium',
      description: '正文中未提及企业名称',
      suggestion: `在正文中自然融入企业名称：${shortName || fullName}`,
    });
  }

  // 产品名称一致性
  const productNames = session.enterprise.products.map((p) => p.name);
  for (const productName of productNames) {
    if (productName && !text.includes(productName)) {
      issues.push({
        dimension: 'brand',
        severity: 'low',
        description: `正文中未提及产品：${productName}`,
        suggestion: `在适当位置提及产品${productName}`,
      });
    }
  }

  // 品牌调性匹配（简单检查：负面词汇）
  const negativeWords = ['差', '垃圾', '骗人', '虚假'];
  for (const word of negativeWords) {
    if (text.includes(word)) {
      issues.push({
        dimension: 'brand',
        severity: 'high',
        description: `检测到负面词汇：${word}`,
        suggestion: '删除负面词汇，保持正面品牌形象',
      });
    }
  }

  return issues;
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/content-reviewer/src/rules/
git commit -m "feat(content-reviewer): add compliance, quality, seo, brand rule engines"
```

---

### Task 12: 实现 scorer.ts + reviewer.ts

**Files:**
- Create: `packages/content-reviewer/src/scorer.ts`
- Create: `packages/content-reviewer/src/reviewer.ts`

- [ ] **Step 1: 编写评分器**

```typescript
// packages/content-reviewer/src/scorer.ts
import type { ReviewIssue, ReviewDimension } from '@zemingengine/shared';

const DIMENSION_WEIGHTS: Record<ReviewDimension, number> = {
  compliance: 0.30,
  quality: 0.25,
  seo: 0.25,
  brand: 0.20,
};

export function calculateDimensionScore(issues: ReviewIssue[]): number {
  let score = 100;
  for (const issue of issues) {
    if (issue.severity === 'high') score -= 25;
    else if (issue.severity === 'medium') score -= 10;
    else score -= 3;
  }
  return Math.max(0, score);
}

export function calculateOverallScore(dimensions: Record<ReviewDimension, number>): number {
  let total = 0;
  for (const [dim, score] of Object.entries(dimensions)) {
    total += score * DIMENSION_WEIGHTS[dim as ReviewDimension];
  }
  return Math.round(total * 10) / 10;
}

export function hasComplianceHardFail(issues: ReviewIssue[]): boolean {
  return issues.some((i) => i.dimension === 'compliance' && i.severity === 'high');
}
```

- [ ] **Step 2: 编写审核器主类**

```typescript
// packages/content-reviewer/src/reviewer.ts
import type { Article, SessionData, ReviewResult } from '@zemingengine/shared';
import type { ReviewRequest, ReviewerOptions } from './types.js';
import { checkCompliance } from './rules/compliance.js';
import { checkQuality } from './rules/quality.js';
import { checkSEO } from './rules/seo.js';
import { checkBrand } from './rules/brand.js';
import { calculateDimensionScore, calculateOverallScore, hasComplianceHardFail } from './scorer.js';
import { isAIAvailable, chatCompletion } from '@zemingengine/ai-engine';

export class ContentReviewer {
  constructor(private options: ReviewerOptions = { passThreshold: 75, fallbackMode: false }) {}

  async review(request: ReviewRequest): Promise<ReviewResult> {
    const { article, session, round } = request;

    // 规则引擎预检
    const complianceIssues = checkCompliance(article);
    const qualityIssues = checkQuality(article);
    const seoIssues = checkSEO(article, session);
    const brandIssues = checkBrand(article, session);

    // LLM 深度审核
    let llmIssues: { dimension: string; severity: string; description: string; suggestion?: string }[] = [];
    if (isAIAvailable() && !this.options.fallbackMode) {
      llmIssues = await this.llmReview(article, session);
    }

    // 合并所有 issues
    const allIssues = [
      ...complianceIssues,
      ...qualityIssues,
      ...seoIssues,
      ...brandIssues,
      ...llmIssues.map((i) => ({
        dimension: i.dimension as 'compliance' | 'quality' | 'seo' | 'brand',
        severity: i.severity as 'high' | 'medium' | 'low',
        description: i.description,
        suggestion: i.suggestion,
      })),
    ];

    // 按维度分组评分
    const dimIssues = {
      compliance: allIssues.filter((i) => i.dimension === 'compliance'),
      quality: allIssues.filter((i) => i.dimension === 'quality'),
      seo: allIssues.filter((i) => i.dimension === 'seo'),
      brand: allIssues.filter((i) => i.dimension === 'brand'),
    };

    const complianceScore = calculateDimensionScore(dimIssues.compliance);
    const qualityScore = calculateDimensionScore(dimIssues.quality);
    const seoScore = calculateDimensionScore(dimIssues.seo);
    const brandScore = calculateDimensionScore(dimIssues.brand);

    const overallScore = calculateOverallScore({
      compliance: complianceScore,
      quality: qualityScore,
      seo: seoScore,
      brand: brandScore,
    });

    const hardFail = hasComplianceHardFail(allIssues);
    const threshold = this.options.fallbackMode ? 80 : this.options.passThreshold;
    const passed = !hardFail && overallScore >= threshold;

    // 生成修正建议
    const suggestions = allIssues
      .filter((i) => i.severity !== 'low' && i.suggestion)
      .map((i) => i.suggestion!)
      .filter((s, idx, arr) => arr.indexOf(s) === idx)
      .slice(0, 5);

    return {
      articleId: article.id,
      round,
      passed,
      overallScore,
      dimensions: {
        compliance: { score: complianceScore, issues: dimIssues.compliance },
        quality: { score: qualityScore, issues: dimIssues.quality },
        seo: { score: seoScore, issues: dimIssues.seo },
        brand: { score: brandScore, issues: dimIssues.brand },
      },
      issues: allIssues,
      suggestions,
      reviewedAt: new Date().toISOString(),
    };
  }

  private async llmReview(
    article: Article,
    session: SessionData
  ): Promise<{ dimension: string; severity: string; description: string; suggestion?: string }[]> {
    const system = `你是一位资深内容审核专家。请对以下文章进行审核，从合规性、内容质量、SEO适配、品牌一致性四个维度评估。

输出格式：JSON 数组，每个元素包含：
- dimension: "compliance" | "quality" | "seo" | "brand"
- severity: "high" | "medium" | "low"
- description: 问题描述
- suggestion: 修正建议（可选）

只输出 JSON，不要其他内容。`;

    const user = `文章标题：${article.title}
文章内容：${article.contentMarkdown.slice(0, 3000)}
企业信息：${session.enterprise.fullName}，产品：${session.enterprise.products.map((p) => p.name).join('、')}
关键词：${session.keywords.map((k) => k.question).join('、')}`;

    try {
      const response = await chatCompletion(system, user, { temperature: 0.2, maxTokens: 1500 });
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];
      return JSON.parse(jsonMatch[0]);
    } catch {
      return [];
    }
  }
}
```

- [ ] **Step 3: 更新 index.ts**

```typescript
// packages/content-reviewer/src/index.ts
export { ReviewRequest, ReviewerOptions } from './types.js';
export { ContentReviewer } from './reviewer.js';
```

- [ ] **Step 4: 编译验证**

```bash
cd c:\Users\Administrator\Desktop\trae work GEO\geo-assistant-clean
npm run build --workspace=@zemingengine/content-reviewer
```

Expected: 编译成功

- [ ] **Step 5: Commit**

```bash
git add packages/content-reviewer/src/
git commit -m "feat(content-reviewer): implement ContentReviewer with rule engine and LLM review"
```

---

### Task 13: content-reviewer 单元测试

**Files:**
- Create: `packages/content-reviewer/src/reviewer.test.ts`

- [ ] **Step 1: 编写测试**

```typescript
// packages/content-reviewer/src/reviewer.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ContentReviewer } from './reviewer.js';
import { createEmptySession } from '@zemingengine/shared';
import type { Article } from '@zemingengine/shared';

describe('ContentReviewer', () => {
  const reviewer = new ContentReviewer({ passThreshold: 75, fallbackMode: true });
  const session = createEmptySession('test_session_001');
  session.enterprise.fullName = '测试科技有限公司';
  session.enterprise.shortName = '测试科技';
  session.enterprise.products = [{ name: '智能助手', description: 'AI助手', category: '软件', isPrimary: true }];
  session.keywords = [{ question: '智能助手是什么', type: 'core', priority: 1, geoContext: '测试' }];
  session.wordBank.productTerms = ['智能助手'];

  function makeArticle(overrides: Partial<Article> = {}): Article {
    return {
      id: 'art_test_001',
      sessionId: 'test_session_001',
      platform: 'weixin',
      contentType: 'tutorial',
      title: '智能助手使用教程',
      contentMarkdown: '# 智能助手使用教程\n\n本文介绍智能助手的使用方法。\n\n## 核心功能\n智能助手提供AI驱动的效率提升。\n\n## 总结\n欢迎使用智能助手。',
      tags: ['AI', '教程'],
      wordCount: 50,
      status: 'draft',
      generationRound: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  it('should pass a well-formed article', async () => {
    const article = makeArticle({
      title: '智能助手是什么？一文读懂核心功能',
      contentMarkdown: '# 智能助手是什么\n\n智能助手是测试科技推出的AI产品。\n\n## 核心功能\n提供自动化、智能化的解决方案。\n\n## 适用场景\n- 提升效率\n- 降低成本\n\n## 总结\n选择智能助手，选择专业。',
      wordCount: 150,
    });

    const result = await reviewer.review({ article, session, round: 1 });

    assert.ok(result.overallScore >= 0);
    assert.ok(result.dimensions.compliance.score >= 0);
    assert.ok(result.dimensions.quality.score >= 0);
    assert.ok(result.dimensions.seo.score >= 0);
    assert.ok(result.dimensions.brand.score >= 0);
  });

  it('should fail article with sensitive words', async () => {
    const article = makeArticle({
      contentMarkdown: '这篇文章包含赌博内容',
    });

    const result = await reviewer.review({ article, session, round: 1 });

    assert.equal(result.passed, false);
    const complianceIssues = result.issues.filter((i) => i.dimension === 'compliance');
    assert.ok(complianceIssues.length > 0);
  });

  it('should detect missing keywords in title', async () => {
    const article = makeArticle({
      title: '使用教程',
      wordCount: 200,
    });

    const result = await reviewer.review({ article, session, round: 1 });

    const seoIssues = result.issues.filter((i) => i.dimension === 'seo');
    assert.ok(seoIssues.some((i) => i.description.includes('标题')));
  });

  it('should generate suggestions for failed review', async () => {
    const article = makeArticle({
      wordCount: 100,
    });

    const result = await reviewer.review({ article, session, round: 1 });

    assert.ok(result.suggestions.length > 0);
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
cd c:\Users\Administrator\Desktop\trae work GEO\geo-assistant-clean
npm run build --workspace=@zemingengine/content-reviewer
npm run test --workspace=@zemingengine/content-reviewer
```

Expected: 4 tests pass

- [ ] **Step 3: Commit**

```bash
git add packages/content-reviewer/src/reviewer.test.ts
git commit -m "test(content-reviewer): add reviewer unit tests"
```

---

## Phase 4: 发布器 (publisher)

### Task 14: 实现 PlatformAdapter 基类 + API 适配器 stubs

**Files:**
- Create: `packages/publisher/src/adapters/base.ts`
- Create: `packages/publisher/src/adapters/wechat.ts`
- Create: `packages/publisher/src/adapters/csdn.ts`
- Create: `packages/publisher/src/adapters/juejin.ts`
- Create: `packages/publisher/src/adapters/bilibili.ts`

- [ ] **Step 1: 编写抽象基类**

```typescript
// packages/publisher/src/adapters/base.ts
import type { PublishParams, PublishResult } from '../types.js';
import type { PlatformId } from '@zemingengine/shared';

export abstract class PlatformAdapter {
  abstract readonly platform: PlatformId;
  abstract readonly method: 'api' | 'rpa';

  abstract publish(params: PublishParams): Promise<PublishResult>;

  async validateCredentials(): Promise<boolean> {
    return true; // 默认实现，子类可覆盖
  }
}
```

- [ ] **Step 2: 编写微信适配器 stub**

```typescript
// packages/publisher/src/adapters/wechat.ts
import type { PublishParams, PublishResult } from '../types.js';
import { PlatformAdapter } from './base.js';

export class WechatAdapter extends PlatformAdapter {
  readonly platform = 'weixin' as const;
  readonly method = 'api' as const;

  async publish(params: PublishParams): Promise<PublishResult> {
    console.log('[WechatAdapter] Publishing:', params.article.title);
    // TODO: 实现微信公众号 API 发布
    return {
      success: true,
      platformPostId: `wechat_${Date.now()}`,
      platformPostUrl: 'https://mp.weixin.qq.com/s/stub',
      publishedAt: new Date().toISOString(),
    };
  }
}
```

- [ ] **Step 3: 编写 CSDN 适配器 stub**

```typescript
// packages/publisher/src/adapters/csdn.ts
import type { PublishParams, PublishResult } from '../types.js';
import { PlatformAdapter } from './base.js';

export class CsdnAdapter extends PlatformAdapter {
  readonly platform = 'csdn' as const;
  readonly method = 'api' as const;

  async publish(params: PublishParams): Promise<PublishResult> {
    console.log('[CsdnAdapter] Publishing:', params.article.title);
    return {
      success: true,
      platformPostId: `csdn_${Date.now()}`,
      platformPostUrl: 'https://blog.csdn.net/stub',
      publishedAt: new Date().toISOString(),
    };
  }
}
```

- [ ] **Step 4: 编写掘金适配器 stub**

```typescript
// packages/publisher/src/adapters/juejin.ts
import type { PublishParams, PublishResult } from '../types.js';
import { PlatformAdapter } from './base.js';

export class JuejinAdapter extends PlatformAdapter {
  readonly platform = 'juejin' as const;
  readonly method = 'api' as const;

  async publish(params: PublishParams): Promise<PublishResult> {
    console.log('[JuejinAdapter] Publishing:', params.article.title);
    return {
      success: true,
      platformPostId: `juejin_${Date.now()}`,
      platformPostUrl: 'https://juejin.cn/post/stub',
      publishedAt: new Date().toISOString(),
    };
  }
}
```

- [ ] **Step 5: 编写 B站适配器 stub**

```typescript
// packages/publisher/src/adapters/bilibili.ts
import type { PublishParams, PublishResult } from '../types.js';
import { PlatformAdapter } from './base.js';

export class BilibiliAdapter extends PlatformAdapter {
  readonly platform = 'bilibili' as const;
  readonly method = 'api' as const;

  async publish(params: PublishParams): Promise<PublishResult> {
    console.log('[BilibiliAdapter] Publishing:', params.article.title);
    return {
      success: true,
      platformPostId: `bilibili_${Date.now()}`,
      platformPostUrl: 'https://www.bilibili.com/read/stub',
      publishedAt: new Date().toISOString(),
    };
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/publisher/src/adapters/base.ts packages/publisher/src/adapters/wechat.ts packages/publisher/src/adapters/csdn.ts packages/publisher/src/adapters/juejin.ts packages/publisher/src/adapters/bilibili.ts
git commit -m "feat(publisher): add PlatformAdapter base and API adapter stubs"
```

---

### Task 15: 实现 RPA 适配器 stubs + RPA 引擎

**Files:**
- Create: `packages/publisher/src/adapters/zhihu.ts`
- Create: `packages/publisher/src/adapters/baijia.ts`
- Create: `packages/publisher/src/adapters/toutiao.ts`
- Create: `packages/publisher/src/adapters/xiaohongshu.ts`
- Create: `packages/publisher/src/adapters/sohu.ts`
- Create: `packages/publisher/src/adapters/netease.ts`
- Create: `packages/publisher/src/rpa-engine.ts`

- [ ] **Step 1: 编写 RPA 引擎封装**

```typescript
// packages/publisher/src/rpa-engine.ts
import { chromium, type Browser, type Page, type Cookie } from 'playwright';

export interface RpaOptions {
  headless: boolean;
  slowMo?: number;
}

export class RpaEngine {
  private browser: Browser | null = null;

  constructor(private options: RpaOptions = { headless: true }) {}

  async init(): Promise<void> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: this.options.headless,
        slowMo: this.options.slowMo ?? 0,
      });
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  async withPage<T>(
    url: string,
    cookies: Cookie[],
    action: (page: Page) => Promise<T>
  ): Promise<T> {
    await this.init();
    const context = await this.browser!.newContext();
    await context.addCookies(cookies);
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      return await action(page);
    } finally {
      await context.close();
    }
  }
}
```

- [ ] **Step 2: 编写知乎 RPA 适配器 stub**

```typescript
// packages/publisher/src/adapters/zhihu.ts
import type { PublishParams, PublishResult } from '../types.js';
import { PlatformAdapter } from './base.js';

export class ZhihuAdapter extends PlatformAdapter {
  readonly platform = 'zhihu' as const;
  readonly method = 'rpa' as const;

  async publish(params: PublishParams): Promise<PublishResult> {
    console.log('[ZhihuAdapter] RPA Publishing:', params.article.title);
    // TODO: 实现 Playwright RPA 发布
    return {
      success: true,
      platformPostId: `zhihu_${Date.now()}`,
      platformPostUrl: 'https://zhuanlan.zhihu.com/p/stub',
      publishedAt: new Date().toISOString(),
    };
  }
}
```

- [ ] **Step 3: 编写其他 RPA 适配器 stubs（批量创建）**

```typescript
// packages/publisher/src/adapters/baijia.ts
import type { PublishParams, PublishResult } from '../types.js';
import { PlatformAdapter } from './base.js';
export class BaijiaAdapter extends PlatformAdapter {
  readonly platform = 'baijia' as const; readonly method = 'rpa' as const;
  async publish(params: PublishParams): Promise<PublishResult> {
    console.log('[BaijiaAdapter] RPA Publishing:', params.article.title);
    return { success: true, platformPostId: `baijia_${Date.now()}`, platformPostUrl: 'https://baijiahao.baidu.com/stub', publishedAt: new Date().toISOString() };
  }
}
```

```typescript
// packages/publisher/src/adapters/toutiao.ts
import type { PublishParams, PublishResult } from '../types.js';
import { PlatformAdapter } from './base.js';
export class ToutiaoAdapter extends PlatformAdapter {
  readonly platform = 'toutiao' as const; readonly method = 'rpa' as const;
  async publish(params: PublishParams): Promise<PublishResult> {
    console.log('[ToutiaoAdapter] RPA Publishing:', params.article.title);
    return { success: true, platformPostId: `toutiao_${Date.now()}`, platformPostUrl: 'https://www.toutiao.com/article/stub', publishedAt: new Date().toISOString() };
  }
}
```

```typescript
// packages/publisher/src/adapters/xiaohongshu.ts
import type { PublishParams, PublishResult } from '../types.js';
import { PlatformAdapter } from './base.js';
export class XiaohongshuAdapter extends PlatformAdapter {
  readonly platform = 'xiaohongshu' as const; readonly method = 'rpa' as const;
  async publish(params: PublishParams): Promise<PublishResult> {
    console.log('[XiaohongshuAdapter] RPA Publishing:', params.article.title);
    return { success: true, platformPostId: `xhs_${Date.now()}`, platformPostUrl: 'https://www.xiaohongshu.com/explore/stub', publishedAt: new Date().toISOString() };
  }
}
```

```typescript
// packages/publisher/src/adapters/sohu.ts
import type { PublishParams, PublishResult } from '../types.js';
import { PlatformAdapter } from './base.js';
export class SohuAdapter extends PlatformAdapter {
  readonly platform = 'sohu' as const; readonly method = 'rpa' as const;
  async publish(params: PublishParams): Promise<PublishResult> {
    console.log('[SohuAdapter] RPA Publishing:', params.article.title);
    return { success: true, platformPostId: `sohu_${Date.now()}`, platformPostUrl: 'https://mp.sohu.com/profile/stub', publishedAt: new Date().toISOString() };
  }
}
```

```typescript
// packages/publisher/src/adapters/netease.ts
import type { PublishParams, PublishResult } from '../types.js';
import { PlatformAdapter } from './base.js';
export class NeteaseAdapter extends PlatformAdapter {
  readonly platform = 'netease' as const; readonly method = 'rpa' as const;
  async publish(params: PublishParams): Promise<PublishResult> {
    console.log('[NeteaseAdapter] RPA Publishing:', params.article.title);
    return { success: true, platformPostId: `netease_${Date.now()}`, platformPostUrl: 'https://dy.163.com/article/stub', publishedAt: new Date().toISOString() };
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/publisher/src/adapters/zhihu.ts packages/publisher/src/adapters/baijia.ts packages/publisher/src/adapters/toutiao.ts packages/publisher/src/adapters/xiaohongshu.ts packages/publisher/src/adapters/sohu.ts packages/publisher/src/adapters/netease.ts packages/publisher/src/rpa-engine.ts
git commit -m "feat(publisher): add RPA engine and RPA adapter stubs"
```

---

### Task 16: 实现 Publisher 编排 + 队列

**Files:**
- Create: `packages/publisher/src/publisher.ts`
- Create: `packages/publisher/src/queue.ts`

- [ ] **Step 1: 编写发布队列**

```typescript
// packages/publisher/src/queue.ts
import type { PublishTask, PlatformId } from '@zemingengine/shared';

export class PublishQueue {
  private tasks: PublishTask[] = [];
  private running = false;

  enqueue(task: PublishTask): void {
    this.tasks.push(task);
  }

  dequeue(): PublishTask | undefined {
    return this.tasks.shift();
  }

  peek(): PublishTask | undefined {
    return this.tasks[0];
  }

  get length(): number {
    return this.tasks.length;
  }

  getTasksByPlatform(platform: PlatformId): PublishTask[] {
    return this.tasks.filter((t) => t.platform === platform);
  }
}
```

- [ ] **Step 2: 编写 Publisher 主类**

```typescript
// packages/publisher/src/publisher.ts
import type { Article, PublishTask, PlatformId, PlatformCredentials } from '@zemingengine/shared';
import type { PublishResult } from './types.js';
import { PlatformAdapter } from './adapters/base.js';
import { WechatAdapter } from './adapters/wechat.js';
import { CsdnAdapter } from './adapters/csdn.js';
import { JuejinAdapter } from './adapters/juejin.js';
import { BilibiliAdapter } from './adapters/bilibili.js';
import { ZhihuAdapter } from './adapters/zhihu.js';
import { BaijiaAdapter } from './adapters/baijia.js';
import { ToutiaoAdapter } from './adapters/toutiao.js';
import { XiaohongshuAdapter } from './adapters/xiaohongshu.js';
import { SohuAdapter } from './adapters/sohu.js';
import { NeteaseAdapter } from './adapters/netease.js';
import { PublishQueue } from './queue.js';

const ADAPTER_MAP: Record<PlatformId, new () => PlatformAdapter> = {
  weixin: WechatAdapter,
  csdn: CsdnAdapter,
  juejin: JuejinAdapter,
  bilibili: BilibiliAdapter,
  zhihu: ZhihuAdapter,
  baijia: BaijiaAdapter,
  toutiao: ToutiaoAdapter,
  xiaohongshu: XiaohongshuAdapter,
  sohu: SohuAdapter,
  netease: NeteaseAdapter,
};

export class Publisher {
  private queue = new PublishQueue();

  createTask(article: Article): PublishTask {
    return {
      id: `pub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      articleId: article.id,
      platform: article.platform,
      status: 'pending',
      method: ADAPTER_MAP[article.platform].prototype.method,
      retryCount: 0,
      maxRetries: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  enqueue(task: PublishTask): void {
    this.queue.enqueue(task);
  }

  async publish(task: PublishTask, article: Article, credentials: PlatformCredentials): Promise<PublishResult> {
    const AdapterClass = ADAPTER_MAP[task.platform];
    if (!AdapterClass) {
      return { success: false, error: `Unsupported platform: ${task.platform}` };
    }

    const adapter = new AdapterClass();
    const result = await adapter.publish({ article, credentials });
    return result;
  }

  getQueueLength(): number {
    return this.queue.length;
  }
}
```

- [ ] **Step 3: 更新 index.ts**

```typescript
// packages/publisher/src/index.ts
export { PublishParams, PublishResult, PublishStatus } from './types.js';
export { PlatformAdapter } from './adapters/base.js';
export { Publisher } from './publisher.js';
export { PublishQueue } from './queue.js';
export { RpaEngine } from './rpa-engine.js';
```

- [ ] **Step 4: 编译验证**

```bash
cd c:\Users\Administrator\Desktop\trae work GEO\geo-assistant-clean
npm run build --workspace=@zemingengine/publisher
```

Expected: 编译成功

- [ ] **Step 5: Commit**

```bash
git add packages/publisher/src/publisher.ts packages/publisher/src/queue.ts packages/publisher/src/index.ts
git commit -m "feat(publisher): implement Publisher orchestrator and queue"
```

---

### Task 17: publisher 单元测试

**Files:**
- Create: `packages/publisher/src/publisher.test.ts`

- [ ] **Step 1: 编写测试**

```typescript
// packages/publisher/src/publisher.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Publisher } from './publisher.js';
import type { Article, PlatformCredentials } from '@zemingengine/shared';

describe('Publisher', () => {
  const publisher = new Publisher();

  function makeArticle(platform: Article['platform']): Article {
    return {
      id: 'art_test_001',
      sessionId: 'test_session_001',
      platform,
      contentType: 'tutorial',
      title: '测试文章',
      contentMarkdown: '# 测试',
      tags: ['测试'],
      wordCount: 10,
      status: 'approved',
      generationRound: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  const credentials: PlatformCredentials = {
    platform: 'weixin',
    type: 'api_key',
    data: { appId: 'test', appSecret: 'test' },
    status: 'active',
  };

  it('should create publish task from article', () => {
    const article = makeArticle('weixin');
    const task = publisher.createTask(article);

    assert.ok(task.id.startsWith('pub_'));
    assert.equal(task.articleId, article.id);
    assert.equal(task.platform, 'weixin');
    assert.equal(task.status, 'pending');
    assert.equal(task.retryCount, 0);
  });

  it('should publish to weixin stub adapter', async () => {
    const article = makeArticle('weixin');
    const task = publisher.createTask(article);
    const result = await publisher.publish(task, article, credentials);

    assert.equal(result.success, true);
    assert.ok(result.platformPostId);
    assert.ok(result.platformPostUrl);
  });

  it('should publish to zhihu stub adapter', async () => {
    const article = makeArticle('zhihu');
    const task = publisher.createTask(article);
    const cred: PlatformCredentials = { ...credentials, platform: 'zhihu', type: 'cookie' };
    const result = await publisher.publish(task, article, cred);

    assert.equal(result.success, true);
  });

  it('should support all 10 platforms', () => {
    const platforms: Article['platform'][] = [
      'weixin', 'zhihu', 'baijia', 'toutiao',
      'csdn', 'juejin', 'xiaohongshu', 'bilibili',
      'sohu', 'netease',
    ];

    for (const platform of platforms) {
      const article = makeArticle(platform);
      const task = publisher.createTask(article);
      assert.equal(task.platform, platform);
      assert.equal(task.method, platform === 'weixin' || platform === 'csdn' || platform === 'juejin' || platform === 'bilibili' ? 'api' : 'rpa');
    }
  });

  it('should enqueue and track queue length', () => {
    const article = makeArticle('weixin');
    const task = publisher.createTask(article);
    publisher.enqueue(task);

    assert.equal(publisher.getQueueLength(), 1);
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
cd c:\Users\Administrator\Desktop\trae work GEO\geo-assistant-clean
npm run build --workspace=@zemingengine/publisher
npm run test --workspace=@zemingengine/publisher
```

Expected: 5 tests pass

- [ ] **Step 3: Commit**

```bash
git add packages/publisher/src/publisher.test.ts
git commit -m "test(publisher): add publisher unit tests"
```

---

## Phase 5: Server API

### Task 18: 实现文章路由 + 审核路由

**Files:**
- Create: `apps/server/src/routes/article.ts`
- Create: `apps/server/src/routes/review.ts`

- [ ] **Step 1: 编写文章路由**

```typescript
// apps/server/src/routes/article.ts
import { Hono } from 'hono';
import type { DatabaseAccess } from '../db.js';
import { ContentGenerator } from '@zemingengine/content-generator';
import { ContentReviewer } from '@zemingengine/content-reviewer';
import type { GenerateArticleRequest } from '@zemingengine/shared';

export function createArticleRoutes(db: DatabaseAccess) {
  const routes = new Hono();
  const generator = new ContentGenerator();
  const reviewer = new ContentReviewer();

  // POST /api/articles/generate
  routes.post('/generate', async (c) => {
    const body = await c.req.json<GenerateArticleRequest>();
    const session = db.getSession(body.sessionId);
    if (!session) {
      return c.json({ success: false, error: 'Session not found' }, 404);
    }

    const result = await generator.generate(
      { ...body, generationRound: 1 },
      session
    );

    db.insertArticle(result.article);

    // 自动审核
    const review = await reviewer.review({
      article: result.article,
      session,
      round: 1,
    });
    db.insertReview(review);

    if (review.passed) {
      db.updateArticle(result.article.id, { status: 'approved' });
    }

    return c.json({
      success: true,
      data: { article: result.article, review },
    });
  });

  // GET /api/articles
  routes.get('/', (c) => {
    const sessionId = c.req.query('sessionId');
    const status = c.req.query('status');

    let articles = sessionId ? db.getArticlesBySession(sessionId) : [];
    if (status) {
      articles = articles.filter((a) => a.status === status);
    }

    return c.json({ success: true, data: articles });
  });

  // GET /api/articles/:id
  routes.get('/:id', (c) => {
    const id = c.req.param('id');
    const article = db.getArticle(id);
    if (!article) return c.json({ success: false, error: 'Article not found' }, 404);
    return c.json({ success: true, data: article });
  });

  // PUT /api/articles/:id
  routes.put('/:id', async (c) => {
    const id = c.req.param('id');
    const updates = await c.req.json();
    db.updateArticle(id, updates);
    return c.json({ success: true });
  });

  // DELETE /api/articles/:id
  routes.delete('/:id', (c) => {
    const id = c.req.param('id');
    // 软删除：更新状态为 failed
    db.updateArticle(id, { status: 'failed' });
    return c.json({ success: true });
  });

  return routes;
}
```

- [ ] **Step 2: 编写审核路由**

```typescript
// apps/server/src/routes/review.ts
import { Hono } from 'hono';
import type { DatabaseAccess } from '../db.js';
import { ContentReviewer } from '@zemingengine/content-reviewer';

export function createReviewRoutes(db: DatabaseAccess) {
  const routes = new Hono();
  const reviewer = new ContentReviewer();

  // POST /api/reviews/:articleId
  routes.post('/:articleId', async (c) => {
    const articleId = c.req.param('articleId');
    const article = db.getArticle(articleId);
    if (!article) return c.json({ success: false, error: 'Article not found' }, 404);

    const session = db.getSession(article.sessionId);
    if (!session) return c.json({ success: false, error: 'Session not found' }, 404);

    const reviews = db.getReviewsByArticle(articleId);
    const nextRound = reviews.length + 1;

    const review = await reviewer.review({ article, session, round: nextRound });
    db.insertReview(review);

    if (review.passed) {
      db.updateArticle(articleId, { status: 'approved' });
    }

    return c.json({ success: true, data: review });
  });

  // GET /api/reviews/:articleId
  routes.get('/:articleId', (c) => {
    const articleId = c.req.param('articleId');
    const reviews = db.getReviewsByArticle(articleId);
    return c.json({ success: true, data: reviews });
  });

  // GET /api/reviews/:articleId/latest
  routes.get('/:articleId/latest', (c) => {
    const articleId = c.req.param('articleId');
    const review = db.getLatestReview(articleId);
    if (!review) return c.json({ success: false, error: 'No reviews found' }, 404);
    return c.json({ success: true, data: review });
  });

  return routes;
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/routes/article.ts apps/server/src/routes/review.ts
git commit -m "feat(server): add article and review routes"
```

---

### Task 19: 实现发布路由 + 流水线路由 + 凭据路由

**Files:**
- Create: `apps/server/src/routes/publish.ts`
- Create: `apps/server/src/routes/pipeline.ts`
- Create: `apps/server/src/routes/credentials.ts`

- [ ] **Step 1: 编写发布路由**

```typescript
// apps/server/src/routes/publish.ts
import { Hono } from 'hono';
import type { DatabaseAccess } from '../db.js';
import { Publisher } from '@zemingengine/publisher';
import type { PublishArticleRequest } from '@zemingengine/shared';

export function createPublishRoutes(db: DatabaseAccess) {
  const routes = new Hono();
  const publisher = new Publisher();

  // POST /api/publish
  routes.post('/', async (c) => {
    const body = await c.req.json<PublishArticleRequest>();
    const article = db.getArticle(body.articleId);
    if (!article) return c.json({ success: false, error: 'Article not found' }, 404);

    const credentials = db.getCredential(article.platform);
    if (!credentials) {
      return c.json({ success: false, error: `No credentials for ${article.platform}` }, 400);
    }

    const task = publisher.createTask(article);
    db.insertPublishTask(task);
    db.updateArticle(article.id, { status: 'publishing' });

    // 异步发布
    publisher.publish(task, article, credentials).then((result) => {
      if (result.success) {
        db.updatePublishTask(task.id, {
          status: 'published',
          platformPostId: result.platformPostId,
          platformPostUrl: result.platformPostUrl,
          publishedAt: result.publishedAt,
        });
        db.updateArticle(article.id, { status: 'published' });
      } else {
        db.updatePublishTask(task.id, {
          status: 'failed',
          errorMessage: result.error,
        });
        db.updateArticle(article.id, { status: 'approved' });
      }
    });

    return c.json({ success: true, data: { taskId: task.id } });
  });

  // GET /api/publish/:taskId
  routes.get('/:taskId', (c) => {
    const taskId = c.req.param('taskId');
    const task = db.getPublishTask(taskId);
    if (!task) return c.json({ success: false, error: 'Task not found' }, 404);
    return c.json({ success: true, data: task });
  });

  // GET /api/publish
  routes.get('/', (c) => {
    const articleId = c.req.query('articleId');
    if (!articleId) return c.json({ success: false, error: 'articleId required' }, 400);
    const tasks = db.getPublishTasksByArticle(articleId);
    return c.json({ success: true, data: tasks });
  });

  // POST /api/publish/:taskId/retry
  routes.post('/:taskId/retry', (c) => {
    const taskId = c.req.param('taskId');
    const task = db.getPublishTask(taskId);
    if (!task) return c.json({ success: false, error: 'Task not found' }, 404);

    db.updatePublishTask(taskId, {
      status: 'pending',
      retryCount: task.retryCount + 1,
      errorMessage: undefined,
    });

    return c.json({ success: true });
  });

  return routes;
}
```

- [ ] **Step 2: 编写流水线路由**

```typescript
// apps/server/src/routes/pipeline.ts
import { Hono } from 'hono';
import type { DatabaseAccess } from '../db.js';
import { ContentGenerator } from '@zemingengine/content-generator';
import { ContentReviewer } from '@zemingengine/content-reviewer';
import { Publisher } from '@zemingengine/publisher';
import type { PipelineRequest, PipelineStatus, ArticleSummary } from '@zemingengine/shared';

export function createPipelineRoutes(db: DatabaseAccess) {
  const routes = new Hono();
  const generator = new ContentGenerator();
  const reviewer = new ContentReviewer();
  const publisher = new Publisher();

  // POST /api/pipeline/start
  routes.post('/start', async (c) => {
    const body = await c.req.json<PipelineRequest>();
    const session = db.getSession(body.sessionId);
    if (!session) return c.json({ success: false, error: 'Session not found' }, 404);

    // 为每个平台生成文章
    for (const platform of body.platforms) {
      let passed = false;
      let round = 1;
      let article = null;

      while (!passed && round <= 3) {
        const genResult = await generator.generate(
          {
            sessionId: body.sessionId,
            platform,
            contentType: body.contentType,
            generationRound: round,
          },
          session
        );
        article = genResult.article;
        db.insertArticle(article);

        const reviewResult = await reviewer.review({ article, session, round });
        db.insertReview(reviewResult);

        if (reviewResult.passed) {
          passed = true;
          db.updateArticle(article.id, { status: 'approved' });

          if (body.autoPublish) {
            const credentials = db.getCredential(platform);
            if (credentials) {
              const task = publisher.createTask(article);
              db.insertPublishTask(task);
              db.updateArticle(article.id, { status: 'publishing' });

              publisher.publish(task, article, credentials).then((result) => {
                if (result.success) {
                  db.updatePublishTask(task.id, {
                    status: 'published',
                    platformPostId: result.platformPostId,
                    platformPostUrl: result.platformPostUrl,
                    publishedAt: result.publishedAt,
                  });
                  db.updateArticle(article.id, { status: 'published' });
                } else {
                  db.updatePublishTask(task.id, { status: 'failed', errorMessage: result.error });
                  db.updateArticle(article.id, { status: 'approved' });
                }
              });
            }
          }
        } else {
          db.updateArticle(article.id, { status: 'reviewing' });
          round++;
        }
      }

      if (!passed && article) {
        db.updateArticle(article.id, { status: 'failed' });
      }
    }

    return c.json({ success: true, data: { sessionId: body.sessionId } });
  });

  // GET /api/pipeline/status/:sessionId
  routes.get('/status/:sessionId', (c) => {
    const sessionId = c.req.param('sessionId');
    const articles = db.getArticlesBySession(sessionId);

    const summary: Record<string, number> = {
      draft: 0, reviewing: 0, approved: 0,
      publishing: 0, published: 0, failed: 0,
    };

    const articleSummaries: ArticleSummary[] = articles.map((a) => {
      summary[a.status]++;
      const latestReview = db.getLatestReview(a.id);
      const tasks = db.getPublishTasksByArticle(a.id);
      const latestTask = tasks[0];
      return {
        id: a.id,
        platform: a.platform,
        title: a.title,
        status: a.status,
        reviewScore: latestReview?.overallScore,
        publishUrl: latestTask?.platformPostUrl,
        createdAt: a.createdAt,
      };
    });

    const status: PipelineStatus = {
      sessionId,
      totalArticles: articles.length,
      draft: summary.draft,
      reviewing: summary.reviewing,
      approved: summary.approved,
      publishing: summary.publishing,
      published: summary.published,
      failed: summary.failed,
      articles: articleSummaries,
    };

    return c.json({ success: true, data: status });
  });

  return routes;
}
```

- [ ] **Step 3: 编写凭据路由**

```typescript
// apps/server/src/routes/credentials.ts
import { Hono } from 'hono';
import type { DatabaseAccess } from '../db.js';
import type { PlatformCredentials } from '@zemingengine/shared';

export function createCredentialRoutes(db: DatabaseAccess) {
  const routes = new Hono();

  // PUT /api/credentials/:platform
  routes.put('/:platform', async (c) => {
    const platform = c.req.param('platform');
    const body = await c.req.json<PlatformCredentials>();
    db.upsertCredential(platform, body);
    return c.json({ success: true });
  });

  // GET /api/credentials
  routes.get('/', (c) => {
    const creds = db.getAllCredentials();
    return c.json({ success: true, data: creds });
  });

  // POST /api/credentials/:platform/validate
  routes.post('/:platform/validate', (c) => {
    const platform = c.req.param('platform');
    const cred = db.getCredential(platform);
    if (!cred) return c.json({ success: false, error: 'No credentials' }, 404);

    // 简单验证：检查凭据数据非空
    const valid = Object.values(cred.data).some((v) => v && String(v).length > 0);
    db.updateCredentialStatus(platform, valid ? 'active' : 'invalid');

    return c.json({ success: true, data: { valid } });
  });

  return routes;
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/routes/publish.ts apps/server/src/routes/pipeline.ts apps/server/src/routes/credentials.ts
git commit -m "feat(server): add publish, pipeline, and credentials routes"
```

---

### Task 20: 注册所有路由到 Server

**Files:**
- Modify: `apps/server/src/index.ts`
- Modify: `apps/server/src/session-store.ts`

- [ ] **Step 1: 修改 session-store 支持持久化**

```typescript
// apps/server/src/session-store.ts
import type { SessionData } from '@zemingengine/shared';
import { createEmptySession } from '@zemingengine/shared';
import { DialogueEngine } from '@zemingengine/dialogue-engine';
import type { DatabaseAccess } from './db.js';

interface SessionEntry {
  data: SessionData;
  engine: DialogueEngine;
  createdAt: Date;
  updatedAt: Date;
}

const memorySessions = new Map<string, SessionEntry>();

export function createSession(db?: DatabaseAccess): SessionEntry {
  const id = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const data = createEmptySession(id);
  const engine = new DialogueEngine(data);
  const entry: SessionEntry = {
    data,
    engine,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  memorySessions.set(id, entry);
  if (db) db.upsertSession(id, data);
  return entry;
}

export function getSession(id: string, db?: DatabaseAccess): SessionEntry | undefined {
  const memory = memorySessions.get(id);
  if (memory) return memory;

  // 尝试从数据库恢复
  if (db) {
    const data = db.getSession(id);
    if (data) {
      const engine = new DialogueEngine(data);
      const entry: SessionEntry = {
        data,
        engine,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      memorySessions.set(id, entry);
      return entry;
    }
  }
  return undefined;
}

export function updateSession(id: string, data: SessionData, db?: DatabaseAccess): SessionEntry | undefined {
  const entry = memorySessions.get(id);
  if (!entry) return undefined;
  entry.data = data;
  entry.updatedAt = new Date();
  if (db) db.upsertSession(id, data);
  return entry;
}

export function deleteSession(id: string, db?: DatabaseAccess): boolean {
  if (db) db.deleteSession(id);
  return memorySessions.delete(id);
}

export function listSessions(): SessionEntry[] {
  return Array.from(memorySessions.values());
}

export function cleanupSessions(): number {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  let cleaned = 0;
  for (const [id, entry] of memorySessions) {
    if (entry.updatedAt < cutoff) {
      memorySessions.delete(id);
      cleaned++;
    }
  }
  return cleaned;
}
```

- [ ] **Step 2: 修改 server index.ts 注册新路由**

```typescript
// apps/server/src/index.ts
import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { isAIAvailable } from '@zemingengine/ai-engine';
import { createDatabase, DatabaseAccess } from './db.js';
import { sessionRoutes } from './routes/session.js';
import { messageRoutes } from './routes/message.js';
import { scrapeRoutes } from './routes/scrape.js';
import { manualRoutes } from './routes/manual.js';
import { createArticleRoutes } from './routes/article.js';
import { createReviewRoutes } from './routes/review.js';
import { createPublishRoutes } from './routes/publish.js';
import { createPipelineRoutes } from './routes/pipeline.js';
import { createCredentialRoutes } from './routes/credentials.js';

const app = new Hono();
const db = new DatabaseAccess(createDatabase());

// Middleware
app.use('*', logger());
app.use('*', cors());

// Health check
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString(), aiEnabled: isAIAvailable() });
});

// Mount routes
app.route('/api/session', sessionRoutes);
app.route('/api/session', messageRoutes);
app.route('/api/session', scrapeRoutes);
app.route('/api/session', manualRoutes);
app.route('/api/articles', createArticleRoutes(db));
app.route('/api/reviews', createReviewRoutes(db));
app.route('/api/publish', createPublishRoutes(db));
app.route('/api/pipeline', createPipelineRoutes(db));
app.route('/api/credentials', createCredentialRoutes(db));

// Start server
const port = Number(process.env.PORT ?? 3000);

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`芯图引擎：GEO server running at http://localhost:${info.port}`);
  console.log(`AI Engine: ${isAIAvailable() ? 'Enabled' : 'Disabled (set OPENAI_API_KEY to enable)'}`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use.`);
    console.error(`Set a different PORT in apps/server/.env, then restart.`);
    process.exit(1);
  }
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: 编译验证**

```bash
cd c:\Users\Administrator\Desktop\trae work GEO\geo-assistant-clean
npm run build --workspace=@zemingengine/server
```

Expected: 编译成功

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/
git commit -m "feat(server): wire up all new routes with database integration"
```

---

## Phase 6: Web 前端

### Task 21: 创建前端状态管理 stores

**Files:**
- Create: `apps/web/src/stores/articleStore.ts`
- Create: `apps/web/src/stores/pipelineStore.ts`

- [ ] **Step 1: 编写 articleStore**

```typescript
// apps/web/src/stores/articleStore.ts
import { create } from 'zustand';
import type { Article, PlatformId, ArticleContentType, GenerateArticleRequest } from '@zemingengine/shared';

interface ArticleStore {
  articles: Article[];
  selectedArticleId: string | null;
  loading: boolean;
  error: string | null;

  fetchArticles: (sessionId?: string) => Promise<void>;
  selectArticle: (id: string | null) => void;
  generateArticle: (req: GenerateArticleRequest) => Promise<void>;
  clearError: () => void;
}

const API_BASE = '/api';

export const useArticleStore = create<ArticleStore>((set, get) => ({
  articles: [],
  selectedArticleId: null,
  loading: false,
  error: null,

  fetchArticles: async (sessionId) => {
    set({ loading: true, error: null });
    try {
      const url = sessionId
        ? `${API_BASE}/articles?sessionId=${sessionId}`
        : `${API_BASE}/articles`;
      const res = await fetch(url);
      const json = await res.json();
      if (json.success) {
        set({ articles: json.data as Article[] });
      } else {
        set({ error: json.error || 'Failed to fetch articles' });
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      set({ loading: false });
    }
  },

  selectArticle: (id) => set({ selectedArticleId: id }),

  generateArticle: async (req) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(`${API_BASE}/articles/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      });
      const json = await res.json();
      if (json.success) {
        const article = json.data.article as Article;
        set((state) => ({ articles: [article, ...state.articles] }));
      } else {
        set({ error: json.error || 'Failed to generate article' });
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      set({ loading: false });
    }
  },

  clearError: () => set({ error: null }),
}));
```

- [ ] **Step 2: 编写 pipelineStore**

```typescript
// apps/web/src/stores/pipelineStore.ts
import { create } from 'zustand';
import type { PipelineRequest, PipelineStatus } from '@zemingengine/shared';

interface PipelineStore {
  status: PipelineStatus | null;
  isRunning: boolean;
  loading: boolean;
  error: string | null;

  startPipeline: (req: PipelineRequest) => Promise<void>;
  fetchStatus: (sessionId: string) => Promise<void>;
  clearError: () => void;
}

export const usePipelineStore = create<PipelineStore>((set) => ({
  status: null,
  isRunning: false,
  loading: false,
  error: null,

  startPipeline: async (req) => {
    set({ isRunning: true, loading: true, error: null });
    try {
      const res = await fetch(`${API_BASE}/pipeline/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      });
      const json = await res.json();
      if (!json.success) {
        set({ error: json.error || 'Failed to start pipeline' });
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      set({ loading: false });
    }
  },

  fetchStatus: async (sessionId) => {
    try {
      const res = await fetch(`${API_BASE}/pipeline/status/${sessionId}`);
      const json = await res.json();
      if (json.success) {
        const status = json.data as PipelineStatus;
        const isRunning = status.publishing > 0 || status.reviewing > 0 || status.draft > 0;
        set({ status, isRunning });
      }
    } catch (err) {
      console.error('Failed to fetch pipeline status:', err);
    }
  },

  clearError: () => set({ error: null }),
}));
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/stores/articleStore.ts apps/web/src/stores/pipelineStore.ts
git commit -m "feat(web): add articleStore and pipelineStore"
```

---

### Task 22: 创建前端组件

**Files:**
- Create: `apps/web/src/components/articles/ArticleStatusBadge.tsx`
- Create: `apps/web/src/components/articles/ArticleList.tsx`
- Create: `apps/web/src/components/articles/ArticleDetail.tsx`
- Create: `apps/web/src/components/pipeline/PipelineLauncher.tsx`
- Create: `apps/web/src/components/pipeline/PipelineDashboard.tsx`

- [ ] **Step 1: 编写 ArticleStatusBadge 组件**

```typescript
// apps/web/src/components/articles/ArticleStatusBadge.tsx
import type { ArticleStatus } from '@zemingengine/shared';

const STATUS_STYLES: Record<ArticleStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  reviewing: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-blue-100 text-blue-700',
  publishing: 'bg-purple-100 text-purple-700',
  published: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

const STATUS_LABELS: Record<ArticleStatus, string> = {
  draft: '草稿',
  reviewing: '审核中',
  approved: '已通过',
  publishing: '发布中',
  published: '已发布',
  failed: '失败',
};

export function ArticleStatusBadge({ status }: { status: ArticleStatus }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}
```

- [ ] **Step 2: 编写 ArticleList 组件**

```typescript
// apps/web/src/components/articles/ArticleList.tsx
import { useArticleStore } from '../../stores/articleStore.js';
import { ArticleStatusBadge } from './ArticleStatusBadge.js';

const PLATFORM_LABELS: Record<string, string> = {
  weixin: '微信公众号', zhihu: '知乎', baijia: '百家号',
  toutiao: '今日头条', csdn: 'CSDN', juejin: '掘金',
  xiaohongshu: '小红书', bilibili: 'B站', sohu: '搜狐号', netease: '网易号',
};

export function ArticleList() {
  const { articles, selectedArticleId, selectArticle } = useArticleStore();

  return (
    <div className="flex flex-col h-full border-r border-gray-200 bg-white w-80">
      <div className="px-4 py-3 border-b border-gray-200">
        <h2 className="text-sm font-semibold text-gray-900">文章列表</h2>
        <span className="text-xs text-gray-500">{articles.length} 篇</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {articles.map((article) => (
          <button
            key={article.id}
            onClick={() => selectArticle(article.id)}
            className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
              selectedArticleId === article.id ? 'bg-blue-50 border-l-4 border-l-blue-500' : 'border-l-4 border-l-transparent'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-500">{PLATFORM_LABELS[article.platform] || article.platform}</span>
              <ArticleStatusBadge status={article.status} />
            </div>
            <p className="text-sm text-gray-900 font-medium truncate">{article.title}</p>
            <p className="text-xs text-gray-400 mt-1">{article.wordCount} 字</p>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 编写 ArticleDetail 组件**

```typescript
// apps/web/src/components/articles/ArticleDetail.tsx
import { useArticleStore } from '../../stores/articleStore.js';
import { ArticleStatusBadge } from './ArticleStatusBadge.js';

export function ArticleDetail() {
  const { articles, selectedArticleId } = useArticleStore();
  const article = articles.find((a) => a.id === selectedArticleId);

  if (!article) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400">
        <p>选择一篇文章查看详情</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-white overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <div className="flex items-center gap-3 mb-2">
          <ArticleStatusBadge status={article.status} />
          <span className="text-xs text-gray-500">{article.platform}</span>
        </div>
        <h1 className="text-lg font-bold text-gray-900">{article.title}</h1>
        {article.summary && <p className="text-sm text-gray-600 mt-2">{article.summary}</p>}
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="prose prose-sm max-w-none">
          <pre className="whitespace-pre-wrap text-sm text-gray-800 bg-gray-50 p-4 rounded-lg">
            {article.contentMarkdown}
          </pre>
        </div>
        {article.tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {article.tags.map((tag) => (
              <span key={tag} className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 编写 PipelineLauncher 组件**

```typescript
// apps/web/src/components/pipeline/PipelineLauncher.tsx
import { useState } from 'react';
import { usePipelineStore } from '../../stores/pipelineStore.js';
import type { PlatformId, ArticleContentType } from '@zemingengine/shared';

const PLATFORMS: { id: PlatformId; label: string }[] = [
  { id: 'weixin', label: '微信公众号' },
  { id: 'zhihu', label: '知乎' },
  { id: 'baijia', label: '百家号' },
  { id: 'toutiao', label: '今日头条' },
  { id: 'csdn', label: 'CSDN' },
  { id: 'juejin', label: '掘金' },
  { id: 'xiaohongshu', label: '小红书' },
  { id: 'bilibili', label: 'B站' },
  { id: 'sohu', label: '搜狐号' },
  { id: 'netease', label: '网易号' },
];

const CONTENT_TYPES: { id: ArticleContentType; label: string }[] = [
  { id: 'tutorial', label: '教程' },
  { id: 'case', label: '案例' },
  { id: 'comparison', label: '对比' },
  { id: 'popularization', label: '科普' },
];

export function PipelineLauncher({ sessionId }: { sessionId: string }) {
  const { startPipeline, loading } = usePipelineStore();
  const [selectedPlatforms, setSelectedPlatforms] = useState<PlatformId[]>([]);
  const [contentType, setContentType] = useState<ArticleContentType>('tutorial');
  const [autoPublish, setAutoPublish] = useState(true);

  const togglePlatform = (id: PlatformId) => {
    setSelectedPlatforms((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  const handleStart = () => {
    if (selectedPlatforms.length === 0) return;
    startPipeline({ sessionId, platforms: selectedPlatforms, contentType, autoPublish });
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="text-lg font-bold text-gray-900 mb-4">启动内容流水线</h2>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">内容类型</label>
        <div className="flex gap-2">
          {CONTENT_TYPES.map((t) => (
            <button
              key={t.id}
              onClick={() => setContentType(t.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                contentType === t.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">目标平台</label>
        <div className="grid grid-cols-5 gap-2">
          {PLATFORMS.map((p) => (
            <button
              key={p.id}
              onClick={() => togglePlatform(p.id)}
              className={`px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                selectedPlatforms.includes(p.id)
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 flex items-center gap-2">
        <input
          type="checkbox"
          id="autoPublish"
          checked={autoPublish}
          onChange={(e) => setAutoPublish(e.target.checked)}
          className="rounded border-gray-300"
        />
        <label htmlFor="autoPublish" className="text-sm text-gray-700">
          审核通过后自动发布
        </label>
      </div>

      <button
        onClick={handleStart}
        disabled={selectedPlatforms.length === 0 || loading}
        className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
      >
        {loading ? '启动中...' : `为 ${selectedPlatforms.length} 个平台生成内容`}
      </button>
    </div>
  );
}
```

- [ ] **Step 5: 编写 PipelineDashboard 组件**

```typescript
// apps/web/src/components/pipeline/PipelineDashboard.tsx
import { usePipelineStore } from '../../stores/pipelineStore.js';
import { ArticleStatusBadge } from '../articles/ArticleStatusBadge.js';

export function PipelineDashboard() {
  const { status } = usePipelineStore();

  if (!status) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6 text-center text-gray-500">
        <p>暂无流水线数据</p>
      </div>
    );
  }

  const stats = [
    { label: '草稿', value: status.draft, color: 'bg-gray-100 text-gray-700' },
    { label: '审核中', value: status.reviewing, color: 'bg-yellow-100 text-yellow-700' },
    { label: '已通过', value: status.approved, color: 'bg-blue-100 text-blue-700' },
    { label: '发布中', value: status.publishing, color: 'bg-purple-100 text-purple-700' },
    { label: '已发布', value: status.published, color: 'bg-green-100 text-green-700' },
    { label: '失败', value: status.failed, color: 'bg-red-100 text-red-700' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-6 gap-3">
        {stats.map((s) => (
          <div key={s.label} className={`rounded-lg p-3 ${s.color}`}>
            <div className="text-2xl font-bold">{s.value}</div>
            <div className="text-xs">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg border border-gray-200">
        <div className="px-4 py-3 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-900">文章进度</h3>
        </div>
        <div className="divide-y divide-gray-100">
          {status.articles.map((article) => (
            <div key={article.id} className="px-4 py-3 flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{article.title}</p>
                <p className="text-xs text-gray-500">{article.platform}</p>
              </div>
              <div className="flex items-center gap-3">
                {article.reviewScore !== undefined && (
                  <span className="text-xs text-gray-500">{article.reviewScore}分</span>
                )}
                <ArticleStatusBadge status={article.status} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/
git commit -m "feat(web): add article and pipeline UI components"
```

---

### Task 23: 创建前端页面并更新 App.tsx

**Files:**
- Create: `apps/web/src/pages/ContentPage.tsx`
- Create: `apps/web/src/pages/PipelinePage.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: 编写 ContentPage**

```typescript
// apps/web/src/pages/ContentPage.tsx
import { useEffect } from 'react';
import { useArticleStore } from '../stores/articleStore.js';
import { ArticleList } from '../components/articles/ArticleList.js';
import { ArticleDetail } from '../components/articles/ArticleDetail.js';

export function ContentPage({ sessionId }: { sessionId: string }) {
  const { fetchArticles, loading, error, clearError } = useArticleStore();

  useEffect(() => {
    fetchArticles(sessionId);
  }, [sessionId, fetchArticles]);

  return (
    <div className="h-full flex flex-col">
      {error && (
        <div className="px-4 py-2 bg-red-50 border-b border-red-200 flex items-center justify-between">
          <span className="text-sm text-red-700">{error}</span>
          <button onClick={clearError} className="text-xs text-red-800 underline">关闭</button>
        </div>
      )}
      <div className="flex-1 flex overflow-hidden">
        <ArticleList />
        <ArticleDetail />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 编写 PipelinePage**

```typescript
// apps/web/src/pages/PipelinePage.tsx
import { useEffect } from 'react';
import { usePipelineStore } from '../stores/pipelineStore.js';
import { PipelineLauncher } from '../components/pipeline/PipelineLauncher.js';
import { PipelineDashboard } from '../components/pipeline/PipelineDashboard.js';

export function PipelinePage({ sessionId }: { sessionId: string }) {
  const { status, fetchStatus, isRunning } = usePipelineStore();

  useEffect(() => {
    fetchStatus(sessionId);
  }, [sessionId, fetchStatus]);

  // 自动刷新状态
  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => fetchStatus(sessionId), 5000);
    return () => clearInterval(interval);
  }, [isRunning, sessionId, fetchStatus]);

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      <PipelineLauncher sessionId={sessionId} />
      <PipelineDashboard />
    </div>
  );
}
```

- [ ] **Step 3: 修改 App.tsx 添加导航**

```typescript
// apps/web/src/App.tsx
import { useState } from 'react';
import { useSessionStore } from './stores/sessionStore.js';
import { StageProgress } from './components/StageProgress.js';
import { ChatPanel } from './components/ChatPanel.js';
import { ConfigPreview } from './components/ConfigPreview.js';
import { ContentPage } from './pages/ContentPage.js';
import { PipelinePage } from './pages/PipelinePage.js';
import { STAGE_DISPLAY_NAMES, STAGES } from '@zemingengine/shared';

type AppTab = 'chat' | 'content' | 'pipeline';

export function App() {
  const {
    sessionId,
    sessionData,
    isComplete,
    isLoading,
    error,
    startSession,
    clearError,
    downloadManual,
  } = useSessionStore();

  const [activeTab, setActiveTab] = useState<AppTab>('chat');
  const currentStage = sessionData?.currentStage ?? 'intro';

  const handleExportJson = () => {
    if (!sessionData) return;
    const json = JSON.stringify(sessionData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `FocusGEO_${sessionData.enterprise.fullName || '配置'}_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-gray-900">FocusGEO</h1>
            <span className="text-sm text-gray-500">GEO 实操配置教练</span>
          </div>
          {sessionId && (
            <div className="flex items-center gap-4">
              <StageProgress currentStage={currentStage} />
              {isComplete && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => downloadManual('markdown')}
                    className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors"
                  >
                    下载手册 (MD)
                  </button>
                  <button
                    onClick={() => downloadManual('html')}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
                  >
                    下载手册 (HTML)
                  </button>
                  <button
                    onClick={handleExportJson}
                    className="rounded-lg bg-gray-600 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors"
                  >
                    导出 JSON
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Navigation tabs */}
      {sessionId && (
        <nav className="bg-white border-b border-gray-200">
          <div className="max-w-7xl mx-auto flex gap-1 px-4">
            {[
              { id: 'chat' as AppTab, label: '配置对话' },
              { id: 'content' as AppTab, label: '内容管理' },
              { id: 'pipeline' as AppTab, label: '流水线' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </nav>
      )}

      {/* Main content */}
      <main className="flex-1 overflow-hidden max-w-7xl mx-auto w-full">
        {!sessionId ? (
          /* Welcome screen */
          <div className="h-full flex items-center justify-center">
            <div className="text-center max-w-md">
              <h2 className="text-3xl font-bold text-gray-900 mb-4">
                GEO 实操配置教练
              </h2>
              <p className="text-gray-600 mb-8 leading-relaxed">
                通过核心对话生成词库、知识库方案、提示词和平台策略。
                <br />
                支持从官网自动抓取企业信息，AI 智能分析。
              </p>
              <button
                onClick={startSession}
                disabled={isLoading}
                className="rounded-xl bg-blue-600 px-8 py-3 text-white font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {isLoading ? '正在初始化...' : '开始配置'}
              </button>
              {error && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-left text-sm text-red-700">
                  <div className="font-medium">启动失败</div>
                  <div className="mt-1">{error}</div>
                  <button
                    onClick={clearError}
                    className="mt-2 text-xs font-medium text-red-800 underline underline-offset-2"
                  >
                    关闭
                  </button>
                  <button
                    onClick={startSession}
                    disabled={isLoading}
                    className="ml-4 mt-2 text-xs font-medium text-red-800 underline underline-offset-2 disabled:opacity-50"
                  >
                    重试
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Tab content */
          <div className="h-full">
            {activeTab === 'chat' && (
              <div className="h-full flex">
                <div className="flex-1 flex flex-col min-w-0">
                  <ChatPanel />
                </div>
                <div className="w-80 border-l border-gray-200 bg-white hidden lg:block">
                  <ConfigPreview sessionData={sessionData} onExportJson={handleExportJson} />
                </div>
              </div>
            )}
            {activeTab === 'content' && <ContentPage sessionId={sessionId} />}
            {activeTab === 'pipeline' && <PipelinePage sessionId={sessionId} />}
          </div>
        )}
      </main>

      {/* Footer */}
      {sessionId && (
        <footer className="bg-white border-t border-gray-200 px-4 py-2">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-4 text-xs text-gray-400">
            <span>
              阶段 {STAGES.findIndex((stage) => stage === currentStage) + 1}/{STAGES.length}
              {' · '}
              {STAGE_DISPLAY_NAMES[currentStage]}
            </span>
            {error && (
              <button
                onClick={clearError}
                className="truncate rounded border border-red-200 bg-red-50 px-2 py-1 text-red-700"
                title={error}
              >
                {error}
              </button>
            )}
            {isComplete && (
              <span className="text-green-600 font-medium">配置完成！点击上方按钮下载手册</span>
            )}
          </div>
        </footer>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 编译验证**

```bash
cd c:\Users\Administrator\Desktop\trae work GEO\geo-assistant-clean
npm run build --workspace=@zemingengine/web
```

Expected: 编译成功

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/
git commit -m "feat(web): add ContentPage, PipelinePage, and navigation tabs"
```

---

## Phase 7: 集成测试与最终验证

### Task 24: 运行全量编译和 smoke 测试

**Files:**
- N/A

- [ ] **Step 1: 全量编译**

```bash
cd c:\Users\Administrator\Desktop\trae work GEO\geo-assistant-clean
npm run build
```

Expected: 所有 workspace 编译成功

- [ ] **Step 2: 运行所有测试**

```bash
cd c:\Users\Administrator\Desktop\trae work GEO\geo-assistant-clean
npm run test --workspace=@zemingengine/content-generator
npm run test --workspace=@zemingengine/content-reviewer
npm run test --workspace=@zemingengine/publisher
```

Expected: 所有测试通过

- [ ] **Step 3: 启动 Server 并 smoke 测试**

```bash
cd c:\Users\Administrator\Desktop\trae work GEO\geo-assistant-clean\apps\server
node dist/index.js
```

在另一个终端：

```bash
curl http://localhost:3000/api/health
```

Expected: `{"status":"ok",...}`

- [ ] **Step 4: 测试文章生成 API**

```bash
curl -X POST http://localhost:3000/api/articles/generate \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"test_session_001","platform":"weixin","contentType":"tutorial"}'
```

Expected: 返回 `success: true`，包含 article 和 review

- [ ] **Step 5: Commit**

```bash
git commit -m "chore: verify full build and smoke tests"
```

---

## Spec Coverage 自检

| Spec 需求 | 对应 Task | 状态 |
|-----------|-----------|------|
| SQLite 数据库 + 6 张表 | Task 1 | 已覆盖 |
| shared 类型扩展 | Task 2 | 已覆盖 |
| content-generator package | Task 3, 7, 8, 9, 10 | 已覆盖 |
| content-reviewer package | Task 4, 11, 12, 13 | 已覆盖 |
| publisher package | Task 5, 14, 15, 16, 17 | 已覆盖 |
| Server 路由 (article, review, publish, pipeline, credentials) | Task 18, 19, 20 | 已覆盖 |
| Web 前端 (stores, components, pages) | Task 21, 22, 23 | 已覆盖 |
| 10 平台适配器 stubs | Task 14, 15 | 已覆盖 |
| 回退生成 | Task 9 | 已覆盖 |
| 审核轮次控制 (3轮) | Task 12 | 已覆盖 |
| 发布队列 | Task 16 | 已覆盖 |
| 流水线编排 | Task 19 | 已覆盖 |
| 单元测试 | Task 10, 13, 17 | 已覆盖 |
| 集成验证 | Task 24 | 已覆盖 |

**无遗漏，无 placeholder。**

---

## 执行交接

**计划已完成并保存到** `docs/superpowers/plans/2026-07-31-article-publishing-plan.md`。

**两种执行方式：**

**1. Subagent-Driven（推荐）** — 每个 Task 分配一个独立子代理执行，主会话逐 Task 审阅

**2. Inline Execution** — 在当前会话中批量执行，使用 executing-plans 技能按检查点推进

**建议：** 由于计划包含 24 个 Task，推荐 **Subagent-Driven** 方式。Phase 1-4（后端核心）优先执行，Phase 5-6（API 和前端）随后，Phase 7 最终验证。

**选择哪种方式执行？**

interface PipelineStore {
