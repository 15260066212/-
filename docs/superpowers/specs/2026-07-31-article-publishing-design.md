# 文章审核与自动发布系统设计文档

> **日期**: 2026-07-31
> **状态**: 已批准（方式A - 流水线架构）
> **作者**: GEO Assistant Team

---

## 1. 概述

### 1.1 目标

在现有 GEO Assistant monorepo 中增加三大能力：

1. **LLM 自动内容生成** — 基于 SessionData（企业画像、关键词库、知识库方案、平台策略）自动生成适配各平台的文章
2. **全自动内容审核** — 对生成内容进行合规性、质量、SEO、品牌一致性多维审核，无需人工干预
3. **多平台自动发布** — 将审核通过的文章自动发布到 10 个平台

### 1.2 目标平台

| 序号 | 平台 | 发布方式 | 认证方式 |
|------|------|----------|----------|
| 1 | 微信公众号 | API (草稿箱) | AppID + AppSecret |
| 2 | 知乎 | RPA (Playwright) | Cookie |
| 3 | 百家号 | RPA (Playwright) | Cookie |
| 4 | 今日头条 | RPA (Playwright) | Cookie |
| 5 | CSDN | API | Cookie + API Token |
| 6 | 掘金 | API | Cookie + UID |
| 7 | 小红书 | RPA (Playwright) | Cookie |
| 8 | B站 (专栏) | API | Cookie + CSRF Token |
| 9 | 搜狐号 | RPA (Playwright) | Cookie |
| 10 | 网易号 | RPA (Playwright) | Cookie |

### 1.3 架构选型

**方式A - 流水线架构**：三个独立 package 串联执行，数据通过 SQLite 持久化，通过 REST API 触发和监控。

```
SessionData → content-generator → content-reviewer → publisher
                   ↓                    ↓                ↓
              生成文章(草稿)       自动审核(通过/拒绝)   多平台发布
                   ↓                    ↓                ↓
              Article (DB)         ReviewResult (DB)  PublishTask (DB)
```

### 1.4 设计原则

- **独立可测**：每个 package 有清晰的输入输出接口，可独立测试
- **幂等执行**：任何环节失败可安全重试，不产生重复内容
- **渐进降级**：LLM 不可用时使用规则引擎回退；RPA 不可用时记录待人工发布
- **现有模式一致**：复用 `chatCompletion()` 封装、`ApiResponse<T>` 类型、Hono 路由模式、React 组件风格

---

## 2. 新增 Package 架构

### 2.1 目录结构

```
packages/
  content-generator/     # 新增：内容生成器
    src/
      index.ts           # 导出
      generator.ts       # 核心生成逻辑
      platform-adapter.ts # 平台格式适配
      prompt-builder.ts  # LLM 提示词构建
      types.ts           # 内部类型
    package.json
    tsconfig.json
  content-reviewer/      # 新增：内容审核器
    src/
      index.ts           # 导出
      reviewer.ts        # 核心审核逻辑
      rules/             # 审核规则模块
        compliance.ts    # 合规审核
        quality.ts       # 质量审核
        seo.ts           # SEO 审核
        brand.ts         # 品牌一致性审核
      scorer.ts          # 评分聚合
      types.ts           # 内部类型
    package.json
    tsconfig.json
  publisher/             # 新增：多平台发布器
    src/
      index.ts           # 导出
      publisher.ts       # 核心发布编排
      adapters/          # 平台适配器
        base.ts          # 抽象基类
        wechat.ts        # 微信公众号 (API)
        zhihu.ts         # 知乎 (RPA)
        baijia.ts        # 百家号 (RPA)
        toutiao.ts       # 今日头条 (RPA)
        csdn.ts          # CSDN (API)
        juejin.ts        # 掘金 (API)
        xiaohongshu.ts   # 小红书 (RPA)
        bilibili.ts      # B站 (API)
        sohu.ts          # 搜狐号 (RPA)
        netease.ts       # 网易号 (RPA)
      rpa-engine.ts      # Playwright 封装
      queue.ts           # 发布队列管理
      types.ts           # 内部类型
    package.json
    tsconfig.json
```

### 2.2 包间依赖

```
content-generator → @zemingengine/shared, @zemingengine/ai-engine
content-reviewer  → @zemingengine/shared, @zemingengine/ai-engine
publisher         → @zemingengine/shared, playwright
apps/server       → 以上三个包 + better-sqlite3
apps/web          → @zemingengine/shared (仅类型)
```

---

## 3. content-generator 详细设计

### 3.1 职责

接收 SessionData，为每个目标平台生成一篇适配该平台的文章草稿。支持最多 3 轮生成（第一轮生成 → 审核反馈 → 第二轮修正 → 审核反馈 → 第三轮最终修正）。

### 3.2 接口定义

```typescript
// packages/content-generator/src/types.ts

export interface GenerateRequest {
  sessionId: string;
  platform: PlatformId;
  contentType: ArticleContentType;  // 'tutorial' | 'case' | 'comparison' | 'popularization'
  keywords?: string[];              // 可选，覆盖默认关键词
  generationRound: number;          // 1-3
  reviewFeedback?: ReviewFeedback;  // 第2、3轮时传入上一轮审核反馈
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

// packages/content-generator/src/generator.ts

export class ContentGenerator {
  constructor(private options: {
    aiClient: typeof chatCompletion;
    fallbackMode: boolean;
  }) {}

  async generate(request: GenerateRequest, session: SessionData): Promise<GenerateResult>;
}
```

### 3.3 生成流程

1. **构建平台提示词** — 根据 `platform` 和 `contentType` 从 `session.prompts` 和 `session.contentPlaybook` 中提取基础策略，结合平台特定格式约束
2. **构建上下文** — 注入企业画像、关键词、知识库方案、词库作为事实来源
3. **LLM 调用** — 调用 `chatCompletion()`，temperature=0.7，maxTokens=4096
4. **平台格式适配** — 将 Markdown 正文转换为平台特定格式：
   - `contentHtml`：用于微信公众号、百家号、今日头条、B站专栏、搜狐号、网易号（HTML 格式）
   - `contentPlain`：用于小红书（纯文本格式，保留 emoji）
   - Markdown 原文保留在 `contentMarkdown`，用于知乎、CSDN、掘金
5. **元数据生成** — 自动生成标题、摘要、标签、封面图描述
6. **持久化** — 写入 SQLite articles 表，状态为 `draft`

### 3.4 平台适配规则

| 平台 | 格式 | 标题长度 | 正文字数 | 标签数 | 特殊要求 |
|------|------|----------|----------|--------|----------|
| 微信公众号 | HTML | ≤30 | 2000-5000 | 无 | 封面图必需 |
| 知乎 | Markdown | ≤40 | 1500-5000 | 3-5 | 答题式开头 |
| 百家号 | HTML | ≤30 | 1500-3000 | 3-5 | 无外链 |
| 今日头条 | HTML | ≤30 | 1000-3000 | 3-5 | 无外链 |
| CSDN | Markdown | ≤50 | 2000-8000 | 1-5 | 代码块格式 |
| 掘金 | Markdown | ≤50 | 2000-8000 | 1-5 | 技术导向 |
| 小红书 | 纯文本 | ≤20 | 300-1000 | 5-10 | emoji 友好 |
| B站专栏 | HTML | ≤40 | 1000-5000 | 3-10 | 可插入B站视频链接 |
| 搜狐号 | HTML | ≤30 | 1500-3000 | 3-5 | 无外链 |
| 网易号 | HTML | ≤30 | 1500-3000 | 3-5 | 无外链 |

### 3.5 LLM 不可用时的回退

当 `isAIAvailable() === false` 时，使用模板引擎从 SessionData 字段拼接文章：

- 标题 = `{产品名}{文章类型}：{核心卖点}`
- 正文 = 从 `session.contentPlaybook` 的 `titleExamples` 扩展 + `session.promotionGoal` 字段填充
- 标签 = `session.wordBank` 中前 5 个品牌词 + 产品词
- 质量较低但保证流程可跑通

### 3.6 与审核器的联动

`generationRound` > 1 时，`reviewFeedback` 包含上一轮的：
- 审核未通过项列表
- 具体修改建议
- 评分明细

生成器将这些反馈追加到 LLM 的 system prompt 中，指导修正。

---

## 4. content-reviewer 详细设计

### 4.1 职责

对生成的文章进行全自动审核，输出通过/拒绝决策 + 评分 + 详细问题列表。无人工干预。

### 4.2 审核维度

| 维度 | 权重 | 检查项 | 实现方式 |
|------|------|--------|----------|
| 合规性 | 30% | 政治敏感词、虚假宣传、绝对化用语（"最好""第一"）、医疗/金融违规 | 敏感词库 + LLM 判断 |
| 内容质量 | 25% | 字数达标、结构完整（引言/正文/结论）、无重复段落、信息密度 | 规则引擎 + LLM 评分 |
| SEO 适配 | 25% | 关键词密度（1%-3%）、TDK 完整性、标题含关键词、段落标题含关键词 | 规则引擎 |
| 品牌一致性 | 20% | 企业名称正确、产品名称一致、品牌调性匹配、事实与知识库一致 | 规则引擎 + LLM 判断 |

### 4.3 评分规则

- 每个维度 0-100 分
- 总分 = 加权平均
- **通过线**：总分 ≥ 75 且无合规性硬伤（合规性维度不得有 high 级别问题）
- **自动拒绝**：合规性维度出现 high 级别问题时，一票否决

### 4.4 接口定义

```typescript
// packages/content-reviewer/src/types.ts
// Note: ReviewResult, ReviewIssue, DimensionResult are imported from @zemingengine/shared

export interface ReviewRequest {
  article: Article;
  session: SessionData;
  round: number;  // 当前审核轮次（对应 generationRound）
}

// packages/content-reviewer/src/reviewer.ts

export class ContentReviewer {
  constructor(private options: {
    aiClient: typeof chatCompletion;
    fallbackMode: boolean;
    passThreshold: number;     // 默认 75
  }) {}

  async review(request: ReviewRequest): Promise<ReviewResult>;
}
```

### 4.5 审核流程

1. **规则引擎预检**（同步、快速）
   - 敏感词扫描（合规性）
   - 字数统计（质量）
   - 关键词密度计算（SEO）
   - 品牌名称匹配（品牌一致性）
2. **LLM 深度审核**（异步、全面）
   - 将文章全文 + SessionData 上下文发送给 LLM
   - LLM 返回结构化评分 JSON
3. **结果聚合**
   - 合并规则引擎和 LLM 的发现
   - 计算加权总分
   - 生成通过/拒绝决策
4. **持久化** — 写入 SQLite reviews 表

### 4.6 审核轮次控制

```
Round 1: 生成 → 审核
  ├─ 通过 → 进入发布队列
  └─ 拒绝 → Round 2

Round 2: 带反馈重新生成 → 审核
  ├─ 通过 → 进入发布队列
  └─ 拒绝 → Round 3

Round 3: 带反馈重新生成 → 审核
  ├─ 通过 → 进入发布队列
  └─ 拒绝 → 标记为 failed，记录日志，不发布
```

### 4.7 LLM 不可用时的回退

仅使用规则引擎审核。合规性和 SEO 维度完全依赖规则库，质量和品牌维度使用启发式规则（字数、结构、名称匹配）。通过线提高至 80 分以补偿 LLM 缺失带来的风险。

---

## 5. publisher 详细设计

### 5.1 职责

将审核通过的文章按平台发布。支持 API 直发和 RPA 浏览器自动化两种模式。

### 5.2 适配器架构

```typescript
// packages/publisher/src/adapters/base.ts

export abstract class PlatformAdapter {
  abstract readonly platform: PlatformId;
  abstract readonly method: 'api' | 'rpa';

  abstract publish(params: PublishParams): Promise<PublishResult>;
  abstract checkStatus(taskId: string): Promise<PublishStatus>;  // 检查已发布内容是否在线
  abstract validateCredentials(): Promise<boolean>;               // 验证凭据是否有效
}

export interface PublishParams {
  article: Article;
  credentials: PlatformCredentials;
  options?: {
    draft?: boolean;          // 是否发布为草稿（不直接上线）
    scheduledTime?: string;   // 定时发布时间
  };
}

export interface PublishResult {
  success: boolean;
  platformPostId?: string;   // 平台返回的文章 ID
  platformPostUrl?: string;  // 发布后的文章 URL
  error?: string;
  publishedAt?: string;
}
```

### 5.3 API 模式适配器

#### 5.3.1 微信公众号 (`wechat.ts`)

- **认证**：AppID + AppSecret → 获取 access_token
- **流程**：
  1. 获取 access_token
  2. 上传封面图（如有）→ 获取 media_id
  3. 调用 `POST /cgi-bin/draft/add` 新增草稿
  4. 调用 `POST /cgi-bin/freepublish/submit` 提交发布
- **限流**：access_token 7200s 有效期，本地缓存
- **降级**：API 失败时仅创建草稿，不自动提交发布

#### 5.3.2 CSDN (`csdn.ts`)

- **认证**：Cookie（包含 `UserName` 和 `UserToken`）
- **流程**：`POST https://bizapi.csdn.net/blog-console-api/v1/article/save` 提交文章
- **字段**：title, markdowncontent, content, tags, categories

#### 5.3.3 掘金 (`juejin.ts`)

- **认证**：Cookie（`sessionid`）+ UID
- **流程**：`POST https://api.juejin.cn/content_api/v1/article/publish` 提交文章

#### 5.3.4 B站专栏 (`bilibili.ts`)

- **认证**：Cookie（`SESSDATA`）+ CSRF Token（`bili_jct`）
- **流程**：`POST https://api.bilibili.com/x/article/creative/draft/addupdate` 创建草稿

### 5.4 RPA 模式适配器

适用于知乎、百家号、今日头条、小红书、搜狐号、网易号（无公开 API 或 API 限制大）。

```typescript
// packages/publisher/src/rpa-engine.ts

export class RpaEngine {
  constructor(private options: {
    headless: boolean;         // 默认 true
    slowMo?: number;           // 操作间隔（ms）
    cookieStore: string;       // Cookie 存储路径
  }) {}

  async withPage<T>(
    url: string,
    cookies: Cookie[],
    action: (page: Page) => Promise<T>
  ): Promise<T>;
}
```

**RPA 通用流程**：
1. 启动 Playwright 浏览器（headless）
2. 注入预存的 Cookie
3. 导航到平台编辑器页面
4. 填充标题、正文、标签
5. 上传封面图（如需要）
6. 点击发布/保存草稿按钮
7. 等待页面确认
8. 提取发布后的文章 URL
9. 关闭浏览器

**Cookie 管理**：
- 首次使用需通过浏览器手动登录（headful 模式）
- 登录后 Cookie 自动保存到 `data/cookies/{platform}.json`
- Cookie 过期时标记该平台为 `credentials_expired`，暂停发布

**RPA 容错**：
- 超时：每个操作 30s 上限
- 选择器失败：重试 3 次，每次增加 2s 延迟
- 页面结构变化：记录快照（screenshot + DOM）到日志，标记为 `rpa_selector_error`

### 5.5 发布队列

```typescript
// packages/publisher/src/queue.ts

export class PublishQueue {
  // 添加发布任务到队列
  async enqueue(task: PublishTask): Promise<void>;

  // 处理队列中的任务
  async process(): Promise<void>;

  // 获取队列状态
  getStatus(): QueueStatus;
}
```

**队列规则**：
- 同一平台的任务串行执行（避免触发风控）
- 不同平台的任务可并行执行（最多 3 个并发）
- 失败任务自动重试 2 次（间隔 60s）
- 重试仍失败则标记为 `failed`，记录错误日志
- `scheduledAt` 字段用于未来支持的定时发布功能，初期实现中所有任务均为即时发布

### 5.6 发布状态机

```
pending → publishing → published (成功)
                    → failed (失败，已用完重试)
                    → retrying (等待重试)
```

---

## 6. 数据持久化

### 6.1 SQLite 数据库

新增 `data/geo-assistant.db`，使用 `better-sqlite3` 同步驱动。

### 6.2 数据表设计

```sql
-- 会话持久化表（将现有内存中的 SessionData 持久化到数据库）
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,                  -- session_{timestamp}_{random}
  data TEXT NOT NULL,                   -- 完整 SessionData JSON
  current_stage TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 文章表
CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,                  -- art_{timestamp}_{random}
  session_id TEXT NOT NULL,             -- 关联的 GEO 配置会话
  platform TEXT NOT NULL,               -- weixin|zhihu|baijia|toutiao|csdn|juejin|xiaohongshu|bilibili|sohu|netease
  content_type TEXT NOT NULL,           -- tutorial|case|comparison|popularization
  title TEXT NOT NULL,
  content_markdown TEXT NOT NULL,       -- Markdown 原文
  content_html TEXT,                    -- HTML 格式（发布用）
  content_plain TEXT,                   -- 纯文本格式（小红书用）
  tags TEXT NOT NULL DEFAULT '[]',      -- JSON 数组
  summary TEXT,                         -- 文章摘要
  cover_image_desc TEXT,                -- 封面图描述（LLM 生成）
  word_count INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft', -- draft|reviewing|approved|publishing|published|failed
  generation_round INTEGER NOT NULL DEFAULT 1,
  generation_meta TEXT,                 -- JSON: model, tokensUsed, durationMs
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- 审核记录表
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,                  -- rev_{timestamp}_{random}
  article_id TEXT NOT NULL,
  round INTEGER NOT NULL,
  passed INTEGER NOT NULL,              -- 0 or 1
  overall_score REAL NOT NULL,
  compliance_score REAL NOT NULL,
  quality_score REAL NOT NULL,
  seo_score REAL NOT NULL,
  brand_score REAL NOT NULL,
  issues TEXT NOT NULL DEFAULT '[]',    -- JSON 数组
  suggestions TEXT NOT NULL DEFAULT '[]', -- JSON 数组
  reviewed_at TEXT NOT NULL,
  FOREIGN KEY (article_id) REFERENCES articles(id)
);

-- 发布任务表
CREATE TABLE IF NOT EXISTS publish_tasks (
  id TEXT PRIMARY KEY,                  -- pub_{timestamp}_{random}
  article_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|publishing|published|failed|retrying
  method TEXT NOT NULL,                 -- api|rpa
  platform_post_id TEXT,                -- 平台返回的文章 ID
  platform_post_url TEXT,               -- 发布后的 URL
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 2,
  scheduled_at TEXT,                    -- 定时发布时间
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (article_id) REFERENCES articles(id)
);

-- 发布日志表
CREATE TABLE IF NOT EXISTS publish_logs (
  id TEXT PRIMARY KEY,                  -- log_{timestamp}_{random}
  task_id TEXT NOT NULL,
  level TEXT NOT NULL,                  -- info|warn|error
  message TEXT NOT NULL,
  metadata TEXT,                        -- JSON
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES publish_tasks(id)
);

-- 平台凭据表（加密存储）
CREATE TABLE IF NOT EXISTS platform_credentials (
  platform TEXT PRIMARY KEY,
  credential_type TEXT NOT NULL,        -- api_key|cookie|token
  credential_data TEXT NOT NULL,        -- 加密后的 JSON
  status TEXT NOT NULL DEFAULT 'active', -- active|expired|invalid
  last_validated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_articles_session ON articles(session_id);
CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
CREATE INDEX IF NOT EXISTS idx_reviews_article ON reviews(article_id);
CREATE INDEX IF NOT EXISTS idx_publish_tasks_article ON publish_tasks(article_id);
CREATE INDEX IF NOT EXISTS idx_publish_tasks_status ON publish_tasks(status);
```

### 6.3 数据访问层

新增 `apps/server/src/db.ts`，封装所有数据库操作：

```typescript
export class Database {
  constructor(private db: BetterSQLite3.Database) {}

  // Sessions（将现有内存会话持久化）
  upsertSession(id: string, data: SessionData): void;
  getSession(id: string): SessionData | undefined;
  deleteSession(id: string): void;

  // Articles
  insertArticle(article: Article): void;
  updateArticle(id: string, updates: Partial<Article>): void;
  getArticle(id: string): Article | undefined;
  getArticlesBySession(sessionId: string): Article[];
  getArticlesByStatus(status: ArticleStatus): Article[];

  // Reviews
  insertReview(review: ReviewResult): void;
  getReviewsByArticle(articleId: string): ReviewResult[];
  getLatestReview(articleId: string): ReviewResult | undefined;

  // Publish Tasks
  insertPublishTask(task: PublishTask): void;
  updatePublishTask(id: string, updates: Partial<PublishTask>): void;
  getPublishTask(id: string): PublishTask | undefined;
  getPendingPublishTasks(): PublishTask[];
  getPublishTasksByArticle(articleId: string): PublishTask[];

  // Publish Logs
  insertPublishLog(log: PublishLog): void;
  getLogsByTask(taskId: string): PublishLog[];

  // Credentials
  upsertCredential(platform: string, data: PlatformCredentials): void;
  getCredential(platform: string): PlatformCredentials | undefined;
  updateCredentialStatus(platform: string, status: string): void;
}
```

---

## 7. 共享类型扩展

在 `packages/shared/src/index.ts` 中新增：

```typescript
// === Article types ===
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
  data: Record<string, string>;  // 具体字段因平台而异
  status: 'active' | 'expired' | 'invalid';
  lastValidatedAt?: string;
}

// === Pipeline types ===
export interface PipelineRequest {
  sessionId: string;
  platforms: PlatformId[];
  contentType: ArticleContentType;
  autoPublish: boolean;           // 审核通过后是否自动发布
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

// === API types ===
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
  platforms?: PlatformId[];   // 可选，默认为文章所属平台
  scheduledAt?: string;
}
```

---

## 8. Server API 路由

### 8.1 新增路由文件

```
apps/server/src/routes/
  article.ts     # 文章生成、查询
  review.ts      # 审核、审核结果查询
  publish.ts     # 发布任务、状态查询
  pipeline.ts    # 全流程编排
  credentials.ts # 平台凭据管理
```

### 8.2 API 端点

#### 文章 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/articles/generate` | 生成单篇文章（含自动审核） |
| GET | `/api/articles` | 查询文章列表（支持 ?sessionId=&status= 过滤） |
| GET | `/api/articles/:id` | 查询单篇文章详情 |
| PUT | `/api/articles/:id` | 手动修改文章内容 |
| DELETE | `/api/articles/:id` | 删除文章 |

#### 审核 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/reviews/:articleId` | 手动触发审核 |
| GET | `/api/reviews/:articleId` | 查询文章的所有审核记录 |
| GET | `/api/reviews/:articleId/latest` | 查询最新审核结果 |

#### 发布 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/publish` | 发布文章到指定平台 |
| GET | `/api/publish/:taskId` | 查询发布任务状态 |
| GET | `/api/publish` | 查询发布任务列表 |
| POST | `/api/publish/:taskId/retry` | 手动重试失败的发布任务 |

#### 流水线 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/pipeline/start` | 启动全流程（生成+审核+发布） |
| GET | `/api/pipeline/status/:sessionId` | 查询流水线状态 |
| POST | `/api/pipeline/cancel/:sessionId` | 取消流水线 |

#### 凭据 API

| 方法 | 路径 | 说明 |
|------|------|------|
| PUT | `/api/credentials/:platform` | 更新平台凭据 |
| GET | `/api/credentials` | 列出所有平台凭据状态 |
| POST | `/api/credentials/:platform/validate` | 验证凭据有效性 |

### 8.3 流水线编排逻辑

`POST /api/pipeline/start` 的处理流程：

```
1. 验证 sessionId 存在且配置已完成
2. 遍历 platforms：
   for each platform:
     a. content-generator.generate() → Article (draft)
     b. content-reviewer.review() → ReviewResult
     c. if passed → 更新 Article 状态为 approved
        if !passed && round < 3:
          → 带反馈重新生成（回到 a）
        if !passed && round == 3:
          → 更新 Article 状态为 failed，记录日志
     d. if autoPublish && approved:
        → publisher.enqueue() → PublishTask (pending)
3. 启动 publisher 队列处理
4. 返回 PipelineStatus
```

---

## 9. Web 前端

### 9.1 新增页面

在现有 App.tsx 中增加导航，支持在「配置对话」和「内容管理」两个视图间切换。

```
apps/web/src/
  components/
    articles/
      ArticleList.tsx         # 文章列表（支持按平台/状态过滤）
      ArticleDetail.tsx       # 文章详情（含审核结果、发布状态）
      ArticleStatusBadge.tsx  # 状态标签组件
      ReviewReport.tsx        # 审核报告展示
      PublishStatusPanel.tsx  # 发布状态面板
    pipeline/
      PipelineLauncher.tsx    # 流水线启动器
      PipelineDashboard.tsx   # 流水线总览仪表盘
    credentials/
      CredentialManager.tsx   # 凭据管理
  stores/
    articleStore.ts           # 文章状态管理
    pipelineStore.ts          # 流水线状态管理
  pages/
    ContentPage.tsx           # 内容管理主页面
    PipelinePage.tsx          # 流水线页面
```

### 9.2 页面交互

**内容管理页面**：
- 顶部：平台筛选 + 状态筛选 + 内容类型筛选
- 左侧：文章列表（标题、平台图标、状态徽章、审核分数）
- 右侧：选中文章的详情（Markdown 预览、审核报告、发布状态）
- 底部：操作栏（编辑、重新审核、发布、删除）

**流水线页面**：
- 启动区：选择 Session、勾选平台、选择内容类型、开关自动发布
- 状态总览：卡片式展示各状态文章数量
- 进度列表：每篇文章的生成→审核→发布进度条
- 实时刷新：每 5 秒轮询 `/api/pipeline/status/:sessionId`

**凭据管理页面**：
- 10 个平台的凭据状态卡片
- 每个卡片显示：平台名、认证方式、状态（有效/过期/未配置）、最后验证时间
- 操作：更新凭据、验证凭据

### 9.3 状态管理

使用 Zustand（与现有 `sessionStore.ts` 一致）：

```typescript
// stores/articleStore.ts
interface ArticleStore {
  articles: Article[];
  selectedArticle: Article | null;
  loading: boolean;
  error: string | null;

  fetchArticles: (sessionId?: string) => Promise<void>;
  selectArticle: (id: string) => void;
  generateArticle: (req: GenerateArticleRequest) => Promise<void>;
  publishArticle: (articleId: string, platforms?: PlatformId[]) => Promise<void>;
}

// stores/pipelineStore.ts
interface PipelineStore {
  status: PipelineStatus | null;
  isRunning: boolean;

  startPipeline: (req: PipelineRequest) => Promise<void>;
  fetchStatus: (sessionId: string) => Promise<void>;
  cancelPipeline: (sessionId: string) => Promise<void>;
}
```

---

## 10. 依赖新增

### 10.1 新增 npm 包

| 包 | 用途 | 安装位置 |
|----|------|----------|
| `better-sqlite3` | SQLite 驱动 | apps/server |
| `playwright` | RPA 浏览器自动化 | packages/publisher |
| `dompurify` | HTML 净化 | packages/content-generator |

### 10.2 新增 package.json 配置

**content-generator/package.json**:
```json
{
  "name": "@zemingengine/content-generator",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "node --test",
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

**content-reviewer/package.json**:
```json
{
  "name": "@zemingengine/content-reviewer",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "node --test",
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

**publisher/package.json**:
```json
{
  "name": "@zemingengine/publisher",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "node --test",
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

---

## 11. 错误处理与重试策略

### 11.1 错误分类

| 错误类型 | 处理策略 | 通知方式 |
|----------|----------|----------|
| LLM 调用失败 | 回退到规则引擎，降级生成 | 日志记录 |
| LLM 返回格式异常 | 重试 1 次，仍失败则回退 | 日志记录 |
| 审核规则引擎异常 | 跳过该维度，仅使用 LLM 审核 | 日志记录 |
| API 发布认证失败 | 标记凭据过期，暂停该平台 | 仪表盘告警 |
| API 发布限流 | 延迟 60s 后重试 | 日志记录 |
| RPA 选择器失败 | 重试 3 次，截图记录 | 仪表盘告警 |
| RPA Cookie 过期 | 标记凭据过期，暂停该平台 | 仪表盘告警 |
| 数据库写入失败 | 重试 3 次，间隔 1s | 日志记录 + 告警 |
| 全流程未捕获异常 | 标记文章为 failed，保留已完成步骤 | 仪表盘告警 |

### 11.2 重试参数

```
LLM 调用: 1 次重试，无延迟
审核: 无重试（审核是幂等的）
API 发布: 2 次重试，间隔 60s
RPA 操作: 3 次重试，间隔递增 2s/4s/6s
数据库: 3 次重试，间隔 1s/2s/3s
```

---

## 12. 测试策略

### 12.1 单元测试

| 模块 | 测试重点 | 工具 |
|------|----------|------|
| content-generator | 提示词构建正确性、平台适配规则、回退生成 | node:test |
| content-reviewer | 敏感词检测、评分计算、通过/拒绝逻辑、反馈生成 | node:test |
| publisher | 适配器接口一致性、队列调度逻辑、重试逻辑 | node:test |
| db | CRUD 操作、索引查询、事务处理 | node:test |

### 12.2 集成测试

- **生成→审核**：验证单轮和多轮生成审核联动
- **审核→发布**：验证审核通过后自动入队
- **全流程**：模拟完整 pipeline 从生成到发布

### 12.3 RPA 测试

- 使用 Playwright 的 `test` 框架
- Mock 平台页面（使用 Playwright 的 `route` 拦截）
- 验证选择器健壮性（页面结构微调不影响操作）

---

## 13. 配置项

### 13.1 环境变量（.env）

```bash
# 现有
OPENAI_API_KEY=
OPENAI_BASE_URL=
OPENAI_MODEL=

# 新增 - 数据库
DATABASE_PATH=./data/geo-assistant.db

# 新增 - RPA
RPA_HEADLESS=true
RPA_SLOW_MO=100
COOKIE_STORE_PATH=./data/cookies

# 新增 - 审核
REVIEW_PASS_THRESHOLD=75
REVIEW_LLM_ENABLED=true

# 新增 - 发布
PUBLISH_MAX_CONCURRENT=3
PUBLISH_RETRY_INTERVAL_MS=60000
PUBLISH_MAX_RETRIES=2

# 新增 - 平台凭据（也可通过 API 动态设置）
WECHAT_APP_ID=
WECHAT_APP_SECRET=
CSDN_COOKIE=
JUEJIN_COOKIE=
JUEJIN_UID=
BILIBILI_COOKIE=
BILIBILI_CSRF_TOKEN=
```

### 13.2 平台凭据安全

- 凭据通过 API 动态设置时，存储前使用 AES-256-GCM 加密
- 加密密钥从环境变量 `CREDENTIAL_ENCRYPTION_KEY` 读取
- 日志中永不记录凭据明文
- Cookie 文件权限设为 600

---

## 14. 实现顺序建议

1. **Phase 1 - 基础设施**
   - SQLite 数据库 + 数据访问层
   - shared 类型扩展
   - Server 路由骨架

2. **Phase 2 - 内容生成**
   - content-generator 包
   - 平台适配规则
   - 提示词构建
   - 回退生成

3. **Phase 3 - 内容审核**
   - content-reviewer 包
   - 规则引擎（敏感词、SEO、品牌）
   - LLM 审核集成
   - 评分聚合

4. **Phase 4 - 发布**
   - publisher 包
   - API 适配器（微信、CSDN、掘金、B站）
   - RPA 引擎
   - RPA 适配器（知乎、百家号、头条、小红书、搜狐、网易）
   - 发布队列

5. **Phase 5 - 流水线编排**
   - pipeline 路由
   - 生成→审核→发布联动
   - 状态追踪

6. **Phase 6 - 前端**
   - 内容管理页面
   - 流水线仪表盘
   - 凭据管理页面

7. **Phase 7 - 测试与加固**
   - 单元测试
   - 集成测试
   - 错误处理完善
