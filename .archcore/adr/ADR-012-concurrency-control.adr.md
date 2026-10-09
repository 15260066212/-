# ADR-012: 并发控制策略（全局上限 + 单账号串行 + 动态冷却）

**Type:** ADR
**Status:** accepted
**Tags:** architecture, concurrency, scheduling, rate-control

## Context

GEO 系统的发布调度器需要同时管理多个平台、多个账号的发布任务。如果不做并发控制，会出现以下问题：

- **平台风控触发**：同一账号短时间内连续发布会触发平台频率限制（429）甚至封号；
- **资源耗尽**：RPA 模式下每个发布任务占用一个浏览器上下文，无限制并发会导致内存爆炸；
- **账号隔离不足**：同一账号的多个任务可能同时执行，导致 Session 状态冲突；
- **冷却需求差异**：不同故障类型需要不同的冷却时间（网络错误快速重试，频率限制需长冷却）。

## Decision

采用 `PublishConcurrencyController` 统一管理**三层并发约束**：全局并发上限、单账号串行、动态冷却。

### 1. 三层并发约束

| 约束层 | 控制对象 | 数据结构 | 默认值 |
|--------|----------|----------|--------|
| **全局并发上限** | 系统总活跃任务数 | `activeCount: number` | 5 |
| **单账号串行** | 同一账号同一平台 | `publishingAccounts: Set<string>` | 1（串行） |
| **动态冷却** | 账号发布间隔 | `accountCooldowns: Map<string, number>` | 依故障类型 30s~5min |

**账号键格式**：`platform:accountId`，确保同一账号在同一平台内串行，不同平台可并行。

### 2. 调度检查流程

调度器在分发每个任务前调用 `checkDispatch(task, now)`：

```
checkDispatch(task, now):
  accountKey = task.platform + ':' + task.accountId

  1. 全局并发检查
     if activeCount >= MAX_CONCURRENT
       return { skipReason: 'concurrency' }

  2. 单账号串行检查
     if publishingAccounts.has(accountKey)
       return { skipReason: 'in_progress' }

  3. 冷却期检查
     cooldownUntil = accountCooldowns.get(accountKey)
     if cooldownUntil && now < cooldownUntil
       return { skipReason: 'cooldown', cooldownRemaining }

  4. 全部通过
     return null  // 可派发
```

### 3. 任务生命周期管理

| 事件 | 方法 | 操作 |
|------|------|------|
| 任务开始 | `startDispatch(accountKey)` | 加入 `publishingAccounts`，`activeCount++` |
| 任务结束 | `finishDispatch(accountKey, cooldownMs, now)` | 移出 `publishingAccounts`，`activeCount--`，设置冷却截止时间 |

### 4. 动态冷却档位

冷却时间由 `calculateDynamicCooldown()` 根据发布结果动态计算（详见 ADR-006）：

| 发布结果 | 冷却档位 | 冷却时间 |
|----------|---------|----------|
| 发布成功 | `MIN_COOLDOWN` | 30s |
| 默认/未知失败 | `DEFAULT_COOLDOWN` | 60s |
| 频率限制（429） | `RATE_LIMIT_COOLDOWN` | 3min |
| 验证码/平台异常 | `CAPTCHA_COOLDOWN` | 5min |

冷却时间在 `finishDispatch()` 时写入 `accountCooldowns`，调度器在后续 `checkDispatch()` 中检查是否已过冷却期。

### 5. 设计特点

- **集中管理**：三层约束封装在同一个控制器中，调度器无需自行维护并发状态；
- **无锁设计**：基于 `Set` 和 `Map` 的同步操作，JavaScript 单线程模型下无需加锁；
- **可观测性**：`getStatus()` 方法暴露当前活跃数、正在发布的账号列表和冷却中的账号列表；
- **可配置**：`MAX_CONCURRENT` 通过构造函数参数传入，支持环境变量覆盖。

## Alternatives Considered

### 替代方案 1：固定冷却 + 无并发限制

**描述**：所有任务固定间隔 60s 发布，不做并发上限。

**否决理由**：无法利用并发加速发布；固定冷却对成功任务过保守，对频率限制过激进。

### 替代方案 2：令牌桶限流

**描述**：使用令牌桶算法控制发布速率。

**否决理由**：令牌桶控制的是全局速率，无法实现单账号串行；RPA 场景的并发约束是资源限制（浏览器上下文）而非纯速率限制。

### 替代方案 3：队列 + Worker 池

**描述**：使用消息队列（如 Bull）+ Worker 池管理并发。

**否决理由**：引入 Redis 依赖增加部署复杂度；当前单实例 + setInterval 调度足够，队列适用于多节点部署。

## Consequences

### 正面影响

1. **风控友好**：单账号串行 + 动态冷却有效避免触发平台风控；
2. **资源可控**：全局并发上限 5 防止浏览器上下文爆炸；
3. **自适应**：冷却时间根据故障类型动态调整，成功快发、失败慢发；
4. **简单可靠**：无锁设计，单线程模型下天然线程安全。

### 负面影响

1. **全局上限可能成为瓶颈**：5 个并发在大规模任务时吞吐受限；
2. **单账号串行可能过保守**：部分平台允许多并发，但当前策略一刀切；
3. **无优先级调度**：所有任务 FIFO，无法插队。

### 需要跟进的事项

- [ ] 支持按平台配置不同的并发上限
- [ ] 增加任务优先级支持
- [ ] 动态调整全局上限（根据系统负载）

## Superseded when

1. 部署为多节点集群，需要分布式并发控制；
2. 引入消息队列管理任务调度；
3. 任务规模超过单实例并发能力上限。
