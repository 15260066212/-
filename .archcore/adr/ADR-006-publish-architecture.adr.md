# ADR-006: 发布系统分层架构（Publisher + RPAEngine + 双模式 + 调度与健康监控）

**Type:** ADR
**Status:** accepted
**Tags:** architecture, publishing, rpa, scheduler

## Context

GEO 系统需要将审核通过的文章自动发布到 10 个内容平台（微信公众号、知乎、百家号、今日头条、CSDN、掘金、哔哩哔哩、搜狐号、网易号、百度知道）。各平台开放程度差异巨大：

- **微信公众号**提供官方 API，可直接调用接口发布；
- **其余 9 个平台**无可用的开放发布 API，必须通过浏览器自动化（RPA）模拟人工操作完成发布；
- 不同平台的页面结构、登录态有效期、风控策略、验证码机制差异显著，统一抽象难度高；
- 发布任务需支持定时调度、失败重试、并发控制、账号级隔离，以避免触发平台风控；
- 账号登录态（Cookie/Session）会随时间失效，需持续监控健康状态并及时告警，必要时触发自动重登。

直接在业务代码中嵌入平台特定的发布逻辑将导致严重的耦合和维护灾难，因此需要一套分层清晰、可扩展、可观测的发布架构。

## Decision

采用**分层发布架构**，以 `Publisher` 为核心门面，向下分为 API 适配器层与 RPA 引擎层，配合调度层、并发控制层、重试策略层和会话健康监控层，形成完整的发布运行时体系。

### 1. 发布架构分层

整个发布系统分为 6 层，自上而下依次为：

| 层级 | 职责 | 核心模块 | 所在位置 |
|------|------|----------|----------|
| **调度层** | 任务轮询、定时触发、故障恢复 | `PublishScheduler` | `apps/server/src/scheduler/publish-scheduler.ts` |
| **门面层** | 统一发布入口、方法路由、重试编排 | `Publisher` | `packages/publisher/src/publisher.ts` |
| **API 适配器层** | 官方 API 发布（微信公众号） | `PlatformAdapter` / `WechatAdapter` | `packages/publisher/src/adapters/` |
| **RPA 引擎层** | 浏览器自动化发布、会话管理、远程执行 | `RPAEngine` | `packages/publisher/src/rpa-engine.ts` |
| **RPA 处理器层** | 各平台 DOM 操作与发布流程 | `RpaHandler` 子类（9 个） | `packages/publisher/src/rpa-handlers/` |
| **健康监控层** | 账号登录态巡检、告警、自动重登 | `SessionHealthChecker` / `HealthAlerter` | `apps/server/src/session-health/` |

各层之间通过清晰的接口解耦：
- `Publisher` 不感知具体平台实现，仅通过 `PlatformAdapter` 和 `RpaHandler` 抽象分发；
- `RPAEngine` 是纯执行引擎，不关心支持哪些平台，handler 由上层 `Publisher` 注册；
- 调度层仅依赖 `Publisher` 门面和数据库仓储，不直接接触 Playwright 或平台 API。

### 2. 双模式发布（API / RPA）

平台按发布方式分为两类，由 `Publisher.getMethodForPlatform()` 统一判定：

**API 模式** — 适用于有官方发布接口的平台（当前：微信公众号）：
- 基于 `PlatformAdapter` 抽象类，子类实现 `publish()` 方法调用平台 API；
- 发布结果直接由 API 响应确认，验证状态为 `api_confirmed`；
- 认证方式通常为 `access_token` 或 `api_key`，由 `PlatformCredentials` 统一承载。

**RPA 模式** — 适用于无官方 API 的平台（当前：知乎、百家号、今日头条、CSDN、掘金、哔哩哔哩、搜狐号、网易号、百度知道）：
- 基于 Playwright 浏览器自动化，由 `RpaHandler` 子类封装各平台的编辑页导航、内容填充、提交操作；
- 支持 **SessionPool 集成**：持久化浏览器会话 + 指纹隔离，避免重复登录和账号关联；
- 支持 **远程执行模式**（`RPA_REMOTE_URL`）：将 RPA 发布委托给独立的 harvester 服务，适用于 Docker 部署场景；
- 支持 **LLMWiki 兜底**：主 handler 失败时自动尝试 LLMWiki 通用发布流水线作为降级方案；
- 发布后自动访问文章 URL 进行 **发布验证**，检查 404、内容删除等错误指示符。

### 3. 任务状态流转

发布任务（`PublishTask`）的生命周期由 SQLite 持久化，状态流转如下：

```
pending ──► publishing ──► published
   │           │             │
   │           │             └── verification: verified / unverified / failed
   │           │
   │           └── 失败 ──► retrying ──► publishing (重试)
   │                              │
   │                              └── 重试耗尽 ──► failed
   │
   └── 定时任务: scheduledAt 到达后由调度器拾取
```

状态说明：
- **pending**：任务已创建，等待调度或定时时间到达；
- **publishing**：正在执行发布中（调度器标记，防止重复执行）；
- **retrying**：首发布失败，等待下一次重试（仍在调度队列中）；
- **published**：发布成功，包含 `platformPostId`、`platformPostUrl` 和验证状态；
- **failed**：发布失败（含重试耗尽），记录 `errorMessage` 和 `failureType`。

**故障恢复机制**：服务重启时，`recoverStaleTasks()` 将超过 5 分钟仍处于 `publishing` 状态的任务标记为 `failed`，将 `retrying` 状态的任务重置为 `pending`，确保无任务因进程崩溃而永久悬挂。

### 4. 重试策略

采用**故障分类感知的智能重试**机制，由 `classifyFailure()` 根据错误消息自动分类：

| 故障类型 | 类别 | 可重试 | 基础延迟 | 判定关键词 |
|----------|------|--------|----------|------------|
| `network` | 网络错误 | 是 | 5s | timeout、network、fetch failed、connection reset |
| `rate_limit` | 频率限制 | 是 | 30s | rate、frequency、429、频繁、throttl |
| `platform` | 平台异常 | 是 | 10s | element、selector、captcha、验证码、404 |
| `auth` | 认证失败 | 否 | 0 | auth、unauthorized、401、cookie、登录 |
| `content` | 内容违规 | 否 | 0 | violation、forbidden、403、违规、敏感 |
| `unknown` | 未知错误 | 是 | 3s | （兜底） |

**重试特点**：
- 延迟随尝试次数线性递增（`retryDelayMs * attempt`），避免瞬时冲击；
- 认证失败和内容违规**立即终止重试**，避免无意义消耗；
- 默认最大重试 2 次（共 3 次尝试），可按任务配置 `maxRetries`；
- 每次重试前更新任务状态为 `retrying`，并记录失败分类到日志。

### 5. 并发控制

由 `PublishConcurrencyController` 统一管理三层并发约束：

1. **全局并发上限**：默认最多 5 个发布任务同时执行，防止系统资源耗尽；
2. **单账号串行**：同一平台同一账号同时只能有一个发布任务，避免账号级风控；
3. **账号冷却期**：每次发布完成后，该账号进入冷却期，冷却时长动态计算。

**动态冷却策略**（基于平台近期发布健康度）：

| 平台健康状况 | 冷却时长 | 判定依据 |
|-------------|----------|----------|
| 高成功率（≥80%） | 30s | 健康平台，快速通道 |
| 中成功率（50-80%） | 60s | 默认水平 |
| 低成功率（<50%） | 120s | 谨慎发布 |
| 触发频率限制 | 180s | 错误信息含 rate / 429 |
| 检测到验证码 | 300s | 有待处理的验证码事件 |

调度器每 30 秒轮询一次任务队列，按优先级 + 创建时间排序，依次检查并发约束后派发任务。

### 6. 健康监控（Session Health）

会话健康监控子系统独立于发布流程运行，负责持续检测各平台账号的登录态有效性。

**核心机制**：
- **周期巡检**：每 10 分钟执行一批健康检查（每批最多 3 个账号），每个账号默认每 6 小时检查一次；
- **平台验证器**：每个平台有独立的 `BaseValidator` 实现，通过访问平台后台页面、检查登录态标识来判断 Cookie 是否有效；
- **状态等级**：`valid` → `checking` → `error` → `expired`（连续 3 次失败后升级为过期）；
- **告警通知**：首次失败、过期、恢复时均通过 `HealthAlerter` 发送企业微信机器人 / Webhook 告警；
- **自动重登**：检测到会话过期后，对支持的平台触发 `ReloginManager` 自动重登流程，减少人工干预；
- **恢复告警**：账号从 `expired` 恢复为 `valid` 时发送恢复通知，形成完整闭环。

## Consequences

- **清晰的职责边界**：API 适配器与 RPA 处理器完全分离，新增平台只需添加一个 handler/adapter，不影响现有代码；
- **高可靠性**：故障分类重试 + 动态冷却 + 验证码检测 + 会话健康监控形成多层次防护，最大限度提升发布成功率；
- **可观测性**：所有发布操作均有结构化日志（`publish_logs` 表），任务状态、失败分类、验证结果均可查询和统计；
- **部署灵活**：RPA 引擎支持本地 Playwright 和远程 harvester 两种模式，适配裸机与 Docker 部署；
- **故障自愈**：服务重启自动恢复悬挂任务，会话过期触发自动重登，减少人工运维成本；
- **当前局限**：
  - RPA 模式依赖平台页面 DOM 结构，平台改版可能导致发布失败，需要持续维护 selector；
  - SQLite 单写者限制在极高并发发布场景下可能成为瓶颈（当前规模下无压力）；
  - 自动重登能力目前仅覆盖部分平台，其余平台仍需人工处理验证码和登录。

## Alternatives Considered

1. **纯 API 模式（接入所有平台开放接口）** — 不可行，因为多数内容平台（知乎、百家号、头条等）不提供面向第三方的发布 API，或申请门槛极高、审核严格，不适合自动化多账号发布场景。

2. **统一 RPA 模式（所有平台均走浏览器自动化）** — 被否决，因为微信公众号有成熟稳定的官方 API，API 模式比 RPA 更可靠、更快、不受页面结构变化影响，应优先使用官方通道。

3. **第三方发布中间件（如易媒助手、蚁小二）** — 被否决，因为数据安全和账号控制权要求高，第三方 SaaS 存在数据泄露风险，且无法深度定制发布流程和与 GEO 内容审核流水线集成。

4. **基于消息队列（BullMQ / Agenda）的任务调度** — 被否决，因为当前任务量级（< 1000 用户、每日发布量 < 500 篇）下，SQLite + 轮询调度的方案已足够可靠，且零外部依赖、部署简单。引入消息队列会增加系统复杂度和运维成本。

5. **固定间隔重试（指数退避）** — 被否决，因为不同类型的故障恢复时间差异巨大（网络抖动几秒即可恢复，频率限制需等待数分钟，认证失败重试无意义）。故障分类感知的重试策略更精准，避免无效重试和触发更严的风控。

## Superseded when

- 每日发布任务量超过 5000 篇，SQLite 单写者或 5 并发上限成为性能瓶颈；
- 需要支持 20 个以上平台，RPA handler 维护成本显著上升，需考虑更通用的 AI 驱动发布方案；
- 多实例部署需要共享任务队列和分布式锁，本地轮询调度不再适用；
- 所有主流平台均提供官方发布 API，RPA 模式可全面退出。
