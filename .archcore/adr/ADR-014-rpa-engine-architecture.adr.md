# ADR-014: RPA 引擎架构（Playwright + SessionPool + 远程 Harvester + LLMWiki 兜底）

**Type:** ADR
**Status:** accepted
**Tags:** architecture, rpa, playwright, browser-automation

## Context

GEO 系统的 9 个内容平台无法通过官方 API 发布文章，必须使用浏览器自动化（RPA）模拟人工操作。核心挑战：

- **浏览器资源管理**：每个发布任务需要独立的浏览器上下文（Cookie 隔离），频繁启动/关闭浏览器性能差；
- **Session 持久化**：登录态（Cookie）需要跨任务复用，不能每次发布都重新登录；
- **部署灵活性**：本地开发时浏览器在本地运行，生产环境可能需要远程执行（headless 服务器无 GUI）；
- **故障兜底**：RPA 操作可能因页面改版、验证码等原因失败，需要降级策略；
- **发布后验证**：提交发布后需要验证文章确实已发布（获取发布后的 URL）。

## Decision

采用 `RPAEngine` 为核心的**四层 RPA 架构**：Playwright 浏览器引擎 + SessionPool 会话池 + 远程 Harvester 模式 + LLMWiki 兜底降级。

### 1. 架构分层

| 层级 | 职责 | 核心模块 |
|------|------|----------|
| **RPAEngine** | 引擎入口、handler 路由、浏览器生命周期管理 | `packages/publisher/src/rpa-engine.ts` |
| **SessionPool** | 浏览器上下文持久化、指纹隔离、Cookie 注入 | `ISessionPool` 接口 |
| **RpaHandler** | 平台特定的发布流程实现 | `packages/publisher/src/rpa-handlers/` |
| **Harvester** | 远程 RPA 执行服务（可选） | 外部服务，通过 HTTP API 调用 |

### 2. 浏览器实例管理

`RPAEngine` 采用**懒加载单例**模式管理浏览器实例：

- `launch()` 方法首次调用时创建 Playwright `Browser` 实例并缓存；
- 后续所有发布任务复用同一个 Browser 实例；
- 每个 publish() 调用创建新的 `BrowserContext`（隔离 Cookie 和 Session）；
- 任务结束后关闭 Context（释放资源），但 Browser 实例保留。

### 3. SessionPool 集成

通过 `ISessionPool` 接口与浏览器上下文交互：

| 能力 | 说明 |
|------|------|
| 上下文创建 | 为每个平台账号创建独立的 BrowserContext |
| Cookie 注入 | 从凭证数据库加载 Cookie，注入到 Context |
| 指纹隔离 | 每个 Context 独立的 UA、视口、时区等 |
| Session 复用 | 相同账号的后续任务复用已有 Context |

### 4. 远程 Harvester 模式

通过 `RPA_REMOTE_URL` 环境变量启用远程模式：

| 模式 | 浏览器运行位置 | 适用场景 |
|------|--------------|----------|
| **本地模式**（默认） | 本机 Playwright | 本地开发、Docker 部署 |
| **远程模式** | Harvester 服务 | 生产环境（headless 服务器无 GUI） |

**远程模式 API**：

| 端点 | 用途 |
|------|------|
| `POST /api/rpa/publish` | 委托发布任务给 Harvester |
| `POST /api/rpa/check-session` | 检查 Session 有效性 |
| `POST /api/rpa/refresh-cookies` | 刷新 Cookie |
| `POST /api/rpa/relogin` | 自动重登 |
| `POST /api/rpa/validate-selectors` | 校验 CSS 选择器 |

### 5. Handler 注册与路由

RPAEngine 不自动注册任何 Handler（纯执行引擎），由 `Publisher.createDefault()` 统一注册：

```typescript
engine.registerHandler(new CsdnRpaHandler());
engine.registerHandler(new ZhihuRpaHandler());
// ...
```

`publish()` 方法通过 `handlers.get(platform)` 查找对应 Handler 执行。

### 6. LLMWiki 兜底降级

当 RPA 发布失败时，启用 LLMWiki 兜底机制（默认开启，`RPA_LLMWIKI_FALLBACK` 控制）：

- 将文章内容提交到 LLMWiki 服务；
- LLMWiki 通过 AI 辅助方式完成发布；
- 作为最后手段，不保证成功率，但提供降级路径；
- 兜底结果同样记录到发布日志。

### 7. 发布后 URL 验证

RPA Handler 提交发布后，执行 URL 验证流程：

| 验证结果 | 含义 |
|----------|------|
| `verified` | 成功获取到发布后的文章 URL |
| `unverified` | 提交成功但未能获取 URL |
| `failed` | 验证失败（文章可能未发布成功） |
| `api_confirmed` | 通过 API 确认发布成功（仅微信） |

`parseCookies` 辅助函数支持 Cookie 字符串解析，确保注入到浏览器的 Cookie 格式正确。

## Alternatives Considered

### 替代方案 1：Puppeteer 替代 Playwright

**描述**：使用 Puppeteer 作为浏览器自动化引擎。

**否决理由**：Playwright 对多浏览器支持更好；API 设计更现代化（auto-waiting、locator）；Microsoft 维护活跃。

### 替代方案 2：每次发布新开浏览器

**描述**：不使用 SessionPool，每次发布启动新浏览器实例。

**否决理由**：启动开销大（2-5 秒）；无法复用登录态；资源浪费严重。

### 替代方案 3：Selenium Grid 远程执行

**描述**：使用 Selenium Grid 替代自建 Harvester。

**否决理由**：Selenium Grid 仅提供浏览器远程执行，不包含 Cookie 管理、Session 检查等业务逻辑；Harvester 集成了 GEO 特定的 RPA 能力。

## Consequences

### 正面影响

1. **资源高效**：浏览器实例复用 + Context 隔离，平衡性能与隔离；
2. **部署灵活**：本地/远程双模式，适配不同部署环境；
3. **降级兜底**：LLMWiki 提供最后手段，避免完全失败；
4. **纯执行引擎**：RPAEngine 不绑定平台，Handler 注册由外部控制。

### 负面影响

1. **依赖 Playwright**：浏览器自动化引擎绑死 Playwright，切换成本高；
2. **Harvester 是单点**：远程模式下 Harvester 不可用时所有 RPA 发布停滞；
3. **LLMWiki 兜底覆盖有限**：不是所有平台都支持 LLMWiki 降级；
4. **浏览器版本依赖**：平台页面改版可能导致 Handler 失效。

### 需要跟进的事项

- [ ] 增加 Harvester 健康检查和故障转移
- [ ] LLMWiki 兜底覆盖更多平台
- [ ] 浏览器实例定期重启（防止内存泄漏）
- [ ] Handler 选择器自动更新机制

## Superseded when

1. 所有平台提供官方发布 API，RPA 不再需要；
2. Playwright 被更先进的浏览器自动化框架替代；
3. Harvester 架构演变为分布式 Agent 模式。
