# ADR-018: 计划任务调度（setInterval 轮询 + 状态机 + 到期执行）

**Type:** ADR
**Status:** accepted
**Tags:** architecture, scheduler, plan-tasks, cron

## Context

GEO 系统除了发布任务调度外，还需要支持用户创建的**计划任务**（如定时发布一批文章、定时执行内容优化等）。核心需求：

- **定时执行**：用户指定日期执行任务，不是 cron 表达式，而是具体日期时间；
- **状态管理**：任务有 pending → running → completed/failed 的状态流转；
- **失败处理**：执行失败需记录错误信息，不影响其他任务；
- **简单可靠**：当前单实例部署，不需要分布式任务队列；
- **与发布调度解耦**：计划任务调度与发布任务调度是两个独立系统。

## Decision

采用 `setInterval` 轮询 + 状态机的计划任务调度方案。

### 1. 调度架构

| 组件 | 职责 | 代码位置 |
|------|------|----------|
| `PlanScheduler` | 轮询到期任务、执行、状态管理 | `scheduler/plan-scheduler.ts` |
| `ScheduledPlanTasks` 表 | 持久化任务和状态 | SQLite |
| `executePlanTask()` | 具体任务执行逻辑 | 由 server 注入 |

### 2. 调度参数

| 参数 | 值 | 说明 |
|------|-----|------|
| 检查间隔 | 1 小时 | 每 1 小时轮询一次到期任务 |
| 首次延迟 | 30 秒 | 启动后 30 秒开始首次检查 |
| 轮询方式 | `setInterval` | 固定间隔，非 cron 表达式 |

### 3. 任务状态机

```
pending ──(到执行日期)──→ running ──(执行成功)──→ completed
                             │
                             └──(执行失败)──→ failed
```

| 状态 | 含义 | 触发条件 |
|------|------|----------|
| `pending` | 等待执行 | 任务创建时 |
| `running` | 执行中 | 调度器开始执行任务时 |
| `completed` | 执行完成 | 执行成功 |
| `failed` | 执行失败 | 执行异常 |

### 4. 轮询与执行流程

```
tick():
  tasks = db.plans.getDueScheduledTasks()  // 查询 status=pending 且 scheduled_date <= now

  for task in tasks:
    db.plans.updateTaskStatus(task.id, 'running')   // 标记为执行中
    db.plans.recordExecution(task.id, now)             // 记录执行时间

    try:
      await executeTaskFn(task)                       // 执行任务
      db.plans.updateTaskStatus(task.id, 'completed')
    catch (err):
      db.plans.updateTaskStatus(task.id, 'failed')
      db.plans.recordError(task.id, err.message)
```

- **顺序执行**：到期任务逐个执行，不并发；
- **错误隔离**：单个任务失败不影响后续任务；
- **状态持久化**：每次状态变更都写入 DB，重启后不会重复执行。

### 5. 任务查询

`getDueScheduledTasks()` 查询条件：

```sql
SELECT * FROM scheduled_plan_tasks
WHERE status = 'pending'
  AND scheduled_date <= date('now')
ORDER BY scheduled_date ASC
```

- 只查询 `pending` 状态（已完成或失败的不重复执行）；
- 按 `scheduled_date` 升序排列（先到期的先执行）。

### 6. 与发布调度的关系

| 特性 | 发布调度器（PublishScheduler） | 计划调度器（PlanScheduler） |
|------|------|------|
| 调度对象 | 发布任务（publish_tasks） | 计划任务（scheduled_plan_tasks） |
| 轮询间隔 | 30 秒 | 1 小时 |
| 并发 | 5 个并发 | 顺序执行 |
| 失败重试 | 自动重试 + 冷却 | 不自动重试 |
| 触发方式 | 到调度时间自动触发 | 到指定日期触发 |

两者完全独立运行，互不干扰。

## Alternatives Considered

### 替代方案 1：Cron 表达式

**描述**：使用标准 cron 表达式定义计划任务。

**否决理由**：用户需求是"指定日期执行"，不是周期性重复；cron 表达式对非技术用户不友好；当前只需"到日期执行"，不需要 cron 的复杂调度能力。

### 替代方案 2：消息队列延迟任务

**描述**：使用 Redis 或 RabbitMQ 的延迟队列实现定时任务。

**否决理由**：引入外部依赖增加部署复杂度；单实例部署下 `setInterval` 轮询足够可靠；任务量不大（日均 < 100）。

### 替代方案 3：node-cron 库

**描述**：使用 node-cron 库替代 `setInterval`。

**否决理由**：node-cron 适合周期性任务，本场景是一次性定时任务；`setInterval` 简单直接，无需额外依赖。

## Consequences

### 正面影响

1. **零依赖**：纯 `setInterval` 实现，无外部库；
2. **简单可靠**：状态机清晰，失败隔离，重启安全；
3. **持久化**：任务状态写入 DB，进程重启不丢失；
4. **解耦**：与发布调度器完全独立。

### 负面影响

1. **无并发**：顺序执行，大量到期任务时可能排队延迟；
2. **无重试**：失败后不自动重试，需人工处理；
3. **精度有限**：1 小时轮询间隔，最大延迟 1 小时；
4. **无优先级**：按日期排序，无法插队。

### 需要跟进的事项

- [ ] 支持任务优先级
- [ ] 失败任务重试机制
- [ ] 缩短轮询间隔或支持精确时间触发
- [ ] 任务执行超时控制

## Superseded when

1. 需要周期性任务（cron 表达式）；
2. 任务量大需要并发执行；
3. 多节点部署需要分布式任务调度；
4. 需要精确到分钟的定时触发。
