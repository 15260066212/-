# 代码腐烂风险扫描报告 — R4-R6

**项目**: geo-assistant-clean  
**扫描范围**: `apps/`, `packages/`, `harvester/` 下的 `.ts`, `.tsx`, `.js` 文件（排除 node_modules, dist, build, coverage）  
**扫描日期**: 2026-10-19  
**方法**: Grep 自动化扫描 + 抽样代码审查

---

## R4 — Accidental Complexity（偶然复杂度）

### 核心症状
不必要的抽象/中间层、投机通用代码、可用函数替代的复杂类、大量 switch/if-else。

---

#### R4-01 [Critical] `session-pool` 包 — 完全未使用的投机通用实现

- **文件**: `packages/session-pool/src/pool.ts`
- **症状**: 整个 `@zemingengine/session-pool` 包没有任何消费者。全项目搜索 `@zemingengine/session-pool` 返回 0 个 import 站点。
- **详情**:
  - 该包实现了一个完整的 `SessionPool` 类，包含 Playwright 浏览器池、指纹隔离、SQLite 持久化等功能
  - 实际应用使用的是 `apps/server/src/session-pool-adapter.ts` 中的 `SessionPoolAdapter`（实现 `ISessionPool` 接口）
  - 两者功能高度重叠：池管理、LRU 淘汰、storageState 持久化、指纹注入
  - `SessionPool` 直接依赖 `better-sqlite3` 和 `playwright`，而 `SessionPoolAdapter` 通过 `DatabaseAccess` 间接使用 DB
- **严重等级**: **Critical** — 死代码包，增加维护成本和认知负担，容易误导新开发者

---

#### R4-02 [Critical] `PublishingStrategyService` — 无消费者的服务类

- **文件**: `packages/ai-engine/src/publishing-strategy-service.ts`
- **症状**: 仅在自身定义、测试文件 (`ai-engine.test.ts`) 和 `index.ts` 导出中被引用，没有任何应用代码实际使用。
- **详情**:
  - 约 110 行代码，导出类和单例实例 `publishingStrategyService`
  - 全项目搜索 `publishingStrategyService` 或 `PublishingStrategyService`，只在 ai-engine 包内出现 3 次
  - `apps/server/`, `apps/web/`, `apps/harvester/` 均未使用
- **严重等级**: **Critical** — 典型的"为未来使用"而建的投机通用代码，从未被实际消费

---

#### R4-03 [Warning] MonitorRepository 中 4 处重复 switch 状态映射模式

- **文件**: `apps/server/src/repositories/monitor-repository.ts`
- **行号**: L35-L42, L206-L211, L226-L230, L245-L251
- **症状**: 4 个几乎相同的 switch 语句，都是遍历数据库行并按 status 字段累加到结果对象的对应属性。
- **详情**:
  - `getArticleStats()`: 6 种 article 状态 → switch 6 个 case
  - `getPipelineRunStats()`: 4 种 pipeline 状态 → switch 4 个 case
  - `getCredentialStats()`: 3 种 credential 状态 → switch 3 个 case
  - `getPublishTaskStats()`: 5 种 publish 状态 → switch 5 个 case
  - 模式完全相同：遍历 rows → switch row.status → 给 result.xxx 赋值
  - 可用泛型辅助函数 + 状态映射表替代，消除重复
- **严重等级**: **Warning** — 重复模式增加维护成本，新增状态时需修改多处

---

#### R4-04 [Warning] AI-Engine 中 6 个无状态 Service 类可用纯函数替代

- **文件**: `packages/ai-engine/src/` 下多个文件
  - `visibility-analysis-service.ts` (VisibilityAnalysisService)
  - `sentiment-analysis-service.ts` (SentimentAnalysisService)
  - `citation-analysis-service.ts` (CitationAnalysisService)
  - `result-parser-service.ts` (ResultParserService)
  - `publishing-strategy-service.ts` (PublishingStrategyService — 已废弃，见 R4-02)
  - `ai-platform-service.ts` (AIPlatformService — 有状态，除外)
- **症状**: 这些 Service 类没有构造函数参数、没有实例状态（除了单例自身），所有方法都可以提取为纯函数。
- **详情**:
  - 每个类导出一个单例实例（如 `visibilityAnalysisService`）
  - 类不持有可变状态，不依赖注入的协作者
  - 调用方式 `visibilityAnalysisService.analyzeResponse(...)` 等价于函数调用
  - 类包装增加了认知成本，却没有带来封装、多态或依赖注入的好处
- **严重等级**: **Warning** — 过度的面向对象设计，可用纯函数模块简化

---

#### R4-05 [Warning] 根目录 `harvester/` 与 `apps/harvester/` 功能重复

- **文件**: `harvester/` (根目录，纯 JS) vs `apps/harvester/` (TypeScript 版本)
- **症状**: 根目录存在一份独立的 harvester 实现（Express + WS，纯 JS），与 apps/harvester 功能重叠。
- **详情**:
  - 根目录 `harvester/server.js` 是入口，使用 Express + ws 库
  - 包含 config/, lib/, routes/ 等目录，结构与 apps/harvester 相似
  - `apps/harvester/src/` 是 TypeScript 版本，使用 Hono
  - 两者可能是迁移关系，但旧代码未清理
- **严重等级**: **Warning** — 重复实现造成混淆，需确认是否为遗留代码

---

#### R4-06 [Suggestion] CachedDatabaseAccess 继承式缓存装饰 — 重复性高

- **文件**: `apps/server/src/cached-db.ts` (286 行)
- **症状**: 通过继承 `DatabaseAccess` 添加缓存层，每个被缓存的方法都有相同的"检查缓存→缺失则委托→存储结果"模式。
- **详情**:
  - 8 个缓存读取方法 + 8 个写入失效方法，模式高度重复
  - 继承方式紧耦合，难以独立测试缓存逻辑
  - 可用组合（装饰器模式）或高阶函数减少重复
- **严重等级**: **Suggestion** — 结构上有优化空间但影响可控

---

## R5 — Dependency Disorder（依赖混乱）

### 核心症状
循环 import、依赖方向反转、跨层耦合。

---

#### R5-01 [Critical] Publisher 包直接依赖 Playwright 基础设施

- **文件**: `packages/publisher/src/` 下 16 个文件
  - `rpa-engine.ts` (L3)
  - `browser-fingerprint.ts` (L3)
  - `rpa/publication-verifier.ts` (L2)
  - `rpa-handlers/base.ts` (L2)
  - 以及所有 rpa-handlers 和 csdn strategies
- **症状**: 领域核心包 `publisher` 直接 import `playwright` 的类型（`Browser`, `BrowserContext`, `Page` 等）。
- **详情**:
  - `RpaHandler` 基类的 `publish` 方法签名直接使用 `Page` 类型
  - 所有平台 handler (10个) 都依赖 Playwright 的 `Page` 接口
  - `RPAEngine` 直接依赖 `Browser` 和 `BrowserContext`
  - 违反依赖倒置原则：领域层应依赖抽象接口，而非具体基础设施
  - 如果未来更换浏览器自动化工具（如从 Playwright 迁移到 Puppeteer），需修改所有 handler
- **严重等级**: **Critical** — 领域层与具体基础设施紧耦合，违反清洁架构依赖方向

---

#### R5-02 [Critical] SessionPool 包直接依赖 Playwright + better-sqlite3

- **文件**: `packages/session-pool/src/pool.ts` (L15-L16)
- **症状**: `SessionPool` 类直接 import `playwright` 和 `better-sqlite3`，领域逻辑与基础设施绑定。
- **详情**:
  - `import { chromium, type Browser, type BrowserContext } from 'playwright'`
  - `import Database from 'better-sqlite3'`
  - 构造函数直接接受 `dbPath` 字符串并自己创建数据库连接
  - （结合 R4-01，这个包实际上未被使用）
- **严重等级**: **Critical** — 依赖方向错误 + 死代码双重问题

---

#### R5-03 [Warning] 路由层（表现层）直接承载业务用例编排

- **文件**: 
  - `apps/server/src/routes/pipeline.ts` (423 行)
  - `apps/server/src/routes/article.ts`
  - `apps/server/src/routes/competitor-monitor.ts` (673 行)
- **症状**: 路由层直接 import `ContentGenerator`, `ContentReviewer`, `Publisher` 等领域服务，并编排完整的业务用例。
- **详情**:
  - `pipeline.ts` 包含 `executePipeline()`, `generateArticleWithRetry()`, `publishForPipeline()` 等用例级别的编排函数
  - `article.ts` 包含生成-审核重试循环 (`while (!review.passed && currentRound < MAX_REGEN_ROUNDS)`)
  - `competitor-monitor.ts` 包含完整的竞品分析流程（多平台查询→结果解析→情感分析→可见度分析→引用分析→聚合）
  - 缺少明确的应用服务层（Application Service），路由层既是 HTTP 适配器又是用例编排者
- **严重等级**: **Warning** — 跨层耦合，业务逻辑泄漏到表现层，难以复用和测试

---

#### R5-04 [Warning] 平台多套命名体系造成隐式耦合

- **文件**: `packages/shared/src/platform-registry.ts`
- **行号**: L53, L55, L68 及各处转换函数
- **症状**: 同一平台有 4 种不同的标识符（`id`, `sessionName`, `harvesterName`, `llmwikiName`），跨子系统通信需要频繁转换。
- **详情**:
  | 平台 id | sessionName | harvesterName | llmwikiName |
  |---------|-------------|---------------|-------------|
  | weixin  | weixin      | wechat        | wechat      |
  | baijia  | baijiahao    | baijiahao     | baijiahao   |
  | toutiao | toutiao     | toutiaohao    | toutiao     |
  | sohu    | sohu        | sohuhao       | sohuhao     |
  | netease | netease     | wangyihao     | wangyihao   |
  | zhidao  | zhidao      | zhidao        | baidu_zhidao|
  - 需要 `getPlatformInfoBySessionName()`, `getPlatformInfoByHarvesterName()`, `getHarvesterPlatformName()`, `getSessionPlatformName()`, `getPlatformLLMWikiName()` 等转换函数
  - 每次跨子系统调用都需要进行名称映射，增加耦合和出错概率
- **严重等级**: **Warning** — 平台命名不一致是历史遗留问题，但持续增加维护成本

---

## R6 — Domain Model Distortion（领域模型扭曲）

### 核心症状
原始类型迷恋、领域术语不一致、业务逻辑分散在错误的层。

---

#### R6-01 [Critical] 业务用例逻辑泄漏到路由层

- **文件**: 
  - `apps/server/src/routes/pipeline.ts` (423 行)
  - `apps/server/src/routes/competitor-monitor.ts` (673 行)
  - `apps/server/src/routes/article.ts`
- **症状**: 核心业务流程编排直接写在路由处理函数中。
- **详情**:
  - **pipeline.ts**: `executePipeline()` 是完整的流水线用例，包含：
    - 文章列表构建 (`buildArticleList`)
    - 带重试的文章生成 (`generateArticleWithRetry`)
    - 自动发布逻辑 (`publishForPipeline`)
    - 运行状态管理和取消检查
  - **competitor-monitor.ts**: 整个竞品分析流程：
    - 多 AI 平台并行查询
    - 结果解析 + 可见度分析 + 引用分析 + 情感分析
    - 数据聚合与统计（提及数、推荐率、声量占比、情感分布）
  - **article.ts**: 文章生成 + 审核 + 重试循环
  - 这些都是领域用例，应该存在于应用服务层而非路由层
  - 导致：无法在非 HTTP 场景复用、难以进行单元测试、路由文件膨胀
- **严重等级**: **Critical** — 业务逻辑处于错误的层级，架构腐化的核心指标

---

#### R6-02 [Critical] 全项目 ID 使用原始 string 类型（Primitive Obsession）

- **文件**: 整个代码库
- **症状**: 所有 ID 类型（`articleId`, `sessionId`, `userId`, `taskId`, `credentialId` 等）均为原始 `string` 类型。
- **详情**:
  - 函数签名中大量出现 `id: string`, `sessionId: string`, `articleId: string`
  - 例: `getArticle(id: string)`, `getArticlesBySession(sessionId: string)`, `upsertCredential(platform: string, ..., userId: string, accountId: string)`
  - 没有使用 branded types（如 `type ArticleId = string & { __brand: 'article' }`）或值对象
  - 风险：容易将错误类型的 ID 传入函数（如把 articleId 传给 sessionId 参数），编译器无法捕获
  - 数据库层、服务层、路由层一致使用纯字符串
- **严重等级**: **Critical** — 大规模原始类型迷恋，丧失类型安全性

---

#### R6-03 [Warning] 平台命名术语不一致

- **文件**: `packages/shared/src/platform-registry.ts` 及全项目
- **症状**: 同一平台在不同上下文中使用不同名称，且 id 与显示名称不对应。
- **详情**:
  - 微信公众号: 平台 id 是 `weixin`，但 harvester 中叫 `wechat`，LLMWiki 中也叫 `wechat`
  - 百家号: id 是 `baijia`，但 session/harvester/llmwiki 都叫 `baijiahao`
  - 头条号: id 是 `toutiao`，harvester 叫 `toutiaohao`，llmwiki 叫 `toutiao`
  - 搜狐号: id 是 `sohu`，harvester/llmwiki 叫 `sohuhao`
  - 网易号: id 是 `netease`，harvester/llmwiki 叫 `wangyihao`
  - 百度知道: id 是 `zhidao`，llmwiki 叫 `baidu_zhidao`
  - 开发者需要记忆 4 套命名体系，且跨模块调用时需频繁转换
- **严重等级**: **Warning** — 领域术语不统一，增加认知负担和 Bug 风险

---

#### R6-04 [Warning] 状态使用字符串字面量比较，缺乏状态对象

- **文件**: 
  - `apps/server/src/repositories/monitor-repository.ts` (4处 switch)
  - `apps/server/src/repositories/publish-repository.ts` (L110 switch)
  - 各路由文件中的状态判断
- **症状**: 文章状态、发布任务状态、凭证状态等均用字符串联合类型表示，代码中大量使用字符串比较和 switch 映射。
- **详情**:
  - 类型定义完善（`ArticleStatus`, `PublishTaskStatus`, `PipelineRunStatus` 等）
  - 但使用方式仍停留在字符串比较：`article.status === 'approved'`
  - MonitorRepository 中用 switch 将数据库行映射到统计对象（见 R4-03）
  - 缺少状态机模式或状态值对象来封装状态转换规则和行为
  - 状态转换逻辑散落在各处（如 `updateArticle(..., { status: 'publishing' })`）
- **严重等级**: **Warning** — 领域概念用原始字符串表示，状态转换规则无集中管理

---

#### R6-05 [Warning] PlatformCredentials.data 使用 Record<string, string> 存储异构认证数据

- **文件**: `packages/shared/src/index.ts` (L639)
- **症状**: `PlatformCredentials.data` 的类型是 `Record<string, string>`，用一个通用字典存储不同类型的认证数据。
- **详情**:
  - 注释列出了可能的 key：`cookie`, `cookies`, `storageState`, `fingerprintData`, `apiKey`, `token`
  - 不同认证类型（`api_key`, `cookie`, `token`）的数据结构完全不同
  - 访问 `data` 时需要知道具体的 key 名称，无类型安全
  - 应该使用 discriminated union：`{ type: 'api_key'; data: { apiKey: string } } | { type: 'cookie'; data: { cookie: string; storageState?: string } } | ...`
- **严重等级**: **Warning** — 领域概念用原始字典表示，类型安全性差

---

#### R6-06 [Suggestion] failure_type 为自由字符串，缺乏枚举约束

- **文件**: `apps/server/src/repositories/monitor-repository.ts` (L276-L283)
- **症状**: `failure_type` 字段在数据库中是自由字符串，代码中通过 `categoryLabels` 映射显示名称。
- **详情**:
  - 预定义的失败类型有 6 种：`network`, `auth`, `rate_limit`, `content`, `platform`, `unknown`
  - 但 `PublishTask.failureType` 的类型是 `string`（非联合类型）
  - `classifyFailure()` 函数动态生成 failure type
  - 新失败类型可能在未更新展示层的情况下被引入
- **严重等级**: **Suggestion** — 小范围的原始类型迷恋，影响相对有限

---

## 汇总统计

| 风险类别 | Critical | Warning | Suggestion | 总计 |
|----------|----------|---------|------------|------|
| R4 偶然复杂度 | 2 | 3 | 1 | 6 |
| R5 依赖混乱 | 2 | 2 | 0 | 4 |
| R6 领域模型扭曲 | 2 | 3 | 1 | 6 |
| **合计** | **6** | **8** | **2** | **16** |

### 最严重 Top 5

1. **R6-01** 业务用例逻辑泄漏到路由层 — 架构腐化核心指标
2. **R5-01** Publisher 包直接依赖 Playwright — 依赖方向错误
3. **R4-01** session-pool 包完全未使用 — 死代码 + 依赖问题双重风险
4. **R6-02** 全项目 ID 使用原始 string 类型 — 大规模类型安全缺失
5. **R4-02** PublishingStrategyService 无消费者 — 典型投机通用

---

*本报告仅做扫描分析，未修改任何代码。*
