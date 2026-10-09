# ADR-013: 平台适配器抽象（PlatformAdapter 基类 + API/RPA 双模式统一接口）

**Type:** ADR
**Status:** accepted
**Tags:** architecture, platform-adapter, abstraction, publisher

## Context

GEO 系统需要将文章发布到 10 个内容平台，各平台的发布方式差异巨大：

- **微信公众号**提供官方 API（草稿 → 提交发布 → 轮询状态），无需浏览器自动化；
- **其余 9 个平台**无可用开放 API，必须通过浏览器 RPA 模拟人工操作；
- 各平台的 API 调用链、认证方式、页面结构、内容格式要求各不相同；
- 如果在业务代码中直接耦合平台特定逻辑，每新增一个平台都需要修改核心代码。

需要一个统一的抽象层，让调度器和 Publisher 不需要关心具体平台的发布方式（API 还是 RPA），只通过统一接口调用。

## Decision

采用 `PlatformAdapter` 抽象基类 + `RpaHandler` 抽象基类的**双模式适配器架构**，以 `Publisher` 为门面统一路由。

### 1. PlatformAdapter 抽象基类（API 模式）

```typescript
abstract class PlatformAdapter {
  abstract platform: PlatformId;
  abstract publish(params: PublishParams): Promise<PublishResult>;
  abstract getMethod(): 'api' | 'rpa';
  verifyWithCredentials(params: PublishParams, result: PublishResult): Promise<verificationStatus>
}
```

| 方法 | 职责 |
|------|------|
| `platform` | 平台标识（如 `weixin`） |
| `publish()` | 执行发布操作，返回结果 |
| `getMethod()` | 返回发布方式（`api` 或 `rpa`） |
| `verifyWithCredentials()` | 发布后验证（默认返回 `unverified`，可覆写） |

**当前实现**：仅 `WechatAdapter`（微信公众号），完整实现草稿创建 → 提交发布 → 轮询状态 → 验证发布全流程。

### 2. RpaHandler 抽象基类（RPA 模式）

```typescript
abstract class RpaHandler {
  abstract platform: PlatformId;
  abstract publish(page: Page, article: Article, credentials: PlatformCredentials): Promise<PublishResult>
}
```

| 方法 | 职责 |
|------|------|
| `platform` | 平台标识 |
| `publish(page, article, credentials)` | 在 Playwright Page 上执行发布操作 |

**基类提供的通用工具方法**：

| 方法 | 用途 |
|------|------|
| `parseCookies()` | 解析凭证中的 Cookie 字符串为浏览器可用的格式 |
| `clickElement()` | 带等待和错误处理的元素点击 |
| `fillInput()` | 填充输入框 |
| `fillRichTextEditor()` | 富文本编辑器填充（按优先级尝试平台选择器 → ProseMirror → Quill → contenteditable → textarea） |
| `addTags()` | 标签添加（逐个填入并回车，失败静默跳过） |
| `captureScreenshot()` | 调试截图 |

**超时配置**：

| 名称 | 超时 | 用途 |
|------|------|------|
| `SHORT` | 500ms | 快速操作（等待元素出现） |
| `MEDIUM` | 5s | 中等操作（点击响应） |
| `LONG` | 10s | 长操作（表单提交） |
| `PAGE_NAVIGATION` | 30s | 页面导航 |

### 3. Publisher 门面路由

`Publisher` 作为门面层，统一管理 API 适配器和 RPA Handler 的注册与路由：

```typescript
class Publisher {
  registerAdapter(adapter: PlatformAdapter): void
  registerRpaHandler(handler: RpaHandler): void
  supportsPlatform(platform: PlatformId): boolean
  listSupportedPlatforms(): PlatformId[]
  publish(task: PublishTask): Promise<PublishResult>
}
```

**发布路由逻辑**：
1. 检查 `adapters` 中是否有该平台的 API 适配器 → 有则调用 `adapter.publish()`
2. 否则检查 `rpaEngine` 中是否有该平台的 RPA Handler → 有则调用 `rpaEngine.publish()`
3. 都没有则返回 `{ success: false, error: 'No handler for platform X' }`

### 4. WechatAdapter 实现细节

微信公众号的 API 发布流程是唯一使用 API 模式的平台：

| 步骤 | API 接口 | 说明 |
|------|----------|------|
| 获取 access_token | `/cgi-bin/token` | 带 5 分钟缓冲缓存，避免频繁获取 |
| 创建草稿 | `/cgi-bin/draft/add` | 将文章内容转为 HTML 格式提交 |
| 提交发布 | `/cgi-bin/freepublish/submit` | 将草稿提交为正式文章 |
| 轮询状态 | `/cgi-bin/freepublish/get` | 最多 3 次，间隔 2s |
| 验证发布 | `/cgi-bin/freepublish/getarticle` | 确认文章已发布 |

**内置 Markdown → HTML 转换器**：支持标题、加粗、链接、代码块、列表等轻量级转换。

### 5. 9 个 RPA Handler 实现

| Handler | 平台 | 关键流程 |
|---------|------|----------|
| `ZhihuRpaHandler` | 知乎 | 导航到专栏写作页 → 填充标题和正文 → 添加标签 → 发布 |
| `CsdnRpaHandler` | CSDN | 导航到编辑器 → 填充 → 选择标签 → 发布 |
| `JuejinRpaHandler` | 掘金 | 导航到草稿页 → 填充 → 选择分类 → 发布 |
| `BaijiaRpaHandler` | 百家号 | 导航到编辑页 → 填充 → 发布 |
| `ToutiaoRpaHandler` | 今日头条 | 导航到图文发布页 → 填充 → 发布 |
| `BilibiliRpaHandler` | 哔哩哔哩 | 导航到专栏投稿页 → 填充 → 发布 |
| `SohuRpaHandler` | 搜狐号 | 导航到编辑页 → 填充 → 发布 |
| `NeteaseRpaHandler` | 网易号 | 导航到文章编辑页 → 填充 → 发布 |
| `BaiduZhidaoRpaHandler` | 百度知道 | 导航到提问页 → 填充 → 发布 |

所有 Handler 共享基类 `RpaHandler` 提供的工具方法，减少重复代码。

## Alternatives Considered

### 替代方案 1：单一适配器接口（API 和 RPA 统一为一个类）

**描述**：每个平台一个适配器类，内部判断走 API 还是 RPA。

**否决理由**：API 和 RPA 的依赖和实现差异大（API 不需要浏览器，RPA 需要 Playwright Page），强行统一会导致接口参数冗余。

### 替代方案 2：动态发现平台能力

**描述**：运行时自动检测平台支持 API 还是 RPA。

**否决理由**：平台能力是静态已知的，不需要动态检测；静态注册更清晰、更安全。

## Consequences

### 正面影响

1. **单一注册入口**：`Publisher.createDefault()` 统一注册所有平台，新增平台只需在此添加一行；
2. **关注点分离**：API 适配器不依赖 Playwright，RPA Handler 不依赖 HTTP 客户端；
3. **通用工具复用**：`RpaHandler` 基类提供富文本填充、点击、截图等通用方法，9 个 Handler 共享；
4. **可测试性好**：适配器和 Handler 可独立测试，不依赖调度器或数据库。

### 负面影响

1. **抽象层增加**：新增平台需要理解 PlatformAdapter 或 RpaHandler 的基类约定；
2. **富文本填充选择器维护**：各平台页面改版时需要更新选择器；
3. **API 模式扩展受限**：当前仅微信有 API 模式，未来新增 API 平台需要实现完整适配器。

### 需要跟进的事项

- [ ] 为富文本填充选择器建立配置化机制（不硬编码）
- [ ] 增加平台能力声明（支持标签、分类、封面等特性）
- [ ] 统一 Markdown → HTML 转换器为独立模块

## Superseded when

1. 大部分平台提供官方发布 API，RPA 模式不再是主流；
2. 富文本填充能力被提取为独立通用库；
3. 发布流程从同步调用改为异步事件驱动。
