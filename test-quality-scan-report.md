# 测试质量风险扫描报告

**项目**: geo-assistant-clean
**扫描范围**: apps/server 和 apps/harvester 下所有 .test.ts / .test.js / .spec.ts / .spec.js / .test.mjs 文件（共 35 个）
**扫描日期**: 2026-10-19
**排除范围**: node_modules, dist

---

## T1 - Test Obscurity（测试不清晰）

### T1.1 Assertion Roulette（断言轮盘赌 - 多断言无消息）

**严重等级**: Warning

| # | 文件 | 行号 | 症状描述 | 严重等级 |
|---|------|------|----------|----------|
| 1 | `apps/harvester/__tests__/unit/captcha-classifier.test.mjs` | 6-62 | 22 个断言全部无描述消息，测试失败时无法定位具体哪个断言失败 | Critical |
| 2 | `apps/harvester/__tests__/unit/cookie-utils.test.mjs` | 17-148 | 56 个断言中绝大多数无消息，覆盖 parseCookieString / filterCookiesByDomain / cookiesToString 等所有函数 | Critical |
| 3 | `apps/harvester/__tests__/unit/session-scoring.test.mjs` | 13-110 | 26 个断言中大部分无消息，仅部分 toContain 断言因语义清晰可接受 | Warning |
| 4 | `apps/harvester/__tests__/unit/credentials-store.test.mjs` | 34-158 | 26 个断言中约半数无消息，特别是 load/save/getAll 等函数的断言 | Warning |
| 5 | `apps/harvester/__tests__/unit/error-classifier.test.mjs` | 31+ | 19 个断言全部无消息 | Warning |
| 6 | `apps/harvester/__tests__/unit/selector-validator.test.mjs` | 全文 | 34 个断言中大部分无消息 | Warning |
| 7 | `apps/server/src/session-health/types.test.ts` | 全文 | 16 个断言中多数无消息 | Suggestion |

### T1.2 Mystery Guest（神秘访客 - 依赖外部隐藏状态）

**严重等级**: Warning

| # | 文件 | 行号 | 症状描述 | 严重等级 |
|---|------|------|----------|----------|
| 1 | `apps/harvester/__tests__/integration/session-api.test.mjs` | 13 | 通过 `global.__playwrightMocks` 访问全局 mock 状态，依赖外部 setup 文件注入，测试阅读者无法从当前文件理解 mock 来源 | Critical |
| 2 | `apps/harvester/__tests__/integration/credentials.test.mjs` | 13 | 依赖 `process.env.CREDENTIALS_DIR` 环境变量 + 临时文件系统目录作为隐藏状态 | Warning |
| 3 | `apps/harvester/__tests__/integration/credentials-sync.test.mjs` | 17 | 同上，且通过 `vi.stubGlobal('fetch', mockFetch)` 修改全局状态 | Warning |
| 4 | `apps/harvester/__tests__/integration/health.test.mjs` | 13 | 依赖 process.env 和临时目录 | Suggestion |
| 5 | `apps/harvester/__tests__/integration/platforms.test.mjs` | - | 依赖全局 server 实例状态 | Suggestion |

### T1.3 测试名称不描述行为

**严重等级**: Suggestion

| # | 文件 | 行号 | 症状描述 | 严重等级 |
|---|------|------|----------|----------|
| 1 | `apps/server/src/session-health/validators/base.test.ts` | - | 测试名 "返回对象结果" 过于笼统，未说明验证了什么行为 | Suggestion |
| 2 | `apps/server/src/session-health/selector-registry.test.ts` | - | "注册表非空"、"包含 zhihu 平台" 等名称只描述了状态而非行为 | Suggestion |
| 3 | `apps/server/src/session-health/validators/harvester-registry.test.ts` | - | "注册了 9 个平台"、"包含 zhihu" 等名称偏向状态描述 | Suggestion |

> 注：整体测试命名质量尚可，大部分测试使用中文描述行为，未发现 test1 / shouldWork 等典型坏味道。

---

## T2 - Test Brittleness（测试脆弱）

### T2.1 断言实现细节而非行为

**严重等级**: Critical

| # | 文件 | 行号 | 症状描述 | 严重等级 |
|---|------|------|----------|----------|
| 1 | `apps/server/src/routes.test.ts` | 403-463 | 凭证脱敏测试断言了精确的星号数量和格式（如 `te**********45`、`wx********90`），若脱敏算法从"首2尾2"改为"首3尾2"，即使功能正常测试也会失败 | Critical |
| 2 | `apps/server/src/session-health/alerter.test.ts` | 46-188 | 几乎所有测试通过 `mockDb.credentials.insertHealthAlert.mock.calls[0][N]` 直接读取 mock 的内部调用参数来验证，而非验证可观察的行为输出 | Critical |
| 3 | `apps/server/src/publish-utils.test.ts` | 44-104 | 全部断言都在验证 mock 函数被如何调用（参数值、调用次数），而非验证发布处理的最终状态 | Critical |
| 4 | `apps/server/src/routes.test.ts` | 423 | 断言 `toMatch(/^ve\*{20}23$/)` - 精确匹配星号数量，属于实现细节 | Warning |
| 5 | `apps/server/src/session-health/validators/harvester-browser.test.ts` | 143,163,272,294 | 通过 `fetchSpy.mock.calls[0][1].body` 解析请求体验证内部实现 | Warning |

### T2.2 Eager Test（单个测试验证多个不相关行为）

**严重等级**: Warning

| # | 文件 | 行号 | 症状描述 | 严重等级 |
|---|------|------|----------|----------|
| 1 | `apps/server/src/routes/message.test.ts` | 62-80 | "有效的企业配置应保存全部字段" - 单个测试 12 个断言，验证了 fullName/shortName/foundedYear/phone/email/address/brandTone/userPainPoints/products 等 10+ 个独立字段 | Critical |
| 2 | `apps/server/src/routes.test.ts` | 99-109 | "POST / - should create a new session" - 6 个断言验证 sessionId 格式、sessionData、introMessage 等多个关注点 | Warning |
| 3 | `apps/server/src/routes.test.ts` | 236-249 | "GET /:id - should return 200 with full article data" - 7 个断言验证 id/title/platform/tags 等 | Warning |
| 4 | `apps/server/src/platform-registry.test.ts` | 全文 | 平均每个 it 4.1 个断言，部分测试验证了过多属性 | Warning |
| 5 | `apps/harvester/__tests__/integration/credentials-sync.test.mjs` | - | 平均每个 it 4.8 个断言，部分测试混合了 HTTP 状态、响应结构、业务逻辑等多层断言 | Warning |
| 6 | `apps/server/src/routes.test.ts` | 525-578 | "GET /status/:sessionId - should return article counts and summaries" - 12+ 个断言，涵盖计数、数组内容、嵌套属性等 | Warning |

---

## T3 - Test Duplication（测试重复）

### T3.1 巨型测试文件（多模块混在一起）

**严重等级**: Critical

| # | 文件 | 行数 | it 数 | 断言数 | 症状描述 | 严重等级 |
|---|------|------|-------|--------|----------|----------|
| 1 | `apps/server/src/routes.test.ts` | 649 | 33 | 152 | 单个文件混合了 Session / Article / Review / Credential / Pipeline 共 5 个路由模块的测试，应拆分为 5 个独立测试文件 | Critical |
| 2 | `apps/server/src/db.test.ts` | 700+ | 40+ | 108 | 单个文件覆盖了 Sessions / Articles / Reviews / Publish Tasks / Publish Logs / Credentials / Pipeline Runs / Users / Monitor Stats 等 10+ 个数据库领域，应按 repository 拆分 | Critical |

### T3.2 跨层次重复测试相同场景

**严重等级**: Warning

| # | 重复场景 | 文件 A（Unit） | 文件 B（Integration/Routes） | 症状描述 | 严重等级 |
|---|----------|----------------|------------------------------|----------|----------|
| 1 | 凭证 CRUD | `apps/harvester/__tests__/unit/credentials-store.test.mjs` | `apps/harvester/__tests__/integration/credentials.test.mjs` | 两层都测试了凭证的增删改查，集成测试通过 HTTP API 重复验证了 unit 层已覆盖的逻辑 | Warning |
| 2 | 文章 CRUD | `apps/server/src/db.test.ts` (Articles) | `apps/server/src/routes.test.ts` (Article Routes) | db.test.ts 直接测试数据库层文章 CRUD，routes.test.ts 通过路由层再次测试相同的 CRUD 行为 | Warning |
| 3 | 凭证增删查 | `apps/server/src/db.test.ts` (Credentials) | `apps/server/src/routes.test.ts` (Credential Routes) | 同上，数据库层和路由层重复测试凭证 CRUD | Warning |
| 4 | Session 生命周期 | `apps/server/src/db.test.ts` (Sessions) | `apps/server/src/routes.test.ts` (Session Routes) | 同上 | Suggestion |

### T3.3 相似断言模式重复

**严重等级**: Suggestion

| # | 文件 | 症状描述 | 严重等级 |
|---|------|----------|----------|
| 1 | `apps/server/src/session-health/alerter.test.ts` | 每个测试都重复 `mock.calls[0][N]` 的模式提取参数再断言，可提取为辅助函数 | Suggestion |
| 2 | `apps/server/src/routes.test.ts` | 每个路由的 404 测试模式高度相似（GET/DELETE 非存在资源返回 404） | Suggestion |
| 3 | `apps/harvester/__tests__/unit/cookie-utils.test.mjs` | 多个测试重复构造 cookies 数组并断言 name/value/domain | Suggestion |

---

## T4 - Mock Abuse（Mock 滥用）

### T4.1 Mock 调用验证占比过高（测试主要验证 mock 而非行为）

**严重等级**: Critical

| # | 文件 | Mock 断言数 | 总断言数 | Mock 断言占比 | 症状描述 | 严重等级 |
|---|------|------------|---------|--------------|----------|----------|
| 1 | `apps/server/src/publish-utils.test.ts` | 11 | 11 | **100%** | 所有断言都在验证 `updatePublishTask` 和 `updateArticle` 是否被调用及参数，完全不验证实际发布结果状态 | Critical |
| 2 | `apps/server/src/session-health/alerter.test.ts` | 10 | 12 | **83%** | 绝大多数断言通过 `insertHealthAlert.mock.calls[0]` 读取调用参数，而非验证告警的实际效果 | Critical |
| 3 | `apps/server/src/captcha-manager.test.ts` | 4 | 15 | 27% | 部分测试验证 mock 调用而非验证码管理的业务结果 | Warning |
| 4 | `apps/server/src/scheduler/cookie-warmer.test.ts` | 3 | 17 | 18% | 部分测试验证 console.log 和 db 方法的调用 | Warning |
| 5 | `apps/server/src/credential-resolver.test.ts` | 4 | 23 | 17% | 混合验证行为和 mock 调用 | Suggestion |

### T4.2 单个文件 Mock 数量过多

**严重等级**: Warning

| # | 文件 | vi.fn/spyOn/stubGlobal 数量 | createMock 工厂数 | 症状描述 | 严重等级 |
|---|------|----------------------------|-------------------|----------|----------|
| 1 | `apps/server/src/session-health/validators/wechat.test.ts` | 20 | - | 大量 vi.stubGlobal('fetch', ...) 和 vi.fn().mockResolvedValue，每个测试独立 stub fetch | Warning |
| 2 | `apps/server/src/session-health/validators/harvester-browser.test.ts` | 20 | - | 同上，每个测试场景都创建新的 fetchSpy | Warning |
| 3 | `apps/server/src/session-health/checker.test.ts` | 11 | 1 | mockDb 包含 8 个 vi.fn() 方法 + reloginManager 3 个 vi.fn() | Warning |
| 4 | `apps/server/src/scheduler/cookie-warmer.test.ts` | 7 | 1 | mockDb 有 5 个 vi.fn() + consoleSpy | Warning |
| 5 | `apps/server/src/captcha-manager.test.ts` | 6 | 1 | mockDb 包含多个 vi.fn() | Warning |

---

## T5 - Missing Tests（测试缺失）

### T5.1 无测试覆盖的核心模块（Server 端）

**严重等级**: Critical

| # | 模块 | 文件路径 | 功能说明 | 严重等级 |
|---|------|----------|----------|----------|
| 1 | 发布路由 | `apps/server/src/routes/publish.ts` | 核心发布流程路由，直接影响业务 | Critical |
| 2 | 发布调度器 | `apps/server/src/scheduler/plan-scheduler.ts` | 内容生产计划调度核心逻辑 | Critical |
| 3 | 并发控制器 | `apps/server/src/scheduler/concurrency-controller.ts` | 发布并发控制，影响系统稳定性 | Critical |
| 4 | 健康检查调度器 | `apps/server/src/scheduler/health-checker.ts` | 凭证健康检查调度 | Warning |
| 5 | 缓存清理调度器 | `apps/server/src/scheduler/cache-cleanup.ts` | 定期缓存清理 | Suggestion |
| 6 | 节点注册表 | `apps/server/src/node-registry.ts` | RPA 节点注册与管理 | Warning |
| 7 | 节点路由 | `apps/server/src/routes/nodes.ts` | 节点管理 API | Warning |
| 8 | 竞品监控路由 | `apps/server/src/routes/competitor-monitor.ts` | 竞品监控功能 | Warning |
| 9 | 优化计划路由 | `apps/server/src/routes/optimization-plan.ts` | 内容优化计划 | Warning |
| 10 | Cookie 采集路由 | `apps/server/src/routes/cookie-harvester.ts` | Cookie 采集管理 | Warning |
| 11 | 配置文件路由 | `apps/server/src/routes/profiles.ts` | 企业配置档案 | Warning |
| 12 | 监控路由 | `apps/server/src/routes/monitor.ts` | 系统监控 API | Warning |
| 13 | 爬取路由 | `apps/server/src/routes/scrape.ts` | 内容爬取功能 | Warning |
| 14 | 导入路由 | `apps/server/src/routes/import.ts` | 数据导入功能 | Warning |
| 15 | 手动操作路由 | `apps/server/src/routes/manual.ts` | 人工干预功能 | Suggestion |
| 16 | 用户路由 | `apps/server/src/routes/user.ts` | 用户管理 | Suggestion |
| 17 | 全部 Repository | `apps/server/src/repositories/*.ts`（10 个文件） | article / credential / monitor / pipeline / plan / publish / review / selector / session / user 仓库层全部无独立单元测试 | Critical |
| 18 | 速率限制中间件 | `apps/server/src/middleware/rate-limit.ts` | API 限流 | Warning |
| 19 | 会话池适配器 | `apps/server/src/session-pool-adapter.ts` | 会话池管理 | Warning |
| 20 | 服务容器 | `apps/server/src/service-container.ts` | 依赖注入容器 | Suggestion |
| 21 | 文章页脚 | `apps/server/src/article-footer.ts` | 内容处理工具 | Suggestion |
| 22 | 缓存数据库 | `apps/server/src/cached-db.ts` | 数据库缓存层 | Warning |
| 23 | Harvester 客户端 | `apps/server/src/session-health/harvester-client.ts` | 健康检查 harvester 通信层 | Warning |

### T5.2 无测试覆盖的核心模块（Harvester 端）

**严重等级**: Critical

| # | 模块 | 文件路径 | 功能说明 | 严重等级 |
|---|------|----------|----------|----------|
| 1 | 远程浏览器 | `apps/harvester/src/remote-browser.ts` | 浏览器管理核心 | Critical |
| 2 | 发布路由 | `apps/harvester/src/routes/publish.ts` | RPA 发布 API | Critical |
| 3 | 远程操作路由 | `apps/harvester/src/routes/remote.ts` | 远程控制 API | Critical |
| 4 | RPA 路由 | `apps/harvester/src/routes/rpa.ts` | RPA 任务管理 | Critical |
| 5 | 配置文件路由 | `apps/harvester/src/routes/profiles.ts` | 账号配置管理 | Warning |
| 6 | 全部远程操作 | `apps/harvester/src/remote-actions/*.ts`（5 个文件） | input / mouse / nav / stream 等浏览器操作全部无测试 | Critical |
| 7 | 节点代理服务 | `apps/harvester/src/services/node-agent.ts` | 节点通信服务 | Warning |
| 8 | 主服务客户端 | `apps/harvester/src/services/main-server-client.ts` | 与主服务通信 | Warning |
| 9 | 凭证事件服务 | `apps/harvester/src/services/credential-events.ts` | 凭证变更事件 | Suggestion |
| 10 | 本地部署器 | `apps/harvester/src/services/local-deployer.ts` | 本地部署功能 | Suggestion |
| 11 | 发布上下文 | `apps/harvester/src/lib/publish-context.ts` | 发布上下文管理 | Warning |
| 12 | 账号配置档案 | `apps/harvester/src/lib/account-profiles.ts` | 账号档案管理 | Warning |
| 13 | 平台配置 | `apps/harvester/src/config/platforms.ts` | 平台配置定义 | Suggestion |

> 注：Harvester 端仅 6 个工具函数有 unit 测试 + 5 个集成测试，核心业务逻辑（浏览器操作、发布流程）几乎完全无单元测试覆盖。

---

## T6 - Slow Tests（慢测试）

### T6.1 集成测试使用真实 HTTP Server + 文件系统

**严重等级**: Warning

| # | 文件 | 测试数 | 慢测试模式 | 严重等级 |
|---|------|--------|-----------|----------|
| 1 | `apps/harvester/__tests__/integration/session-api.test.mjs` | 11 | beforeAll 启动真实 server + supertest HTTP 请求 + 临时目录 + playwright mock | Warning |
| 2 | `apps/harvester/__tests__/integration/credentials.test.mjs` | 10 | beforeAll 启动真实 server + supertest + 文件系统读写 | Warning |
| 3 | `apps/harvester/__tests__/integration/credentials-sync.test.mjs` | 6 | beforeAll 启动真实 server + supertest + fetch mock + 文件系统 | Warning |
| 4 | `apps/harvester/__tests__/integration/platforms.test.mjs` | - | beforeAll 启动真实 server + supertest | Suggestion |
| 5 | `apps/harvester/__tests__/integration/health.test.mjs` | 1 | beforeAll 启动真实 server + supertest | Suggestion |

### T6.2 真实数据库测试

**严重等级**: Warning

| # | 文件 | 测试数 | 慢测试模式 | 严重等级 |
|---|------|--------|-----------|----------|
| 1 | `apps/server/src/db.test.ts` | 40+ | 每个 beforeEach 创建真实 SQLite 数据库连接 + 表结构初始化，afterEach 关闭连接 | Warning |
| 2 | `apps/server/src/routes.test.ts` | 33 | 同上，每个测试创建/销毁真实数据库 + 路由实例 | Warning |
| 3 | `apps/server/src/routes/message.test.ts` | 3 | 同上，真实数据库 + session 创建 | Warning |
| 4 | `apps/server/src/routes/auth.test.ts` | 6 | 真实数据库测试 | Warning |

### T6.3 潜在慢测试风险

**严重等级**: Suggestion

| # | 文件 | 症状描述 | 严重等级 |
|---|------|----------|----------|
| 1 | `apps/server/src/cache.test.ts` | 使用 `vi.useFakeTimers()` 测试缓存过期，但部分测试可能依赖真实时钟 | Suggestion |
| 2 | `apps/server/src/scheduler/cookie-warmer.test.ts` | 使用 fake timers，但涉及定时任务逻辑，未来扩展可能变慢 | Suggestion |

---

## 总结统计

| 风险类别 | Critical | Warning | Suggestion | 合计 |
|----------|----------|---------|------------|------|
| T1 Test Obscurity | 3 | 6 | 3 | 12 |
| T2 Test Brittleness | 4 | 5 | 0 | 9 |
| T3 Test Duplication | 2 | 3 | 2 | 7 |
| T4 Mock Abuse | 2 | 6 | 2 | 10 |
| T5 Missing Tests | 7 | 17 | 9 | 33 |
| T6 Slow Tests | 0 | 5 | 3 | 8 |
| **总计** | **18** | **42** | **19** | **79** |

### 最优先修复的 Top 10 问题

1. **[Critical]** `routes/publish.ts` 等核心路由无测试 - 业务核心无保障
2. **[Critical]** `publish-utils.test.ts` 100% mock 断言 - 测试无实际价值
3. **[Critical]** `alerter.test.ts` 83% mock 断言 - 测试验证实现而非行为
4. **[Critical]** `routes.test.ts` 巨型文件（5 个模块混合）- 难以维护
5. **[Critical]** `db.test.ts` 巨型文件（10+ 领域混合）- 难以维护
6. **[Critical]** 全部 10 个 Repository 无独立测试 - 数据层风险高
7. **[Critical]** Harvester 远程浏览器 / RPA / 发布流程无单元测试
8. **[Critical]** 凭证脱敏测试断言实现细节 - 重构时测试会误报
9. **[Critical]** `captcha-classifier.test.mjs` 等 7 个文件无断言消息 - 调试困难
10. **[Critical]** `session-api.test.mjs` 依赖全局隐藏 mock 状态 - 测试不透明
