# ADR-019: Cookie 保温与会话保活（定时刷新 + 批量处理 + 失败降级）

**Type:** ADR
**Status:** accepted
**Tags:** architecture, cookie, session, warming

## Context

GEO 系统的 RPA 发布依赖各平台的登录 Cookie。Cookie 会随时间自然过期，过期后需要人工重新登录，严重影响自动化率。核心问题：

- **自然过期**：大部分平台的 Cookie 有效期为 7-30 天，不定期访问会加速过期；
- **过期后恢复成本高**：需人工打开浏览器、扫码/验证码登录，耗时 5-15 分钟；
- **批量管理**：系统可能有数十个平台账号的 Cookie 需要维护；
- **Harvester 能力**：远程 Harvester 服务提供 `refresh-cookies` 接口，可程序化刷新 Cookie；
- **不能频繁刷新**：过于频繁的 Cookie 刷新可能触发平台安全告警。

## Decision

采用 `CookieWarmer` 定时刷新 + 批量处理 + 失败降级的 Cookie 保温策略。

### 1. 保温架构

| 组件 | 职责 | 代码位置 |
|------|------|----------|
| `CookieWarmer` | 定时触发保温、批量选择凭证、调用 Harvester | `scheduler/cookie-warmer.ts` |
| Harvester | 远程 Cookie 刷新服务 | 外部服务 |
| `credentials` 表 | 存储 Cookie 和状态 | SQLite |

### 2. 保温参数

| 参数 | 默认值 | 环境变量 | 说明 |
|------|--------|----------|------|
| 保温间隔 | 2 小时 | `COOKIE_WARMER_INTERVAL_HOURS` | 每 2 小时执行一批保温 |
| 批次大小 | 5 | `COOKIE_WARMER_BATCH_SIZE` | 每批最多处理 5 个凭证 |
| 首次延迟 | 30 秒 | - | 启动后 30 秒开始首次保温 |
| 凭证间隔 | 2 秒 | - | 每个凭证刷新间隔 2 秒 |

### 3. 凭证筛选策略

`selectCredentialsForWarming()` 从 DB 获取全部凭证后过滤：

| 筛选条件 | 说明 |
|----------|------|
| `status !== 'invalid'` | 跳过已标记为无效的凭证 |
| 最近 2 小时未验证过 | 跳过刚验证过的凭证（避免重复） |
| 最多取 batch_size 个 | 控制批次大小 |

### 4. 单凭证保温流程

```
warmSingleCredential(cred):
  1. 检查 Cookie 是否存在且非占位符
     → 无 Cookie 或占位符: skip

  2. 调用 Harvester /api/rpa/refresh-cookies
     → 成功 + valid + refreshedCookies:
        更新 Cookie 和 status=active
     → 成功 + invalid:
        标记 status=expired
     → HTTP 错误/网络错误/超时/序列化异常:
        记录 failed

  3. 等待 2 秒后处理下一个（避免连续请求）
```

### 5. 失败处理策略

| 失败类型 | 处理方式 | 凭证状态 |
|----------|----------|----------|
| 无 Cookie / 占位符 | 跳过 | 不变 |
| Harvester 返回 invalid | 标记过期 | `expired` |
| HTTP 4xx/5xx 错误 | 记录失败 | 不变（保留旧 Cookie） |
| 网络错误 / 超时 | 记录失败 | 不变 |
| 序列化异常 | 记录失败 | 不变 |

**设计原则**：失败不改变凭证状态（保留旧 Cookie），避免因临时网络问题导致 Cookie 被错误标记为过期。

### 6. 运行状态管理

| 状态 | 方法 | 说明 |
|------|------|------|
| `cookieWarmerRunning` | 内部布尔值 | 防止重复执行 |
| `getCookieWarmerStatus()` | 对外暴露 | 返回运行状态、上次运行时间、批次结果 |

- **防重入**：通过 `cookieWarmerRunning` 标志确保同一时间只有一个保温批次在执行；
- **批次结果**：记录每批的 `warmed` / `skipped` / `failed` 数量。

### 7. 统一调度器模式

Cookie 保温遵循 ADR-012 中统一的调度器管理模式：

```typescript
startCookieWarmer(db)   // 启动保温调度器
stopCookieWarmer()       // 停止保温调度器
```

## Alternatives Considered

### 替代方案 1：被动保温（发布前刷新）

**描述**：在每次发布任务执行前刷新 Cookie。

**否决理由**：增加发布延迟（每次发布多等 2-5 秒）；无法提前发现过期 Cookie。

### 替代方案 2：全量刷新（不限批次）

**描述**：每次保温刷新全部凭证。

**否决理由**：凭证多时请求量大，可能触发 Harvester 或平台限制；2 秒间隔 × 50 个凭证 = 100 秒，影响调度器响应。

### 替代方案 3：平台 API 主动续期

**描述**：通过平台官方 API 续期 Cookie/Token。

**否决理由**：大部分平台无公开的 Cookie 续期 API；微信的 access_token 续期已由 `WechatAdapter` 内部处理。

## Consequences

### 正面影响

1. **延长登录态**：定期刷新显著延长 Cookie 有效期，减少人工登录频率；
2. **提前发现问题**：保温时发现过期 Cookie，提前标记并触发告警；
3. **批量高效**：每批 5 个，2 小时一轮，平衡刷新频率和资源消耗；
4. **失败安全**：失败不改变状态，保留旧 Cookie 不影响后续发布。

### 负面影响

1. **依赖 Harvester**：Harvester 不可用时保温停止，Cookie 可能过期；
2. **间隔可能不够**：部分平台 Cookie 有效期短于 2 小时，可能在两次保温之间过期；
3. **无重试**：单次保温失败不自动重试，需等下一轮；
4. **覆盖率有限**：每批仅 5 个，大量凭证时单轮覆盖率低。

### 需要跟进的事项

- [ ] 动态调整保温间隔（按平台 Cookie 有效期）
- [ ] 保温失败自动重试（指数退避）
- [ ] 保温覆盖率看板（前端可视化）
- [ ] 与 Session 健康检查联动（过期优先保温）

## Superseded when

1. 所有平台提供 Token 自动续期 API；
2. Cookie 管理被外部 Session 管理服务替代；
3. Harvester 架构升级为实时保活模式。
