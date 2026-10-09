# ADR-009: 错误处理规范（故障分类感知 + 分级重试 + 统一日志）

**Type:** ADR
**Status:** accepted
**Tags:** architecture, error-handling, retry, resilience

## Context

GEO 系统的发布流程涉及 10 个内容平台，每个平台的故障模式各不相同：网络超时、认证过期、频率限制、内容违规、页面结构变更、验证码拦截等。如果对所有错误一视同仁地重试，会导致：

- **认证失败无限重试**：Cookie 过期后每次重试都会失败，浪费配额并可能触发平台风控；
- **内容违规反复提交**：违规内容重试只会加重处罚，甚至导致账号被封禁；
- **频率限制退避不足**：简单固定延迟重试无法有效避开平台冷却窗口；
- **错误信息不可观测**：失败原因混杂在日志中，难以统计和分类处理。

此外，调度器层（`PublishScheduler`）和 API 路由层都需要消费错误信息来做决策（是否重试、是否告警、是否升级），需要一个统一的错误分类接口。

## Decision

采用**故障分类感知 + 分级重试 + 统一日志**三层错误处理架构。

### 1. 故障分类体系

核心是 `classifyFailure(error: string): FailureAnalysis` 函数（位于 `packages/publisher/src/types.ts`），将任意错误字符串映射为结构化的 `FailureAnalysis` 对象：

```typescript
interface FailureAnalysis {
  type: FailureType;      // 故障类型
  category: string;       // 中文分类名称
  description: string;    // 人类可读描述
  retryable: boolean;     // 是否可重试
  retryDelayMs: number;   // 重试延迟（毫秒）
}
```

**六类故障类型**：

| 类型 | 关键词匹配 | 可重试 | 延迟 | 典型场景 |
|------|-----------|--------|------|----------|
| `network` | timeout, network, econnrefused, socket, connection reset | ✅ | 5s | 网络波动、DNS 解析失败 |
| `auth` | auth, unauthorized, 401, cookie, token, 登录, 未授权 | ❌ | 0 | Cookie 过期、Token 失效 |
| `rate_limit` | rate, 429, 频繁, limit, throttled | ✅ | 30s | 发布频率过高触发平台限流 |
| `content` | content, violation, forbidden, 403, 敏感, 审核 | ❌ | 0 | 内容违规被平台拒绝 |
| `platform` | not found, 404, element, selector, 验证码, 人机 | ✅ | 10s | 页面结构变更、验证码拦截 |
| `unknown` | 兜底（所有未匹配的错误） | ✅ | 3s | 未知错误，保守重试 |

**分类规则**：按顺序从上到下匹配，首个命中的类型即为最终分类。这确保了更具体的错误（如 `auth` 中的 `401`）不会误归为更宽泛的类型（如 `network`）。

### 2. 分级重试策略

`Publisher.publishWithRetry()` 方法实现了基于故障分类的重试循环：

```
for attempt in 1..maxRetries+1:
  result = publish(article, credentials)
  if result.success:
    return success
  analysis = classifyFailure(result.error)
  if not analysis.retryable:
    break  // 不可重试，立即终止
  sleep(analysis.retryDelayMs * attempt)  // 线性递增延迟
return lastResult
```

**关键设计决策**：

- **线性递增延迟**：`retryDelayMs * attempt`，第 1 次重试延迟 `delay`，第 2 次延迟 `2*delay`，第 3 次延迟 `3*delay`，避免短时间内多次重试触发风控；
- **不可重试立即终止**：`auth` 和 `content` 类型标记 `retryable=false`，避免无意义的重试浪费时间和配额；
- **最大重试次数**：由调用方传入 `maxRetries` 参数控制，默认 3 次（共 4 次尝试）；
- **最后一次分析保留**：循环结束后保留 `lastAnalysis`，供上层决策使用。

### 3. 故障信息在各层的消费

| 层级 | 消费方式 | 代码位置 |
|------|----------|----------|
| **Publisher 层** | 根据分类决定是否重试和延迟时间 | `publisher.ts` — `publishWithRetry()` |
| **调度器层** | 根据分类更新任务状态（`failed` vs `retrying`）、设置下次重试时间 | `publish-scheduler.ts` — `dispatchTask()` |
| **健康监控层** | `auth` 类型失败触发会话健康检查和自动重登 | `session-health/checker.ts` |
| **API 路由层** | 返回结构化错误信息给前端，前端据此展示不同提示 | `routes/publish.ts` |
| **日志层** | 通过 `Publisher.log()` 持久化到 `publish_logs` 表 | `service-container.ts` — `logCallback` |

### 4. 调度器层的冷却策略

调度器在 `classifyFailure` 基础上进一步实现了**动态冷却机制**（详见 ADR-006），将故障分类映射到冷却档位：

| 故障类型 | 冷却档位 | 冷却时间 |
|----------|---------|----------|
| 正常发布成功 | `MIN_COOLDOWN` | 30s |
| 默认/未知 | `DEFAULT_COOLDOWN` | 60s |
| `rate_limit` | `RATE_LIMIT_COOLDOWN` | 3min |
| `platform`（含验证码） | `CAPTCHA_COOLDOWN` | 5min |

冷却期间该账号的任务不会被调度，避免连续触发风控。

### 5. 统一日志接口

`Publisher` 提供 `log(level, message, metadata?)` 方法作为日志统一入口：

- **优先持久化**：若配置了 `logCallback`（由 `service-container.ts` 注入），日志写入 `publish_logs` 表，支持后续查询和统计；
- **降级控制台**：未配置 `logCallback` 时降级到 `console.log`，格式为 `[Publisher] [INFO/WARN/ERROR] message`；
- **日志级别**：`INFO`（正常流程）、`WARN`（可恢复异常）、`ERROR`（不可恢复错误）；
- **元数据**：支持附加 JSON 元数据（如 `taskId`、`platform`、`attempt`），便于结构化查询。

### 6. 聚合分析类型

`@zemingengine/shared` 包导出 `PublishFailureAnalysis` 类型，将单次故障分析聚合为发布任务的整体失败分析：

```typescript
interface PublishFailureAnalysis {
  failureType: FailureType;
  failureCategory: string;
  failureDescription: string;
  retryable: boolean;
}
```

此类型用于 `PublishTask` 记录中持久化最终失败原因，供前端展示和统计报表使用。

## Alternatives Considered

### 替代方案 1：固定指数退避重试

**描述**：使用指数退避（1s → 2s → 4s → 8s）替代线性递增 + 故障分类。

**否决理由**：
- 不同故障类型需要不同退避策略（网络错误快速重试，频率限制需要更长等待）；
- 无法区分可重试和不可重试错误，导致无意义重试；
- 指数退避对频率限制场景退避不足（4s 远短于平台冷却窗口）。

### 替代方案 2：自定义 Error 子类

**描述**：为每种故障类型定义 `NetworkError`、`AuthError` 等子类，通过 `instanceof` 判断。

**否决理由**：
- RPA 场景的错误来源于 Playwright 异常、浏览器控制台、平台页面提示等，形式不固定，难以统一为自定义 Error 子类；
- `classifyFailure` 基于字符串匹配更灵活，能处理来自不同源的异构错误消息；
- 自定义 Error 子类需要在每个 RPA Handler 中手动抛出，增加维护负担。

### 替代方案 3：外部重试库（如 cockatiel、retry）

**描述**：使用成熟的重试库替代自实现重试循环。

**否决理由**：
- 外部库通常不内置故障分类逻辑，仍需自行实现 `classifyFailure`；
- 线性递增 + 故障分类的循环逻辑简单，引入外部依赖不值得；
- 自实现便于与调度器冷却机制和日志系统深度集成。

## Consequences

### 正面影响

1. **智能重试**：可重试错误自动重试，不可重试错误立即终止，避免浪费配额；
2. **风控友好**：线性递增延迟 + 动态冷却机制，有效避开平台风控窗口；
3. **可观测性好**：故障分类信息持久化到数据库，支持统计分析和趋势监控；
4. **统一接口**：所有层的错误决策基于同一个 `FailureAnalysis`，一致性好；
5. **扩展容易**：新增故障类型只需在 `classifyFailure` 中增加匹配规则。

### 负面影响

1. **关键词匹配有局限**：纯字符串匹配可能误分类（如错误消息中恰好包含 "timeout" 但实际是认证问题）；
2. **中文关键词维护成本**：需要同步维护中英文关键词，遗漏可能导致分类降级为 `unknown`；
3. **无熔断机制**：连续失败时不会自动熔断该平台，仅靠冷却机制缓解；
4. **`classifyFailure` 为同步函数**：无法处理需要异步探测的错误场景。

### 需要跟进的事项

- [ ] 增加熔断器模式（连续 N 次失败后暂停该平台调度）
- [ ] 支持正则匹配替代简单 `includes`
- [ ] 增加故障分类统计仪表盘（按平台、按类型、按时间维度）
- [ ] 支持自定义重试策略（允许 RPA Handler 覆盖默认重试行为）

## Superseded when

当出现以下任一情况时，本决策应被重新评估：

1. 需要异步错误探测（如主动检测平台可用性再决定是否重试）；
2. 故障类型超过 10 种，关键词匹配方式维护成本过高；
3. 引入消息队列后，重试逻辑需要迁移到队列层的死信处理；
4. 需要跨任务的全局熔断（当前为单任务级别重试）。
