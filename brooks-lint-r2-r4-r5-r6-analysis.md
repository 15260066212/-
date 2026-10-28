# GEO Assistant 代码腐化风险分析报告 (R2/R4/R5/R6)

> 分析范围：`apps/`, `packages/`, `harvester/` 下的 TypeScript/JavaScript 源文件
> 排除：`node_modules`, `dist`, `build`, `.git`, `data/`, `content-review-intro/`, `.spec-workflow/`
> 分析日期：2026-10-14

---

## R2 - 变更传播 (Change Propagation)

> **核心风险**：一个需求变更需要触及多个不相关模块，导致修改成本指数级上升。

### R2-1 [Critical] Shotgun Surgery: 新增发布平台需修改 7+ 个不相关模块

| 属性 | 详情 |
|------|------|
| **严重级别** | Critical |
| **症状描述** | 新增一个发布平台需要同时修改以下 7+ 个位置：① `packages/shared/src/platform-registry.ts`（注册平台元数据）② `packages/publisher/src/publisher.ts` 的 `createDefault()`（注册 handler）③ `packages/publisher/src/rpa-handlers/index.ts`（导出 handler）④ 新建 `rpa-handlers/<platform>.ts` ⑤ `apps/server/src/session-health/selector-registry.ts`（添加选择器）⑥ `harvester/config/platforms.js`（harvester 端配置）⑦ `packages/dialogue-engine/src/platformPromptTemplates.ts`（平台提示词模板）⑧ `packages/content-generator/src/platform-adapter.ts`（平台适配） |
| **涉及文件** | `packages/shared/src/platform-registry.ts:60-244`<br>`packages/publisher/src/publisher.ts:51-68`<br>`packages/publisher/src/rpa-handlers/index.ts:1-12`<br>`apps/server/src/session-health/selector-registry.ts:47-291`<br>`harvester/config/platforms.js`<br>`packages/dialogue-engine/src/platformPromptTemplates.ts`<br>`packages/content-generator/src/platform-adapter.ts` |
| **修复类别** | Extended-Safe |
| **具体修复方案** | 引入**平台插件架构**：将平台相关信息（元数据、RPA handler、选择器、提示词模板）聚合到每个平台自己的模块中，通过统一的注册机制自动发现。可以参考现有 `platform-registry.ts` 的统一方向，但需要进一步将 RPA handler、选择器、提示词模板等也纳入插件化注册，使新增平台只需新增一个目录/文件。 |

### R2-2 [Critical] Shotgun Surgery: 发布执行逻辑在 4 处重复实现

| 属性 | 详情 |
|------|------|
| **严重级别** | Critical |
| **症状描述** | 文章发布的核心流程（获取凭证→创建任务→调用 publisher→更新任务状态→更新文章状态）在以下 4 处各自实现了一套：① `routes/publish.ts` 的 `publishArticleAsync()` ② `routes/pipeline.ts` 的 `publishForPipeline()` ③ `scheduler/publish-scheduler.ts` 的 `executeScheduledPublish()` ④ `publish-utils.ts` 的 `executePublishWithHandling()`。虽然 `publish-utils.ts` 已抽取了部分公共逻辑，但前三者仍各自有独立的凭证解析、审核门禁、状态更新逻辑。 |
| **涉及文件** | `apps/server/src/routes/publish.ts:333-402`<br>`apps/server/src/routes/pipeline.ts:396-422`<br>`apps/server/src/scheduler/publish-scheduler.ts:268-317`<br>`apps/server/src/publish-utils.ts:10-88` |
| **修复类别** | Extended-Safe |
| **具体修复方案** | 将发布执行流程统一收敛到一个 `PublishOrchestrator` 服务类中，包含：凭证解析、审核门禁、任务创建、发布执行、状态更新、错误处理。所有入口点（route/pipeline/scheduler）都调用同一个 orchestrator 的同一方法，只传入不同的上下文参数。 |

### R2-3 [Warning] Divergent Change: SessionPool 与 SessionPoolAdapter 功能重复

| 属性 | 详情 |
|------|------|
| **严重级别** | Warning |
| **症状描述** | `packages/session-pool/src/pool.ts` 中的 `SessionPool` 类和 `apps/server/src/session-pool-adapter.ts` 中的 `SessionPoolAdapter` 类实现了几乎完全相同的功能：浏览器上下文池管理、指纹注入、WebRTC 防泄漏、Cookie 域名过滤、LRU 驱逐、session 持久化。`PLATFORM_COOKIE_DOMAINS` 常量在两处重复定义，`DEFAULT_FINGERPRINT` 也在两处重复。任何 session 池逻辑的变更都需要同时修改两个文件。 |
| **涉及文件** | `packages/session-pool/src/pool.ts:25-37,48-422`<br>`apps/server/src/session-pool-adapter.ts:44-69,71-325` |
| **修复类别** | Extended-Safe |
| **具体修复方案** | 淘汰 `session-pool` 包，将 `SessionPoolAdapter` 作为唯一实现保留在 server 端。或者反过来，将 `SessionPoolAdapter` 的逻辑合并回 `session-pool` 包，server 端直接使用。核心是消除重复实现，保证只有一份真相。 |

### R2-4 [Warning] Divergent Change: platform-registry 承担过多职责

| 属性 | 详情 |
|------|------|
| **严重级别** | Warning |
| **症状描述** | `PlatformInfo` 接口包含了 12+ 个字段，涵盖：显示名(label)、session 池名、harvester 名、URL(homepage/editor/url)、LLMWiki 名、域名、登录重定向模式、能力标志(capabilities)。这个类会因为以下完全不同的原因而变更：① 新增平台 ② UI 显示调整 ③ harvester 集成变更 ④ RPA 发布流程变化 ⑤ LLMWiki 回退调整 ⑥ 能力扩展。违反了单一职责原则。 |
| **涉及文件** | `packages/shared/src/platform-registry.ts:19-58,60-244` |
| **修复类别** | Safe |
| **具体修复方案** | 将 `PlatformInfo` 按关注点拆分为多个小接口：`PlatformDisplayInfo`（UI 相关）、`PlatformRpaConfig`（RPA 发布相关）、`PlatformHarvesterConfig`（harvester 相关）、`PlatformCapabilities`（能力标志）。主 registry 组合这些接口，各消费方只依赖自己需要的部分。 |

### R2-5 [Warning] Shotgun Surgery: 凭证健康状态变更涉及 5 个模块

| 属性 | 详情 |
|------|------|
| **严重级别** | Warning |
| **症状描述** | 凭证健康检查失败/恢复的完整流程跨越了 5 个模块：① `session-health/checker.ts` 执行检查并记录结果 ② `credential-repository.ts` 记录健康检查数据 ③ `session-health/alerter.ts` 创建告警 ④ `session-health/relogin-manager.ts` 触发自动重登 ⑤ `session-health/captcha-manager.ts` 处理验证码。状态流转逻辑分散在这些模块中，理解和修改都需要通读全部 5 个文件。 |
| **涉及文件** | `apps/server/src/session-health/checker.ts:106-196`<br>`apps/server/src/repositories/credential-repository.ts`<br>`apps/server/src/session-health/alerter.ts`<br>`apps/server/src/session-health/relogin-manager.ts`<br>`apps/server/src/session-health/captcha-manager.ts` |
| **修复类别** | Extended-Safe |
| **具体修复方案** | 引入**凭证健康状态机**（CredentialHealthStateMachine），将状态转换规则、告警触发条件、重登触发条件集中在一个地方。checker 只负责执行验证并触发状态转换，状态机内部决定何时发告警、何时触发重登。 |

### R2-6 [Warning] Feature Envy: pipeline 路由层过度操作 Article/Session 数据

| 属性 | 详情 |
|------|------|
| **严重级别** | Warning |
| **症状描述** | `routes/pipeline.ts` 中的 `generateArticleWithRetry()` 和 `executePipeline()` 包含了大量业务逻辑：生成-审核循环、页脚追加、状态更新、文章插入数据库、审核插入、状态判断（approved/reviewing/manual_edit）。这些逻辑本应属于领域服务层，但全部堆在路由处理函数中，导致路由层"嫉妒" Article/Session 的数据和行为。 |
| **涉及文件** | `apps/server/src/routes/pipeline.ts:251-315,321-384` |
| **修复类别** | Extended-Safe |
| **具体修复方案** | 抽取 `PipelineService` 领域服务类，将 `executePipeline`、`generateArticleWithRetry`、`publishForPipeline` 等业务逻辑移入。路由层只负责参数解析、调用 service、返回结果。 |

### R2-7 [Warning] Divergent Change: RPAEngine 承担 6 种不同职责

| 属性 | 详情 |
|------|------|
| **严重级别** | Warning |
| **症状描述** | `RPAEngine` 类同时负责：① 浏览器启动与管理（launch/close）② 指纹管理（fingerprint manager）③ SessionPool 集成 ④ handler 注册与调度 ⑤ 远程模式代理（RemotePublisher）⑥ LLMWiki 回退（LLMWikiFallback）⑦ 发布验证（PublicationVerifier）。任何一个方面的变更都可能影响其他方面，类的内聚性低。 |
| **涉及文件** | `packages/publisher/src/rpa-engine.ts:67-398` |
| **修复类别** | Extended-Safe |
| **具体修复方案** | 将 RPAEngine 拆分为：① `BrowserManager`（浏览器生命周期）② `RpaDispatcher`（handler 调度）③ `RpaExecutionContext`（执行上下文：指纹+session+验证）。RPAEngine 保留为外观类(Facade)，但内部逻辑分到不同类中。 |

### R2-8 [Suggestion] Shotgun Surgery: 选择器定义在 RPA handler 和 selector-registry 中重复

| 属性 | 详情 |
|------|------|
| **严重级别** | Suggestion |
| **症状描述** | CSS 选择器在两处维护：① `session-health/selector-registry.ts` 中的 `SELECTOR_REGISTRY`（用于健康检查和选择器监控）② 各 RPA handler 类中硬编码的选择器（如 `zhihu.ts` 中的 title 选择器、publish 按钮选择器）。同一平台的相同选择器可能在两处定义不一致，平台 UI 变更时需要同时修改两处。 |
| **涉及文件** | `apps/server/src/session-health/selector-registry.ts:47-291`<br>`packages/publisher/src/rpa-handlers/zhihu.ts:69-110`<br>以及其他各平台 handler |
| **修复类别** | Safe |
| **具体修复方案** | 将 RPA handler 中的选择器也统一到 `SELECTOR_REGISTRY` 中，handler 通过调用 `getPlatformSelectors(platform)` 获取所需选择器，不再硬编码。 |

### R2-9 [Suggestion] Divergent Change: article.ts route 中的生成-审核循环逻辑与 pipeline 重复

| 属性 | 详情 |
|------|------|
| **严重级别** | Suggestion |
| **症状描述** | `routes/article.ts` 的 `POST /generate` 接口中实现了"生成 → 审核 → 不通过则重新生成"的循环逻辑（最多 3 轮），这与 `routes/pipeline.ts` 中的 `generateArticleWithRetry()` 逻辑高度相似但不完全一致（pipeline 版用了 `appendContactFooter`、不同的状态赋值顺序等）。审核-重试策略变更时需要改两处。 |
| **涉及文件** | `apps/server/src/routes/article.ts:14-93`<br>`apps/server/src/routes/pipeline.ts:251-315` |
| **修复类别** | Safe |
| **具体修复方案** | 抽取 `ArticleGenerationService`，包含 `generateWithReview()` 方法，统一"生成-审核-重试"循环逻辑。两个路由都调用同一个 service 方法。 |

### R2-10 [Suggestion] Feature Envy: ContentReviewer 过度操作 Article 内部状态

| 属性 | 详情 |
|------|------|
| **严重级别** | Suggestion |
| **症状描述** | `ContentReviewer.review()` 方法读取 Article 的 title、contentMarkdown、tags、status 等多个字段，执行 8 个维度的检查，计算加权分数，判断是否通过。Article 本身只是一个纯数据接口，没有任何行为方法。所有关于"文章是否合格"的判断逻辑都在外部 service 中。 |
| **涉及文件** | `packages/content-reviewer/src/reviewer.ts:66-162` |
| **修复类别** | Residual |
| **具体修复方案** | 在领域驱动设计中，这是典型的贫血模型。对于当前规模的项目，保持 service 模式可接受。若未来审核逻辑进一步复杂化，可考虑将部分基础校验逻辑（如字数检查、必填字段检查）移入 Article 类的方法中。 |

---

## R4 - 偶然复杂度 (Accidental Complexity)

> **核心风险**：为"将来可能用得上"而构建的抽象，或不必要的间接层，增加了理解和维护成本。

### R4-1 [Critical] Speculative Generality: CSDN 三层 Strategy 模式过度设计

| 属性 | 详情 |
|------|------|
| **严重级别** | Critical |
| **症状描述** | CSDN 发布使用了三级 Strategy 模式：`NewEditorStrategy` → `OldEditorStrategy` → `DraftManagementStrategy`，每个 strategy 都是一个完整的独立发布流程。CSDN handler 中用 for 循环依次尝试。这种设计基于"CSDN 页面多变，需要多种回退策略"的假设，但实际上：① 三种策略中有两种可能长期不被触发 ② 每个 strategy 都包含完整的导航-填标题-填内容-点击发布流程，代码重复度高 ③ 维护成本远高于收益。 |
| **涉及文件** | `packages/publisher/src/rpa-handlers/csdn.ts:35-75`<br>`packages/publisher/src/rpa-handlers/csdn/strategies/new-editor.strategy.ts`<br>`packages/publisher/src/rpa-handlers/csdn/strategies/old-editor.strategy.ts`<br>`packages/publisher/src/rpa-handlers/csdn/strategies/draft-management.strategy.ts` |
| **修复类别** | Extended-Safe |
| **具体修复方案** | 收敛为单一主策略 + 关键步骤的回退机制。保留主编辑器流程，只在"点击发布按钮"或"填写内容"等容易失败的步骤上提供备用选择器，而不是三套完整的独立发布流程。可直接复用 `SimpleRpaHandler` 的模板方法模式。 |

### R4-2 [Warning] Lazy Class: GenericRpaHandler 只返回错误信息

| 属性 | 详情 |
|------|------|
| **严重级别** | Warning |
| **症状描述** | `GenericRpaHandler` 类继承自 `RpaHandler`，但 `publish()` 方法只有一行逻辑：返回一条"No dedicated RPA handler implemented"的错误信息。这个类在实际代码中从未被注册到 Publisher 中（在 `publisher.ts` 的 `createDefault()` 中没有注册 GenericRpaHandler），只是被导出。它的存在是为了"万一将来需要"的默认 fallback。 |
| **涉及文件** | `packages/publisher/src/rpa-handlers/generic.ts:10-22` |
| **修复类别** | Safe |
| **具体修复方案** | 删除 `GenericRpaHandler` 类。在 `RPAEngine.publish()` 中，handler 不存在时直接返回错误即可，无需为这个错误场景专门创建一个类。 |

### R4-3 [Warning] Middle Man: LLMWikiFallback 几乎完全委托给 LLMWikiHandler

| 属性 | 详情 |
|------|------|
| **严重级别** | Warning |
| **症状描述** | `LLMWikiFallback` 类的主要职责是：① 管理 enabled 状态 ② 懒加载 LLMWikiHandler ③ 调用 `llmwikiHandler.supportsPlatform()` 和 `llmwikiHandler.publish()`。核心的发布逻辑全部委托给 `LLMWikiHandler`，`LLMWikiFallback` 只是加了一层 enabled 开关和日志包装。在 `RPAEngine` 中，甚至通过 `(this.llmWikiFallback as any).tryFallback?.()` 来调用，接口不一致。 |
| **涉及文件** | `packages/publisher/src/rpa/llmwiki-fallback.ts:13-99`<br>`packages/publisher/src/rpa-engine.ts:371-384` |
| **修复类别** | Safe |
| **具体修复方案** | 将 enabled 开关和懒加载逻辑移入 `LLMWikiHandler` 自身，删除 `LLMWikiFallback` 中间层。`RPAEngine` 直接持有 `LLMWikiHandler` 实例。 |

### R4-4 [Warning] Speculative Generality: PublishQueue 内存队列类实际未被使用

| 属性 | 详情 |
|------|------|
| **严重级别** | Warning |
| **症状描述** | `PublishQueue` 类实现了一个内存发布队列（enqueue/dequeue/getPending/updateTask/remove 等方法），但在整个代码库中没有任何地方实际使用它。实际的发布队列是基于数据库的（`publish_repository.ts` 中的 `getPendingPublishTasks`）。这个类看起来是为"将来引入内存队列优化"准备的，但目前是死代码。 |
| **涉及文件** | `packages/publisher/src/queue.ts:7-58` |
| **修复类别** | Safe |
| **具体修复方案** | 删除 `PublishQueue` 类。如果将来需要内存队列作为性能优化，可以再基于数据库表的真实使用场景重新设计。 |

### R4-5 [Warning] Lazy Class: RemotePublisher 类只有两个方法

| 属性 | 详情 |
|------|------|
| **严重级别** | Warning |
| **症状描述** | `RemotePublisher` 类只有两个方法：`isRemoteMode()`（检查环境变量）和 `remotePublish()`（发一个 HTTP 请求）。这个类的职责过于单薄，本质上就是对 `fetch()` 调用的一个简单封装。类中没有状态管理、没有重试逻辑、没有错误分类，存在的价值很低。 |
| **涉及文件** | `packages/publisher/src/rpa/remote-publisher.ts:12-70` |
| **修复类别** | Safe |
| **具体修复方案** | 将远程发布逻辑直接内联到 `RPAEngine` 的 `publish()` 方法中（目前就是一个 if-else 分支），或者将 `isRemoteMode()` 和远程发布调用作为 `RPAEngine` 的私有方法。删除 `RemotePublisher` 类。 |

### R4-6 [Suggestion] Middle Man: PlatformAdapter 抽象类的 verifyWithCredentials 默认无行为

| 属性 | 详情 |
|------|------|
| **严重级别** | Suggestion |
| **症状描述** | `PlatformAdapter` 抽象类中 `verifyWithCredentials()` 的默认实现直接返回 `{ verificationStatus: 'unverified', verificationMessage: 'Verification not supported for this platform' }`。目前只有 `WechatAdapter` 覆盖了这个方法。这个方法对所有非 API 平台来说都是死代码，只是为了"将来其他平台可能也需要验证"而存在。 |
| **涉及文件** | `packages/publisher/src/adapters/base.ts:31-39` |
| **修复类别** | Safe |
| **具体修复方案** | 从 `PlatformAdapter` 基类中移除 `verifyWithCredentials()`，只在 `WechatAdapter` 中实现。调用方（如 `publish.ts` 的 `verifyTaskPublication`）通过类型判断或接口检测来调用，而不是基类提供空实现。 |

### R4-7 [Suggestion] Speculative Generality: SimpleRpaHandler 模板方法模式使用面窄

| 属性 | 详情 |
|------|------|
| **严重级别** | Suggestion |
| **症状描述** | `SimpleRpaHandler` 是一个使用模板方法模式的基类，提供了标准的"导航→填标题→填内容→加标签→选分类→发布"流程。但代码中只有少数简单平台使用它（sohu, netease, zhidao, baijia, toutiao, bilibili 等），而复杂平台（zhihu, csdn, juejin）直接继承 `RpaHandler`。这个抽象的价值受限于使用范围，且 `SimpleRpaHandler` 本身有 200+ 行代码，增加了继承体系的复杂度。 |
| **涉及文件** | `packages/publisher/src/rpa-handlers/base.ts:253-453` |
| **修复类别** | Residual |
| **具体修复方案** | 对于当前项目规模，保留 `SimpleRpaHandler` 是可接受的——它确实减少了简单平台的重复代码。建议：① 如果未来简单平台数量增长，考虑将模板方法进一步拆分为组合（策略模式 + 步骤组合）② 如果简单平台数量减少，可以考虑内联回各 handler。 |

### R4-8 [Suggestion] Speculative Generality: BrowserFingerprintManager 与 SessionPoolAdapter 中的指纹逻辑重复

| 属性 | 详情 |
|------|------|
| **严重级别** | Suggestion |
| **症状描述** | `packages/publisher/src/browser-fingerprint.ts` 中有一个完整的 `BrowserFingerprintManager` 类（使用 fingerprint-generator + fingerprint-injector 库），但 server 端实际使用的是 `SessionPoolAdapter` 中手写的简化版指纹注入（直接 `addInitScript` 覆盖 navigator 属性）。RPAEngine 中的 `BrowserFingerprintManager` 通过动态 import 懒加载，在远程模式下不会用到。这形成了两套指纹方案——一套完整的（本地 RPA 用）、一套简化的（server adapter 用）。 |
| **涉及文件** | `packages/publisher/src/browser-fingerprint.ts:34-`<br>`apps/server/src/session-pool-adapter.ts:263-294` |
| **修复类别** | Extended-Safe |
| **具体修复方案** | 统一指纹方案：如果本地 RPA 模式是主要使用场景，将 `BrowserFingerprintManager` 作为共享能力，`SessionPoolAdapter` 也使用它；如果远程模式为主，则简化 `browser-fingerprint.ts` 中的完整实现。 |

### R4-9 [Suggestion] Switch 语句: getArticlesPerPlatform 中硬编码的 duration switch

| 属性 | 详情 |
|------|------|
| **严重级别** | Suggestion |
| **症状描述** | `pipeline.ts` 中的 `getArticlesPerPlatform()` 函数用 switch 语句映射 duration 到文章数量：year→1200, half-year→400, quarter→160, default→1。这是典型的"应该用配置/表驱动而不是 switch"的场景——新增 duration 类型需要修改代码。 |
| **涉及文件** | `apps/server/src/routes/pipeline.ts:386-393` |
| **修复类别** | Safe |
| **具体修复方案** | 改为配置表驱动：`const ARTICLES_PER_PLATFORM: Record<string, number> = { year: 1200, 'half-year': 400, quarter: 160 }`。这样新增周期类型只需加一行配置。 |

### R4-10 [Suggestion] Lazy Class: PublicationVerifier 功能单薄

| 属性 | 详情 |
|------|------|
| **严重级别** | Suggestion |
| **症状描述** | `PublicationVerifier` 类（在 `rpa/publication-verifier.ts`）负责发布后验证，但功能非常简单——基本就是检查 URL 是否可访问。这个类存在的价值存疑，因为 RPA 发布的验证在 `routes/publish.ts` 中也有独立实现（`verifyUrlReachability` 函数），API 平台的验证在 adapter 中。 |
| **涉及文件** | `packages/publisher/src/rpa/publication-verifier.ts`<br>`apps/server/src/routes/publish.ts:452-510` |
| **修复类别** | Safe |
| **具体修复方案** | 将 URL 可达性验证逻辑统一到一处：要么在 `PublicationVerifier` 中实现完整的验证逻辑（包括错误指示器检测），要么删除这个类，将验证作为 RPAEngine 中的一个简单辅助方法。目前两边各有一套，功能重叠。 |

---

## R5 - 依赖紊乱 (Dependency Disorder)

> **核心风险**：模块间依赖方向混乱、循环依赖、扇出过高，导致系统难以维护和测试。

### R5-1 [Critical] 循环依赖风险: publisher ↔ shared 通过动态 import 规避

| 属性 | 详情 |
|------|------|
| **严重级别** | Critical |
| **症状描述** | `packages/publisher/src/rpa-engine.ts` 第 13-18 行明确注释："Dynamic import of resolveStorageState to avoid circular dependency issues (shared package is a dependency of publisher)"。publisher 包依赖 shared 包，但 shared 包中的 `storage-state.ts` 可能又需要 publisher 的类型，形成循环依赖。目前通过 `await import('@zemingengine/shared')` 动态导入来规避，这是典型的循环依赖坏味道——用运行时延迟加载掩盖了设计问题。 |
| **涉及文件** | `packages/publisher/src/rpa-engine.ts:13-18` |
| **修复类别** | Extended-Safe |
| **具体修复方案** | 梳理循环依赖的根本原因：① 将 `storage-state.ts` 中的类型移到 shared 包的纯类型层（确保 shared 不反向依赖 publisher）② 或者将 storage state 处理逻辑完全移入 shared 包，publisher 只消费不提供。核心原则：shared 是纯类型/工具包，不应依赖任何业务包。 |

### R5-2 [Warning] 依赖方向违规: session-pool 直接依赖 account-vault（基础设施）

| 属性 | 详情 |
|------|------|
| **严重级别** | Warning |
| **症状描述** | `packages/session-pool/src/pool.ts` 直接从 `@zemingengine/account-vault` 导入 `encrypt/decrypt` 和多个类型（`AccountCredentials`, `BrowserFingerprint`, `PlatformName`, `ProxyConfig`, `SessionState`）。session-pool 是一个业务/领域层组件，而 account-vault 是基础设施层（加密、凭证存储）。按照整洁架构原则，领域层不应依赖基础设施层，应该通过抽象接口依赖。 |
| **涉及文件** | `packages/session-pool/src/pool.ts:17-19` |
| **修复类别** | Extended-Safe |
| **具体修复方案** | 在 session-pool 中定义 `CryptoProvider` 接口和 `CredentialStore` 接口，由 account-vault 实现这些接口并注入。session-pool 只依赖接口，不依赖具体实现。或者更简单的：将加密相关的类型和纯函数移到 shared 包，两个包都从 shared 导入。 |

### R5-3 [Warning] 高扇出: service-container.ts 导入 30+ 模块

| 属性 | 详情 |
|------|------|
| **严重级别** | Warning |
| **症状描述** | `apps/server/src/service-container.ts` 有 30 个 import 语句，导入了 16 个路由、4 个 session-health 组件、2 个中间件、3 个包级依赖（publisher, ai-engine, shared）、2 个数据库相关模块。这个文件是整个 server 的组合根，扇出极高——任何新增路由、新增服务、新增中间件都需要修改这个文件。 |
| **涉及文件** | `apps/server/src/service-container.ts:1-30` |
| **修复类别** | Safe |
| **具体修复方案** | 这是组合根（Composition Root）模式的正常表现，一定程度的高扇出是可接受的。但可以进一步优化：① 按功能分组导入（路由组、服务组、中间件组）② 考虑使用路由自动注册（如扫描 routes 目录自动挂载）③ 服务实例化使用工厂函数减少手动 wiring。 |

### R5-4 [Warning] 重复实现: SessionPool 与 SessionPoolAdapter 功能完全重叠

| 属性 | 详情 |
|------|------|
| **严重级别** | Warning |
| **症状描述** | 存在两个独立的 session pool 实现：① `packages/session-pool/src/pool.ts` 中的 `SessionPool`（完整实现，使用 account-vault 加密，有 loginFn 回调）② `apps/server/src/session-pool-adapter.ts` 中的 `SessionPoolAdapter`（简化实现，直接使用 server 端 db 和加密）。两者实现了几乎完全相同的功能：池管理、指纹注入、WebRTC 防泄漏、Cookie 过滤、LRU 驱逐。`PLATFORM_COOKIE_DOMAINS` 常量在两处重复定义。这是典型的"同功能两套实现"的依赖紊乱——消费者不知道该用哪个。 |
| **涉及文件** | `packages/session-pool/src/pool.ts:48-422`<br>`apps/server/src/session-pool-adapter.ts:71-325` |
| **修复类别** | Extended-Safe |
| **具体修复方案** | 合并为一个实现。如果 server 端是主要使用方，直接删除 `packages/session-pool` 包，保留 `SessionPoolAdapter` 并改名为 `SessionPool`。如果需要在包级别共享，则将 `SessionPoolAdapter` 的逻辑搬到 `packages/session-pool` 中，使其不依赖 server 端的 db，而是通过接口注入。 |

### R5-5 [Warning] 依赖方向违规: content-generator 直接依赖 ai-engine

| 属性 | 详情 |
|------|------|
| **严重级别** | Warning |
| **症状描述** | `packages/content-generator/src/generator.ts` 直接从 `@zemingengine/ai-engine` 导入 `chatCompletion`, `isAIAvailable`, `getActiveModel`。content-generator 是业务逻辑层（内容生成），ai-engine 是基础设施层（AI API 调用封装）。业务层直接依赖基础设施层，违反了依赖倒置原则——AI 服务的切换会直接影响业务层。 |
| **涉及文件** | `packages/content-generator/src/generator.ts:1` |
| **修复类别** | Safe |
| **具体修复方案** | 在 content-generator 中定义 `AIClient` 接口（包含 `chatCompletion`, `isAvailable` 等方法），通过构造函数注入。ai-engine 包实现这个接口。这样 content-generator 只依赖自己定义的抽象，不依赖具体的 AI 实现。 |

### R5-6 [Warning] PLATFORM_COOKIE_DOMAINS 常量在三处重复定义

| 属性 | 详情 |
|------|------|
| **严重级别** | Warning |
| **症状描述** | 平台 cookie 域名白名单在三个地方定义：① `packages/session-pool/src/pool.ts` 中的 `PLATFORM_COOKIE_DOMAINS` ② `apps/server/src/session-pool-adapter.ts` 中的 `PLATFORM_COOKIE_DOMAINS` ③ `packages/shared/src/platform-registry.ts` 中 `PlatformInfo` 的 `domains` 字段。三者内容相似但不完全一致（命名和格式不同），存在漂移风险。 |
| **涉及文件** | `packages/session-pool/src/pool.ts:25-37`<br>`apps/server/src/session-pool-adapter.ts:57-69`<br>`packages/shared/src/platform-registry.ts:53,68-242` |
| **修复类别** | Safe |
| **具体修复方案** | 统一以 `platform-registry.ts` 中的 `domains` 字段为准。session-pool 和 adapter 都从 shared 包的 `getPlatformDomains()` 获取域名列表，删除各自的本地 `PLATFORM_COOKIE_DOMAINS` 常量。 |

### R5-7 [Suggestion] dialogue-engine 与 shared 包边界模糊

| 属性 | 详情 |
|------|------|
| **严重级别** | Suggestion |
| **症状描述** | `packages/dialogue-engine` 和 `packages/shared` 之间的边界不清晰。shared 包中包含了 `SessionData`, `Stage`, `DialogueMessage`, `STAGES`, `EnterpriseProfile` 等大量对话引擎的核心类型定义，而 dialogue-engine 包只包含状态机逻辑和各 stage handler。这导致 shared 包膨胀且职责不清——它既是"共享类型包"又是"对话引擎的类型包"。 |
| **涉及文件** | `packages/shared/src/index.ts:1-421`<br>`packages/dialogue-engine/src/` |
| **修复类别** | Extended-Safe |
| **具体修复方案** | 将对话引擎专属的类型（`SessionData`, `Stage`, `DialogueMessage`, `EnterpriseProfile` 等）移到 `dialogue-engine` 包中定义。shared 包只放真正跨多个包共享的类型（如 `Article`, `PlatformId`, `PublishTask`, `PlatformCredentials` 等发布相关类型）。 |

### R5-8 [Suggestion] 高扇出: pipeline.ts route 导入多个跨领域包

| 属性 | 详情 |
|------|------|
| **严重级别** | Suggestion |
| **症状描述** | `apps/server/src/routes/pipeline.ts` 直接导入了 `ContentGenerator`（内容生成）、`ContentReviewer`（内容审核）、`Publisher`（发布）三个不同领域的包，加上 shared 类型和本地 db 模块。一个路由文件横跨了内容生成、审核、发布三个子域，扇出较宽。 |
| **涉及文件** | `apps/server/src/routes/pipeline.ts:1-17` |
| **修复类别** | Safe |
| **具体修复方案** | 这是 pipeline 路由的固有职责（编排整个流水线），高扇出在一定程度上是合理的。优化方向：引入 `PipelineOrchestrator` 服务类封装跨领域协调逻辑，路由层只依赖 orchestrator，减少直接依赖的包数量。 |

### R5-9 [Suggestion] session-health/checker.ts 依赖具体 DatabaseAccess

| 属性 | 详情 |
|------|------|
| **严重级别** | Suggestion |
| **症状描述** | `session-health/checker.ts` 直接依赖 `DatabaseAccess` 具体类（而不是接口）来操作凭证数据。健康检查模块与具体的存储实现耦合，如果将来更换数据库或增加缓存层，需要修改 checker 代码。 |
| **涉及文件** | `apps/server/src/session-health/checker.ts:2,27` |
| **修复类别** | Safe |
| **具体修复方案** | 定义 `CredentialHealthStore` 接口（包含 `getCredentialsDueForCheck`, `recordHealthCheck`, `getConsecutiveFailures`, `markCredentialExpired` 等方法），checker 只依赖接口。`CredentialRepository` 实现这个接口。 |

### R5-10 [Suggestion] harvester 与 server 之间通过 HTTP 通信但缺乏共享 API 类型

| 属性 | 详情 |
|------|------|
| **严重级别** | Suggestion |
| **症状描述** | harvester 服务（Express/JavaScript）和 server 端（Hono/TypeScript）通过 HTTP 通信（`RPA_REMOTE_URL`），但两端没有共享的 API 类型定义。请求/响应格式靠约定维持，`RemotePublisher.remotePublish()` 中直接构造 JSON body，返回值用 `Partial<PublishResult>` 弱类型接收。如果 harvester 端修改了响应格式，server 端编译时无法发现。 |
| **涉及文件** | `packages/publisher/src/rpa/remote-publisher.ts:41-64`<br>`harvester/server.js` |
| **修复类别** | Extended-Safe |
| **具体修复方案** | 在 shared 包中定义远程发布 API 的请求和响应类型（`RemotePublishRequest`, `RemotePublishResponse`），两端都从 shared 导入。虽然 harvester 是 JS 项目，但可以通过 JSDoc + .d.ts 获得类型提示。 |

---

## R6 - 领域模型失真 (Domain Model Distortion)

> **核心风险**：领域概念被退化为纯数据结构，业务逻辑散落在服务层，导致领域规则分散、重复、难以维护。

### R6-1 [Critical] 贫血领域模型: Article 接口是纯数据结构，行为全在外部

| 属性 | 详情 |
|------|------|
| **严重级别** | Critical |
| **症状描述** | `Article` 接口有 20+ 字段（id, title, contentMarkdown, tags, status, reviewRound, generationRound, publishUrl 等），但没有任何行为方法。所有关于 Article 的业务逻辑都散落在外部：① 状态转换（draft→reviewing→approved→publishing→published/failed）在 route 和 scheduler 中 ② 审核判断在 `ContentReviewer` 中 ③ 字数统计在 `content-generator` 中 ④ 页脚追加在 `article-footer.ts` 中。Article 只是一个被动的数据容器。 |
| **涉及文件** | `packages/shared/src/index.ts:480-506`<br>逻辑散布于 `routes/article.ts`, `routes/pipeline.ts`, `routes/publish.ts`, `scheduler/publish-scheduler.ts` 等 |
| **修复类别** | Extended-Safe |
| **具体修复方案** | 将 Article 从 interface 提升为 class，添加核心领域行为：① `canPublish(): boolean`（是否满足发布条件）② `markAsPublishing()` / `markAsPublished()` / `markAsFailed()`（状态转换，保证状态机合法性）③ `appendFooter(enterpriseInfo)`（页脚追加）④ `needsReview(): boolean`（是否需要审核）。保证 Article 的状态变更只能通过自身方法完成，外部不能直接修改 status 字段。 |

### R6-2 [Critical] 业务逻辑散落: 文章状态转换逻辑散落在 5+ 处

| 属性 | 详情 |
|------|------|
| **严重级别** | Critical |
| **症状描述** | Article 的状态（draft/reviewing/approved/publishing/published/failed/draft_saved/manual_edit）转换逻辑散落在：① `routes/article.ts`（generate 时设为 draft/approved）② `routes/review.ts`（审核后更新状态）③ `routes/publish.ts`（发布时设为 publishing，成功设为 published，失败设为 failed）④ `routes/pipeline.ts`（流水线中的状态更新）⑤ `scheduler/publish-scheduler.ts`（定时发布的状态更新）⑥ `publish-utils.ts`（发布结果处理）。没有集中的状态机定义，状态转换的合法性无法保证。 |
| **涉及文件** | `apps/server/src/routes/article.ts`<br>`apps/server/src/routes/review.ts`<br>`apps/server/src/routes/publish.ts`<br>`apps/server/src/routes/pipeline.ts`<br>`apps/server/src/scheduler/publish-scheduler.ts`<br>`apps/server/src/publish-utils.ts` |
| **修复类别** | Extended-Safe |
| **具体修复方案** | 实现 `ArticleStateMachine` 领域对象，集中定义所有合法的状态转换路径和转换条件。例如：`transitionTo(targetStatus, context)` 方法在转换前检查前置条件（如"只有 approved 状态才能转 publishing"），不合法的转换抛出错误。所有状态变更都通过状态机完成。 |

### R6-3 [Warning] 贫血领域模型: SessionData 巨型数据类

| 属性 | 详情 |
|------|------|
| **严重级别** | Warning |
| **症状描述** | `SessionData` 接口包含 20+ 个字段（enterprise, keywords, wordBank, knowledgeBase, promotionGoal, audienceSegments, keywordStrategy, knowledgePlan, imagePlan, contentPlaybook, trackingPlan, prompts, platforms 等），是一个巨型数据袋子。所有对 session 数据的操作都在 `dialogue-engine` 的各 stage handler 和 server 路由中完成。SessionData 自身没有任何行为方法来验证数据一致性、计算进度、或维护业务规则。 |
| **涉及文件** | `packages/shared/src/index.ts:206-282`<br>操作散布于 dialogue-engine/stages/ 和 routes/ |
| **修复类别** | Extended-Safe |
| **具体修复方案** | ① 将 SessionData 拆分为多个有内聚性的子领域对象（`EnterpriseProfile`, `KeywordStrategy`, `ContentPlaybook` 等），每个子对象有自己的验证和行为方法 ② Session 对象提供整体的进度计算、阶段推进、数据一致性校验等方法。 |

### R6-4 [Warning] Data Class: PlatformCredentials 纯数据结构

| 属性 | 详情 |
|------|------|
| **严重级别** | Warning |
| **症状描述** | `PlatformCredentials` 是纯数据类（platform, accountId, brandId, type, data, status, lastValidatedAt），没有任何行为。凭证的验证逻辑（是否有效、是否过期、认证类型判断）散落在：① `credential-resolver.ts`（判断 active 状态）② `session-health/checker.ts`（健康检查和过期判定）③ `credential-repository.ts`（数据库查询）。凭证自身不知道"我是否有效"、"我是否过期"。 |
| **涉及文件** | `packages/shared/src/index.ts:619-642`<br>逻辑散布于 credential-resolver.ts, session-health/, credential-repository.ts |
| **修复类别** | Safe |
| **具体修复方案** | 为 PlatformCredentials 添加领域方法：① `isActive(): boolean` ② `isExpired(maxAgeMs): boolean` ③ `getAuthType(): 'cookie' | 'api_key' | 'token'` ④ `hasValidCookie(): boolean`。将凭证自身的判断逻辑收敛到领域对象内部。 |

### R6-5 [Warning] 贫血领域模型: PublishTask 无行为的任务数据结构

| 属性 | 详情 |
|------|------|
| **严重级别** | Warning |
| **症状描述** | `PublishTask` 接口有 20+ 字段，但没有任何行为。任务的状态流转（pending→publishing→published/failed/retrying）、重试计数、冷却时间计算等逻辑全部散落在 `publisher.ts`、`publish-scheduler.ts`、`concurrency-controller.ts`、`publish-utils.ts` 等外部模块中。任务自身不知道"我是否可以重试"、"我已经重试了多少次"、"我是否超时"。 |
| **涉及文件** | `packages/shared/src/index.ts:585-608`<br>逻辑散布于 publisher.ts, publish-scheduler.ts, publish-utils.ts |
| **修复类别** | Extended-Safe |
| **具体修复方案** | 将 PublishTask 提升为类，添加：① `canRetry(): boolean`（是否还能重试）② `incrementRetry(): void`（增加重试次数并更新状态）③ `isOverdue(now): boolean`（是否超时）④ `markAsPublishing() / markAsPublished() / markAsFailed()`（状态转换校验）。 |

### R6-6 [Warning] 业务逻辑散落: 审核逻辑在 ContentReviewer 服务而非领域对象中

| 属性 | 详情 |
|------|------|
| **严重级别** | Warning |
| **症状描述** | `ContentReviewer.review()` 包含了完整的审核逻辑：8 个维度的检查、分数计算、加权平均、否决条件判断、内容哈希计算。但这些逻辑都在一个 service 类中，被审核的对象（Article）和审核结果（ReviewResult）都是纯数据结构。当审核规则变复杂时，service 类会越来越膨胀。 |
| **涉及文件** | `packages/content-reviewer/src/reviewer.ts:66-162` |
| **修复类别** | Safe |
| **具体修复方案** | ① 将 `ReviewResult` 提升为类，添加 `isPassing(): boolean`、`getCriticalIssues(): ReviewIssue[]` 等方法 ② 将各维度的检查逻辑从函数改为规则类（`ComplianceRule`, `SEORule` 等），每个规则类负责一个维度的检查 ③ `ContentReviewer` 作为协调者，组合各规则执行审核。 |

### R6-7 [Warning] Data Class: EnterpriseProfile 品牌画像纯数据袋

| 属性 | 详情 |
|------|------|
| **严重级别** | Warning |
| **症状描述** | `EnterpriseProfile` 接口包含 12+ 字段（fullName, shortName, description, scale, location, foundedYear, website, phone, email, address, products, brandStory, trustAnchors, brandTone, userPainPoints），但没有任何行为。品牌画像的完整性校验、必填字段检查、产品列表管理等逻辑全部散落在外部（dialogue-engine 的 stage handler、ai-engine 的 analyzer）。 |
| **涉及文件** | `packages/shared/src/index.ts:26-42` |
| **修复类别** | Suggestion级 |
| **具体修复方案** | 为 EnterpriseProfile 添加领域方法：① `isComplete(): boolean`（关键信息是否完整）② `getPrimaryProduct(): Product | undefined`（获取主打产品）③ `addProduct(product)` / `removeProduct(name)`（产品管理）④ `validate(): string[]`（返回缺失的必填字段列表）。 |

### R6-8 [Suggestion] LSP 潜在违规: SimpleRpaHandler 与 RpaHandler 的 publish 契约差异

| 属性 | 详情 |
|------|------|
| **严重级别** | Suggestion |
| **症状描述** | `SimpleRpaHandler` 继承自 `RpaHandler`，但 `publish()` 方法的行为有微妙差异：① SimpleRpaHandler 的 publish 是模板方法（内部调用多个受保护的步骤方法）② RpaHandler 的 publish 是抽象方法，由子类自由实现 ③ SimpleRpaHandler 的错误处理、截图逻辑、返回结构与直接继承 RpaHandler 的子类（如 ZhihuRpaHandler）不完全一致。如果用 `RpaHandler` 类型引用 `SimpleRpaHandler` 实例，调用方可能假设所有 handler 的行为模式相同，但实际上模板方法的子类行为和直接实现的子类行为有差异。 |
| **涉及文件** | `packages/publisher/src/rpa-handlers/base.ts:48-65,253-430` |
| **修复类别** | Residual |
| **具体修复方案** | 对于当前项目规模，这不是严重问题——SimpleRpaHandler 的契约是兼容的（都返回 PublishResult）。但建议在文档中明确说明：SimpleRpaHandler 提供的是标准流程，复杂平台应直接继承 RpaHandler 并自行实现完整流程。两者的 publish 签名一致，LSP 不被违反——只是内部实现方式不同。 |

### R6-9 [Suggestion] 贫血领域模型: ReviewResult 纯数据结构

| 属性 | 详情 |
|------|------|
| **严重级别** | Suggestion |
| **症状描述** | `ReviewResult` 接口包含 9+ 个字段（articleId, round, passed, overallScore, dimensions, issues, suggestions, reviewedAt, contentHash），但没有任何行为。审核结果的判断（是否通过、哪些是严重问题、有多少改进建议）都需要外部代码来读取字段后自己计算。 |
| **涉及文件** | `packages/shared/src/index.ts:551-570` |
| **修复类别** | Safe |
| **具体修复方案** | 为 ReviewResult 添加便捷方法：① `getHighSeverityIssues(): ReviewIssue[]` ② `getIssuesByDimension(dim): ReviewIssue[]` ③ `isPassing(threshold?): boolean` ④ `hasCriticalIssue(): boolean`。这些方法可以提升代码的可读性和一致性。 |

### R6-10 [Suggestion] Data Class: PipelineRun 流水线运行数据结构

| 属性 | 详情 |
|------|------|
| **严重级别** | Suggestion |
| **症状描述** | `PipelineRun` 是纯数据类（id, sessionId, status, totalArticles, completedArticles, currentPlatform, currentRound, errorMessage, startedAt, completedAt），流水线的状态流转（running→completed/cancelled/failed）、进度计算、取消逻辑都在外部（`routes/pipeline.ts` 的 `executePipeline` 函数和 `activeRuns` Map）。 |
| **涉及文件** | `packages/shared/src/index.ts:700-711`<br>`apps/server/src/routes/pipeline.ts:26-29,82-107,321-384` |
| **修复类别** | Safe |
| **具体修复方案** | 将 PipelineRun 提升为领域对象，添加：① `getProgress(): number`（计算完成百分比）② `canCancel(): boolean`（是否可取消）③ `cancel()`（取消，校验状态）④ `complete()` / `fail(error)`（完成/失败）。将流水线的运行状态管理集中到领域对象内部。 |

---

## 总结

| 风险类别 | Critical | Warning | Suggestion | 总计 |
|---------|----------|---------|------------|------|
| **R2 变更传播** | 2 | 5 | 3 | 10 |
| **R4 偶然复杂度** | 1 | 5 | 4 | 10 |
| **R5 依赖紊乱** | 1 | 5 | 4 | 10 |
| **R6 领域模型失真** | 2 | 4 | 4 | 10 |

**最高优先级修复建议：**

1. **R2-1 / R2-2**（Critical）：发布平台扩展和发布执行逻辑的分散是最大的变更传播风险——每新增一个平台或修改一次发布流程都需要触及 4-7 个文件。
2. **R6-1 / R6-2**（Critical）：Article 状态转换逻辑散落 5+ 处，是最严重的领域模型失真——状态不一致的 bug 难以排查。
3. **R5-1**（Critical）：publisher ↔ shared 的循环依赖是架构债务，用动态 import 掩盖只会让问题越来越深。
4. **R4-1**（Critical）：CSDN 三层 Strategy 模式是最明显的过度设计——三套完整发布流程的维护成本远大于回退收益。
