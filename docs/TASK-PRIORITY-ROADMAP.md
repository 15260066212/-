# GEO 系统任务优先级路线图

> 最后更新: 2026-08-25
> 状态: 活跃

---

## 优先级定义

| 级别 | 含义 | SLA |
|------|------|-----|
| **P0** | 紧急/阻塞 — 系统无法运行或核心功能不可用 | 立即处理 |
| **P1** | 高优先级 — 影响关键功能或用户体验 | 1-2 天内 |
| **P2** | 中优先级 — 改进型任务，已有 workaround | 本周内 |
| **P3** | 低优先级 — 优化型任务，不影响核心流程 | 按计划推进 |

---

## P0 — 紧急/阻塞

### P0-1: GEO 系统启动与运行验证 ✅ 已验证
- **描述**: 确保 GEO 系统完整启动，后端 API 服务和前端界面均可正常访问，核心流程（对话→抓取→分析→生成→审核→发布）端到端可用
- **状态**: 已验证通过 (2026-08-25 重新验证)
- **验证结果**:
  - ✅ 后端 API 服务器启动成功 (`http://localhost:3000`)，数据库迁移已应用 (v1, v2, v3, v4)，AI 引擎已启用
  - ✅ 前端界面可访问 (`http://localhost:5174`)，HTTP 200，HTML 包含 title 和 root div
  - ✅ 健康检查通过 (`GET /api/health` → `{ status: ok, aiEnabled: true, database: { healthy: true, tables: { sessions: 16, articles: 132, reviews: 126, ... } } }`)
  - ✅ 会话创建成功 (`POST /api/session` → session_1787622337761_5ck1e6，7 阶段对话初始化完成)
  - ✅ 凭据管理正常 (`GET /api/credentials` → 2 个活跃凭据：知乎 cookie + 微信 API key）
  - ✅ 监控概览正常 (`GET /api/monitor/overview` → 132 篇文章、16 个会话、1 个流水线运行、2 个凭据)
  - ✅ 调度器已启动（30s 轮询发布任务，5 分钟缓存清理）
  - ✅ 数据库 (SQLite) 持久化正常，9 张表均存在，WAL 文件 4.1MB
  - ✅ 缓存层运行正常（LRU 缓存已启用，命中率统计正常）
- **关联文件**: `apps/server/src/index.ts`, `apps/web/src/main.tsx`
- **验证时间**: 2026-08-25 (Beijing time)

---

## P1 — 高优先级

### P1-1: RPA 平台覆盖完善 ✅ 已完成
- **描述**: 所有 11 个发布平台（1 API + 10 RPA）均已实现完整发布适配器
- **状态**: 已完成 (2026-08-12)
- **完成内容**:
  - ✅ 微信公众号 — API 方式（draft/add → submit → status check）
  - ✅ 知乎 — RPA（Playwright + Cookie 注入 + 编辑器自动化）
  - ✅ 百家号 — RPA（ProseMirror/Quill 编辑器 + 标签 + 发布确认）
  - ✅ 头条号 — RPA（ProseMirror 编辑器 + 发布流程）
  - ✅ 小红书 — RPA（Quill 编辑器 + 话题标签 + 图文发布）
  - ✅ CSDN — RPA（CodeMirror/Markdown 编辑器 + 标签）
  - ✅ 掘金 — RPA（编辑器自动化 + 标签）
  - ✅ B站 — RPA（Quill 编辑器 + 分类选择 + 标签）
  - ✅ 搜狐号 — RPA（editor-content + ProseMirror 回退）
  - ✅ 网易号 — RPA（editor-content + 多编辑器回退）
  - ✅ 百度知道 — RPA（编辑器自动化）
- **新增测试**: 39 个测试用例验证所有 handler 存在、platform 属性正确、RPAEngine 注册完整
- **关联文件**: `packages/publisher/src/rpa-handlers/*.ts`, `packages/publisher/src/rpa-handlers/all-handlers.test.ts`

### P1-2: 定时发布功能 ✅ 已完成
- **描述**: 完善调度器，支持配置发布时间自动触发流水线
- **状态**: 已完成 (2026-08-12)
- **完成内容**:
  - ✅ 调度器每 30s 轮询 pending 任务，scheduledAt 到达自动触发
  - ✅ 原子性状态转换（pending → publishing → published/failed），防止重复执行
  - ✅ 优雅关闭（SIGTERM/SIGINT 信号处理：清除调度器 → 关闭浏览器 → 关闭数据库）
  - ✅ Stale task 恢复（启动时将 publishing >5min 的任务标记为 failed，retrying 的重置为 pending）
  - ✅ 定时任务管理 API（`GET /api/publish/scheduled` 列表，`DELETE /api/publish/:taskId` 取消）
  - ✅ 详细日志（每次轮询记录队列任务数、due 任务数、已处理任务数）
- **关联文件**: `apps/server/src/scheduler.ts`, `apps/server/src/index.ts`, `apps/server/src/routes/publish.ts`

### P1-3: 发布结果验证 ✅ 已完成
- **描述**: 为所有 11 个平台实现发布后自动验证
- **状态**: 已完成 (2026-08-12)
- **完成内容**:
  - ✅ RPA 平台（10 个）：RPAEngine 在发布成功后自动导航到 postUrl 验证页面可达性，检查错误标识
  - ✅ 微信 API：新增 `verifyPublication()` 方法，调用 `freepublish/getarticle` API 验证文章可读性
  - ✅ 独立验证端点 `POST /api/publish/:taskId/verify`：手动触发验证，API 平台调用适配器验证，RPA 平台用 fetch 检查 URL 可达性
  - ✅ 验证结果持久化到 publish_tasks 表（verificationStatus + verificationMessage）
- **关联文件**: `packages/publisher/src/rpa-engine.ts`, `packages/publisher/src/adapters/wechat.ts`, `packages/publisher/src/adapters/base.ts`, `apps/server/src/routes/publish.ts`

### P1-4: 数据持久化健壮性 ✅ 已完成
- **描述**: 加固 SQLite 数据库的 CRUD 可靠性
- **状态**: 已完成 (2026-08-12)
- **完成内容**:
  - ✅ 事务支持：`runInTransaction()` 方法 + `wrapTransaction()` 内部包装，publishArticleAsync 中 task+article 更新原子化
  - ✅ 级联删除：`deleteSessionCascade()` 在事务中删除 session 及关联的 articles、reviews、publish_tasks、publish_logs、pipeline_runs
  - ✅ 数据验证：insertArticle 验证 title 非空和 wordCount >= 0，insertPublishTask 验证 articleId 非空，upsertCredential 验证 platform 非空
  - ✅ 批量查询：`getArticlesByStatuses()`、`getPublishTasksByStatuses()`、`getRecentPublishLogs(limit)`
  - ✅ 数据库健康检查：`healthCheck()` 验证 8 张表存在、统计行数、检查 WAL 文件大小
  - ✅ 健康检查 API 增强：`/api/health` 返回 `database.healthy`、`database.tables`、`database.walSize`
- **关联文件**: `apps/server/src/db.ts`, `apps/server/src/index.ts`, `apps/server/src/routes/publish.ts`, `apps/server/src/session-store.ts`

---

## P2 — 中优先级

### P2-1: 测试覆盖提升 ✅ 已完成
- **描述**: 测试覆盖率从 ~10% 提升至 207 个测试（207 通过，1 跳过）
- **完成时间**: 2026-08-12 → 2026-08-13（从 130 → 178 → 207，新增 39 个 RPA handler 测试 + 9 个其他测试 + 29 个缓存测试）
- **覆盖范围**: db.test.ts, routes.test.ts, ai-engine.test.ts, publisher.test.ts, content-reviewer.test.ts, content-generator.test.ts, dialogue-engine.test.ts, scraper.test.ts, template.test.ts, all-handlers.test.ts, cache.test.ts

### P2-2: CI/CD 流水线配置 ✅ 已完成
- **描述**: 从 0% CI/CD 覆盖到完整的 GitHub Actions 并行流水线
- **完成时间**: 2026-08-03
- **配置文件**: `.github/workflows/ci.yml`
- **内容**: Lint & Type Check 和 Build & Test 两个并行 Job，含覆盖率报告

### P2-3: Prompt Builder 优化 ✅ 已完成
- **描述**: 改进内容生成器的 Prompt Builder 模块
- **完成时间**: 2026-08-03

### P2-4: 队列深度集成 ✅ 已完成
- **描述**: 将内存队列持久化到数据库，支持重启恢复
- **状态**: 已完成 (2026-08-12)
- **完成内容**:
  - ✅ 启动时 stale task 恢复（publishing >5min → failed，retrying → pending）
  - ✅ 队列状态报告 API（`GET /api/publish/queue/status` 按状态分组统计）
  - ✅ 数据库方法：`getScheduledPublishTasks()`、`getStalePublishingTasks()`、`getQueueStatus()`
  - ✅ 调度器使用数据库作为队列源，重启后状态不丢失
- **关联文件**: `apps/server/src/scheduler.ts`, `apps/server/src/routes/publish.ts`, `apps/server/src/db.ts`

---

## P3 — 低优先级

### P3-1: 运营监控仪表盘 ✅ 已完成
- **描述**: 系统缺少运营监控界面，无法可视化查看发布状态、成功率等指标
- **状态**: 已完成 (2026-08-13)
- **完成内容**:
  - ✅ 后端监控 API（`/api/monitor/overview`）：文章统计、发布任务统计、会话数、流水线统计、凭据统计、最近日志
  - ✅ 图表数据 API：`/api/monitor/charts/articles`（文章按天/平台/状态）、`/api/monitor/charts/publish`（发布时间线+成功率）、`/api/monitor/charts/reviews`（审核统计）
  - ✅ 前端监控页面 `MonitorPage.tsx`：展示关键指标和图表数据
  - ✅ 数据库新增统计方法：`getArticleStats()`、`getPublishTaskStats()`、`getPipelineRunStats()`、`getCredentialStats()`、`getArticleTimeline()`、`getPublishTimeline()` 等
- **关联文件**: `apps/server/src/routes/monitor.ts`, `apps/web/src/pages/MonitorPage.tsx`, `apps/server/src/db.ts`

### P3-2: 多用户支持 ✅ 已完成
- **描述**: 当前为单用户模式，缺少多租户/多用户隔离
- **状态**: 已完成 (2026-08-13)
- **完成内容**:
  - ✅ `users` 表（v4 迁移）：id, username, display_name, role, api_key, created_at, last_active_at
  - ✅ 默认管理员用户 `user_default`（admin 角色，API key: `geo-admin-key`）
  - ✅ 认证中间件 `createAuthMiddleware`：支持 `x-api-key` 头和 `Authorization: Bearer` 头，无 API key 时回退到默认管理员（向后兼容）
  - ✅ 用户管理 API：`POST /api/users`（创建用户）、`GET /api/users`（列表）、`GET /api/users/me`（当前用户）、`DELETE /api/users/:id`（删除）、`POST /api/users/:id/regenerate-key`（重置 API key）
  - ✅ 数据隔离：`platform_credentials` 表新增 `user_id` 列，支持按用户查询凭据和会话
- **关联文件**: `apps/server/src/middleware/auth.ts`, `apps/server/src/routes/user.ts`, `apps/server/src/db.ts`, `apps/server/src/index.ts`

### P3-3: 缓存层优化 ✅ 已完成
- **描述**: Redis 缓存为可选项，未深度集成到会话管理中
- **状态**: 已完成 (2026-08-13)
- **完成内容**:
  - ✅ `LRUCache<T>` 实现：LRU 驱逐策略 + TTL 过期 + 统计跟踪（hits/misses/evictions）+ 模式匹配失效（`invalidatePattern`）+ `wrap()` 便捷包装
  - ✅ `CachedDatabaseAccess` 包装器：缓存读操作（getArticle 60s、getArticlesBySession 30s、getPublishTask 30s、getCredential 120s、getSession 30s、healthCheck 10s、getQueueStatus 10s），写操作自动失效相关缓存
  - ✅ 会话存储使用 LRU 缓存（max 100 sessions，30min TTL，DB 持久化兜底）
  - ✅ 缓存管理 API：`GET /api/cache/stats`（统计）、`DELETE /api/cache`（清空）
  - ✅ 定时清理（每 5 分钟清理过期条目，记录命中率日志）
  - ✅ 健康检查集成缓存统计（`/api/health` 返回 `cache` 字段）
  - ✅ 29 个单元测试覆盖 LRU 驱逐、TTL 过期、并发操作、统计准确性等
- **关联文件**: `apps/server/src/cache.ts`, `apps/server/src/cached-db.ts`, `apps/server/src/session-store.ts`, `apps/server/src/scheduler.ts`, `apps/server/src/index.ts`, `apps/server/src/cache.test.ts`

---

## 变更记录

| 日期 | 变更内容 | 操作人 |
|------|----------|--------|
| 2026-08-25 | P0 系统启动重新验证通过（Node v22.16 + 后端+前端+数据库+调度器+缓存全链路正常） | 用户指示 |
| 2026-08-13 | P3-1/P3-2/P3-3 全部完成，测试 207 通过，多用户认证中间件集成，缓存层+监控仪表盘上线 | 系统执行 |
| 2026-08-12 | P1-1/P1-2/P1-3/P1-4/P2-4 全部完成，测试从 130→178 | 系统执行 |
| 2026-08-12 | P0 系统重新启动验证通过（Node v22 + better-sqlite3 修复） | 系统执行 |
| 2026-08-04 | 创建任务优先级路线图，将 GEO 系统启动设为 P0 | 用户指示 |
| 2026-08-03 | P2 任务完成（测试覆盖、CI/CD、Prompt Builder） | 自动完成 |
| 2026-07-31 | 文章发布系统实现完成（24 Task, 7 Phase） | 自动完成 |
| 2026-07-31 | 系统首次启动验证通过 | 自动完成 |
