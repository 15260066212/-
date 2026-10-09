# ADR-011: Session 健康监控机制（策略模式 + 状态机 + 自动重登 + 验证码管理）

**Type:** ADR
**Status:** accepted
**Tags:** architecture, session-health, monitoring, relogin

## Context

GEO 系统通过 RPA 模拟人工操作发布文章到 9 个内容平台，每个平台依赖浏览器 Cookie/Session 维持登录态。核心挑战：

- **登录态会过期**：各平台的 Cookie 有效期从数小时到数周不等，过期后 RPA 操作必然失败；
- **过期检测不及时**：若在发布任务执行时才发现 Session 过期，会浪费调度配额并延迟发布；
- **验证码干扰**：部分平台会弹出验证码（滑块、极验、图文等），阻断 RPA 流程；
- **人工介入成本高**：每次 Session 过期或验证码出现都需要人工登录，严重影响自动化率；
- **平台差异大**：微信可通过 API 校验 Token 有效性，其他平台需要通过 Harvester 检测页面状态。

## Decision

采用**策略模式 + 状态机 + 自动重登 + 验证码管理**的四层健康监控架构。

### 1. 策略模式验证器架构

`SessionHealthChecker` 维护 `Map<PlatformId, BaseValidator>` 注册表，每个平台对应一个验证器实现：

| 验证器 | 适用平台 | 检测方式 |
|--------|----------|----------|
| `WechatValidator` | 微信公众号 | 调用微信 API 检查 access_token 有效性 |
| `RpaHarvesterValidator` | 知乎/百家号/头条/CSDN/掘金/B站/搜狐/网易/知道 | 通过 Harvester 的 `/api/rpa/check-session` 接口检测 |

验证器通过 `RPA_REMOTE_URL` 环境变量动态注册——若未配置 Harvester 地址，则仅注册微信验证器，其他平台的健康检查降级为跳过。

### 2. 会话状态机

```
valid ──(check fail)──→ error ──(3 consecutive fails)──→ expired
  ↑                        │                                    │
  └──(check pass)──────────┘                                    │
  ↑                                                             │
  └──(relogin success)─────────────────────────────────────────┘
```

| 状态 | 含义 | 触发条件 |
|------|------|----------|
| `valid` | 登录态正常 | 检查通过 / 重登成功 |
| `checking` | 正在检查中 | 检查开始时设置 |
| `error` | 检查失败（可恢复） | 单次检查失败 |
| `expired` | 登录态失效 | 连续 3 次失败自动升级 |
| `invalid` | 凭证无效 | 人工标记 / Cookie 为空 |

**关键参数**：
- `CHECK_BATCH_SIZE = 3`：每批次并行检查 3 个凭证
- `MAX_CONSECUTIVE_FAILURES = 3`：连续 3 次失败升级为 expired
- `DEFAULT_CHECK_INTERVAL_MS = 6h`：默认 6 小时巡检一次

### 3. 批次巡检流程

`runCheckBatch()` 按以下流程执行：

1. 从 DB 获取 `dueCredentials`（到期的凭证列表）；
2. 过滤掉没有注册验证器的平台；
3. 并行执行 `checkCredential()`（最多 3 个并发）；
4. 每个凭证检查后更新 `consecutiveFailures` 计数器；
5. 若达阈值自动升级状态为 `expired` 并触发告警；
6. 检查通过则重置计数器、恢复状态为 `valid`；
7. 检查通过后还调用 `refresh-cookies` 端点刷新 Cookie 延长有效期。

### 4. 告警机制

`HealthAlerter` 负责将健康异常通知运维人员：

- **持久化**：告警先写入 DB 的 `health_alerts` 表，确保不丢失；
- **异步推送**：写入后异步发送到外部通知渠道；
- **支持三种通知格式**：
  - 企业微信 Bot Webhook（默认）
  - 飞书 Webhook
  - 通用 JSON Webhook
- **告警类型**：`session_expired`（Session 过期）、`captcha_detected`（验证码出现）、`relogin_failed`（重登失败）、`session_recovered`（恢复通知）

### 5. 自动重登机制

`ReloginManager` 在 Session 过期后尝试自动恢复登录态：

- **支持平台**：CSDN、掘金、哔哩哔哩（3 个平台有自动重登能力）；
- **调用方式**：请求 Harvester 的 `/api/rpa/relogin` 端点；
- **防刷策略**：单账号 30 分钟冷却 + 每小时最多 3 次尝试；
- **成功处理**：更新凭证 Cookie 和状态为 `active`，发送 `session_recovered` 通知；
- **失败处理**：记录失败次数，达到上限后停止重试，等待人工介入。

### 6. 验证码管理

`CaptchaManager` 处理验证码检测和响应：

- **7 种验证码类型**：`slider`（滑块）、`geetest`（极验）、`image`（图文）、`text`（文字）、`behavioral`（行为验证）、`sms`（短信）、`qrcode`（二维码）；
- **平台专属选择器**：每个平台配置特定的 CSS 选择器用于检测验证码元素；
- **通用选择器**：兜底的通用选择器，覆盖未知验证码形态；
- **检测流程**：RPA 执行过程中检测到验证码元素 → `recordCaptcha()` 记录事件 → 创建 `captcha_detected` 告警；
- **解决流程**：人工或自动解决后 `resolveCaptcha()` 标记为已解决；
- **重试控制**：`canRetry()` 方法基于验证码发生时间和冷却期判断是否可重试。

### 7. 选择器监控

`SelectorMonitor` 每 6 小时调用 Harvester 的 `/api/rpa/validate-selectors` 接口，校验所有平台的 CSS 选择器是否因页面改版而失效。失效的选择器会触发告警，提醒更新。

## Alternatives Considered

### 替代方案 1：发布时检测（无主动巡检）

**描述**：不定期巡检，仅在发布任务执行失败时检测 Session 状态。

**否决理由**：发布时才发现过期浪费调度配额，且失败后需要重新排队等待，发布延迟增大。

### 替代方案 2：全平台统一验证器

**描述**：所有平台使用同一个验证器（全部通过 Harvester 检测）。

**否决理由**：微信有官方 API 可直接检测 Token，不需要走 Harvester，效率更高且不依赖外部服务。

### 替代方案 3：所有平台支持自动重登

**描述**：为全部 9 个 RPA 平台实现自动重登。

**否决理由**：大部分平台的登录流程涉及验证码、扫码等人工步骤，无法完全自动化。当前仅支持 3 个可自动重登的平台是务实的折中。

## Consequences

### 正面影响

1. **主动发现**：6 小时巡检提前发现过期，避免发布时才失败；
2. **自动恢复**：3 个平台可自动重登，减少人工介入；
3. **验证码感知**：验证码检测和告警让运维人员及时响应；
4. **可观测性好**：健康状态、告警记录、验证码事件全部持久化到 DB。

### 负面影响

1. **依赖 Harvester**：9 个平台的检查和重登都依赖 Harvester 服务，Harvester 不可用时健康监控降级；
2. **6 小时巡检间隔可能不够及时**：部分平台 Cookie 有效期短于 6 小时，可能在两次巡检之间过期；
3. **自动重登覆盖率低**：仅 3/9 平台支持自动重登，其余仍需人工介入。

### 需要跟进的事项

- [ ] 支持更多平台的自动重登
- [ ] 动态调整巡检间隔（按平台 Cookie 有效期）
- [ ] 增加验证码自动解决能力（对接打码平台）
- [ ] 健康状态看板（前端可视化）

## Superseded when

1. 所有平台提供官方 API 可直接检测登录态；
2. 引入打码平台实现全自动验证码解决；
3. Harvester 架构被替代为分布式 Agent 模式。
