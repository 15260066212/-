# ADR-010: 日志规范（分级输出 + Publisher 持久化 + 模块前缀约定）

**Type:** ADR
**Status:** accepted
**Tags:** architecture, logging, observability

## Context

GEO 系统在开发过程中，日志输出经历了从随意 `console.log` 到逐步规范化的过程。当前现状如下：

- **日志方式分散**：大部分模块直接使用 `console.log/error/warn`，格式不统一，部分有前缀（`[Publisher]`、`[CacheCleanup]`、`[PlanScheduler]`），部分无前缀；
- **Publisher 有独立日志机制**：`Publisher.log()` 方法优先通过 `logCallback` 将日志持久化到 `publish_logs` 表，降级到 `console.log`，但仅限于 Publisher 内部使用；
- **HTTP 访问日志**：通过 Hono 框架内置 `logger()` 中间件统一记录，覆盖 HTTP 请求层；
- **缺少结构化日志**：日志为纯文本，无 JSON 格式化，不利于后续引入日志收集系统（如 ELK、Loki）；
- **无日志级别控制**：所有日志都输出到 stdout/stderr，无法按环境动态调整级别。

直接引入 winston 或 pino 等成熟日志框架会增加依赖和配置复杂度，且当前单实例部署下收益有限。

## Decision

采用**分级输出 + Publisher 持久化 + 模块前缀约定**的日志方案，在不引入外部依赖的前提下统一日志格式和级别。

### 1. 日志级别定义

| 级别 | 方法 | 使用场景 | 输出流 |
|------|------|----------|--------|
| `ERROR` | `console.error` | 不可恢复错误、系统异常、需人工介入 | stderr |
| `WARN` | `console.warn` | 可恢复异常、降级行为、即将达到限制 | stderr |
| `INFO` | `console.log` | 正常流程标记、启动/关闭、任务状态变更 | stdout |
| `DEBUG` | `console.debug` | 调试信息、中间状态、详细流程 | stdout（默认关闭） |

**环境控制**（规划中）：
- 生产环境：`INFO` 及以上（默认）
- 开发环境：`DEBUG` 及以上
- 通过 `LOG_LEVEL` 环境变量控制（尚未实现，标记为技术债务）

### 2. 模块前缀约定

所有 `console.*` 输出必须使用 `[ModuleName]` 前缀，便于日志检索和过滤：

| 前缀 | 模块 | 示例 |
|------|------|------|
| `[Server]` | 服务入口（启动/关闭/信号处理） | `[Server] Received SIGTERM, shutting down gracefully...` |
| `[PublishScheduler]` | 发布调度器 | `[PublishScheduler] Dispatching task task_001 to zhihu` |
| `[CacheCleanup]` | 缓存清理调度器 | `[CacheCleanup] 5 entries removed, 42 remaining (hit rate: 87.3%)` |
| `[CookieWarmer]` | Cookie 保温调度器 | `[CookieWarmer] Warmed 8 cookies, 2 failed` |
| `[HealthChecker]` | 会话健康检查器 | `[HealthChecker] zhihu session expired, alerting` |
| `[PlanScheduler]` | 计划任务调度器 | `[PlanScheduler] Executing plan plan_001` |
| `[Publisher]` | 发布门面层 | `[Publisher] [INFO] Publishing article_001 to zhihu (attempt 1/4)` |
| `[RPAEngine]` | RPA 执行引擎 | `[RPAEngine] Handler for csdn completed: verified` |
| `[Auth]` | 认证中间件 | `[Auth] API key validated for user_default` |
| `[Cache]` | LRU 缓存 | `[Cache] Evicted key article:old_001 (LRU)` |

**格式规范**：
```
[模块名] [可选级别] 消息内容 [可选元数据JSON]
```

示例：
```
[Publisher] [INFO] Publishing article_001 to zhihu (attempt 1/4) {"taskId":"task_001"}
[Publisher] [WARN] Retry 2/4 for article_001 on baijia (rate_limit, 30s delay)
[Publisher] [ERROR] Publish failed for article_001 on sohu: auth failed
```

### 3. Publisher 持久化日志

`Publisher.log()` 是系统中唯一的**结构化持久化日志**机制：

**调用链**：
```
Publisher.log(level, message, metadata?)
  → logCallback?(level, message, metadata)    // 已配置时
    → db.publishLogs.insertLog(taskId, level, message, metadata)
  OR
  → console.log(`[Publisher] [${level}] ${message}`, metadata ?? '')  // 降级
```

**持久化字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 日志 ID（`log_` 前缀） |
| `taskId` | string | 关联的发布任务 ID |
| `level` | string | 日志级别（`INFO`/`WARN`/`ERROR`） |
| `message` | string | 日志消息 |
| `metadata` | string | JSON 格式的元数据 |
| `createdAt` | number | 创建时间戳 |

**注入方式**：`service-container.ts` 在创建 `Publisher` 实例时注入 `logCallback`，将日志写入数据库的 `publish_logs` 表。

**适用范围**：仅 Publisher 内部使用。其他模块的日志仍走 `console.*`，不持久化。

### 4. HTTP 请求日志

通过 Hono 框架内置 `logger()` 中间件统一记录：

```typescript
app.use('*', logger());  // service-container.ts
```

输出格式（Hono 默认）：
```
GET /api/articles?sessionId=xxx - 200 - 12ms
```

覆盖所有 HTTP 请求，包括成功和失败的请求。

### 5. 调度器日志约定

调度器作为系统核心运行时，其日志遵循**关键节点记录**原则：

- **启动/停止**：记录调度器生命周期事件（`Started` / `Stopped` / `Already running`）；
- **任务分发**：记录分发决策（`Dispatching task X to Y` / `Skipping X (cooldown: 120s remaining)`）；
- **批次结果**：记录每轮轮询的汇总结果（`Processed 5 tasks: 3 success, 2 failed`）；
- **异常情况**：记录恢复行为（`Recovered 2 stale tasks` / `Task X timed out`）；
- **不记录**：单次轮询的详细中间状态（避免日志量过大）。

### 6. 当前日志覆盖范围

| 模块 | 日志方式 | 持久化 | 格式统一 |
|------|----------|--------|----------|
| Publisher | `Publisher.log()` | ✅ → `publish_logs` 表 | ✅ |
| HTTP 请求 | Hono `logger()` 中间件 | ❌ | ✅ |
| 发布调度器 | `console.log/warn` | ❌ | ✅ 有前缀 |
| 缓存清理 | `console.log/warn` | ❌ | ✅ 有前缀 |
| Cookie 保温 | `console.log/warn` | ❌ | ✅ 有前缀 |
| 健康检查 | `console.log/warn/error` | ❌ | ✅ 有前缀 |
| 计划调度器 | `console.log/warn` | ❌ | ✅ 有前缀 |
| RPA Handlers | `console.log/warn` | ❌ | ⚠️ 部分有前缀 |
| 认证中间件 | `console.error` | ❌ | ❌ 无前缀 |

## Alternatives Considered

### 替代方案 1：引入 pino 日志框架

**描述**：使用 pino 作为统一日志框架，提供结构化 JSON 日志、级别控制、子日志器等功能。

**否决理由**：
- 当前单实例部署，日志量可控，`console.*` + 前缀约定已满足需求；
- pino 的 JSON 格式日志对开发环境阅读不友好（需配合 pino-pretty）；
- 引入外部依赖增加构建体积和配置复杂度。

**保留可能性**：SaaS 化或多节点部署时引入，配合日志收集系统。

### 替代方案 2：自建统一 Logger 模块

**描述**：创建 `src/utils/logger.ts`，封装 `console.*`，统一前缀、级别控制、可选持久化。

**否决理由**：
- 需要全局替换现有 `console.*` 调用，改动面大；
- 当前前缀约定已足够区分模块，级别控制可后续增量添加；
- 优先级低于功能开发和测试补充。

**保留可能性**：作为下一阶段技术债务处理，优先统一 RPA Handlers 和 Auth 模块的日志格式。

### 替代方案 3：全量持久化日志（所有模块写入数据库）

**描述**：扩展 `Publisher.log()` 模式到所有模块，统一持久化到数据库。

**否决理由**：
- 调度器和健康检查的日志频率高，全量持久化会产生大量数据库写入；
- SQLite 不适合高频写入场景，可能影响读性能；
- 大部分日志的价值在于实时排查，离线分析需求可由 stdout 重定向文件满足。

## Consequences

### 正面影响

1. **零外部依赖**：纯 `console.*` + 约定，无需引入日志框架；
2. **模块前缀可检索**：统一的 `[ModuleName]` 前缀便于 `grep` 或日志系统过滤；
3. **Publisher 日志可查询**：发布流程的日志持久化到数据库，支持按任务、级别、时间范围查询；
4. **降级机制健壮**：`Publisher.log()` 在 `logCallback` 未配置时自动降级到 `console.log`，开发环境零配置可用。

### 负面影响

1. **格式不够结构化**：纯文本日志不利于自动化解析，需要正则匹配前缀；
2. **无统一级别控制**：无法按环境动态调整日志级别（全部输出）；
3. **非 Publisher 模块无持久化**：调度器、健康检查等模块的日志不持久化，重启后丢失；
4. **RPA Handler 日志不统一**：部分 RPA Handler 使用 `console.*` 但无统一前缀，日志检索困难；
5. **无日志轮转**：stdout 输出依赖进程管理器（如 PM2、Docker）处理日志轮转。

### 需要跟进的事项

- [ ] 创建统一 `Logger` 工具类，封装前缀 + 级别控制（低优先级）
- [ ] 统一 RPA Handler 和 Auth 模块的日志前缀
- [ ] 实现 `LOG_LEVEL` 环境变量控制
- [ ] 增加调度器关键日志的结构化 JSON 输出选项
- [ ] 评估是否需要将调度器日志持久化（当前仅 Publisher 持久化）

## Superseded when

当出现以下任一情况时，本决策应被重新评估：

1. 部署为多节点集群，需要集中式日志收集（ELK / Loki / Grafana）；
2. 日志量超过 stdout 承受能力，需要异步写入和日志轮转；
3. 需要按级别动态过滤日志输出（如生产环境关闭 DEBUG）；
4. 引入 pino / winston 等日志框架的成本收益比发生逆转。
