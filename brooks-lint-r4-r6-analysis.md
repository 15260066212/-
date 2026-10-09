# Brooks-Lint R4-R6 风险扫描报告

**扫描范围**: `apps/server/src` + `apps/web/src` 下的生产代码（排除 test 文件、node_modules、dist）
**扫描日期**: 2026-09-29

---

## R4 — Accidental Complexity (偶然复杂度)

### R4.1 只有单一委托方法的中间人类

#### 发现 1：平台 Validator 子类（10 个文件）

**文件列表**：
- `apps/server/src/session-health/validators/zhihu.ts`
- `apps/server/src/session-health/validators/csdn.ts`
- `apps/server/src/session-health/validators/baijia.ts`
- `apps/server/src/session-health/validators/toutiao.ts`
- `apps/server/src/session-health/validators/juejin.ts`
- `apps/server/src/session-health/validators/xiaohongshu.ts`
- `apps/server/src/session-health/validators/bilibili.ts`
- `apps/server/src/session-health/validators/sohu.ts`
- `apps/server/src/session-health/validators/netease.ts`
- `apps/server/src/session-health/validators/zhidao.ts`

**问题描述**：这 10 个类都继承自 `HarvesterBrowserValidator`，每个类只设置了一个 `platform` 常量属性，没有任何额外方法或行为。

**示例代码**（zhihu.ts）：
```typescript
import { HarvesterBrowserValidator } from './harvester-browser.js';

export class ZhihuValidator extends HarvesterBrowserValidator {
  readonly platform = 'zhihu' as const;
}
```

**风险等级**：低 — 代码量小但文件数量多，增加了维护成本和认知负担。10 个文件总共约 50 行代码，却分散在 10 个文件中。

**修复建议**：使用工厂函数或注册表模式替代。例如在 `harvester-browser.ts` 中添加静态工厂方法：
```typescript
static create(platform: PlatformId): HarvesterBrowserValidator { ... }
```
或在 `checker.ts` 中直接用配置数组注册。

---

#### 发现 2：DatabaseAccess 巨型委托门面

**文件**：`apps/server/src/db.ts`

**问题描述**：`DatabaseAccess` 类持有 10 个 repository 实例（`sessionRepo`, `articleRepo`, `publishRepo`, `reviewRepo`, `credentialRepo`, `selectorRepo`, `pipelineRepo`, `monitorRepo`, `userRepo`, `planRepo`），并为每个 repository 的每个方法提供一个**纯委托方法**。总计约 60+ 个方法，全部只是简单地 `return this.xxxRepo.methodName(...)`，没有添加任何额外逻辑。

**示例代码**：
```typescript
insertArticle(article: Article): void {
  this.articleRepo.insertArticle(article);
}

updateArticle(id: string, updates: Partial<Article>): void {
  this.articleRepo.updateArticle(id, updates);
}

getArticle(id: string): Article | undefined {
  return this.articleRepo.getArticle(id);
}
// ... 还有 50+ 个类似的纯委托方法
```

**风险等级**：中 — 虽然门面模式本身合理，但 60+ 个纯委托方法意味着：
1. 每新增一个 repository 方法都要在两处修改（repository + DatabaseAccess）
2. `DatabaseAccess` 变成了上帝类，承担了过多职责
3. 所有路由都直接依赖这个巨型类，增加了耦合

**修复建议**：考虑让路由直接依赖所需的 repository，或使用更细粒度的服务接口。

---

#### 发现 3：db-repositories.ts 纯 re-export 文件

**文件**：`apps/server/src/db-repositories.ts`

**问题描述**：该文件只有 12 行，全部是 export 语句，没有任何实际逻辑或类型定义。

```typescript
export { SessionRepository } from './repositories/session-repository.js';
export { ArticleRepository } from './repositories/article-repository.js';
// ... 共 10 个 repository + 从 db.ts 的 re-export
```

**风险等级**：很低 — Barrel file 是 TS 项目常见模式，但此文件似乎很少被外部使用（大多数文件直接从具体路径 import）。

---

### R4.2 没有实际消费者的"为未来准备"的抽象/接口

#### 发现 4：Validator 接口（types.ts 中定义）

**文件**：`apps/server/src/session-health/types.ts`

**问题描述**：定义了 `Validator` 接口：
```typescript
export interface Validator {
  readonly platform: PlatformId;
  validate(credentials: PlatformCredentials): Promise<ValidationResult>;
}
```

但实际代码中所有 validator 都继承自 `BaseValidator` 抽象类，`checker.ts` 中使用的类型也是 `BaseValidator`（第 26 行 `private validators: Map<PlatformId, BaseValidator>`）。在 server/src 范围内未发现 `Validator` 接口的直接消费者。

**风险等级**：低 — 可能是为外部包预留的接口，但在当前 server 代码中未被使用。

**修复建议**：确认是否有外部包依赖此接口。如果没有，可删除或与 `BaseValidator` 合并。

---

#### 发现 5：session-health/index.ts 中导出的部分类型/类

**文件**：`apps/server/src/session-health/index.ts`

**问题描述**：index.ts 导出了所有 13 个 validator 类和 6 个 manager/service 类。但 `checker.ts` 是直接从具体文件 import 的，`service-container.ts` 也是从 index.ts 只 import 了 4 个类。其余 validator 类通过 index.ts 导出但可能没有外部消费者。

**风险等级**：低 — Barrel file 导出冗余是常见现象，不影响运行时。

---

### R4.3 可以用简单对象替换的过度设计的类

#### 发现 6：平台 Validator 子类（同 R4.1 发现 1）

这些类本质上只是 "platform 名称 + 继承来的 validate 方法"。完全可以用：
- 一个工厂函数 `createHarvesterValidator(platform)`
- 或一个配置注册表 `const VALIDATOR_CONFIGS = [{ platform: 'zhihu', ... }, ...]`

来替代 10 个独立的类文件。

**风险等级**：低

---

## R5 — Dependency Disorder (依赖混乱)

### R5.1 循环依赖

**结论：未发现明确的循环依赖。**

import 关系大致是单向的：
- `routes/*` → `db.ts` → `repositories/*`
- `session-health/*` → `db.ts`
- `service-container.ts` → `routes/*` + `session-health/*` + `db.ts`
- `cached-db.ts` → `db.ts`（继承关系）

唯一需要注意的边缘情况：
- `db.ts` import 了所有 `repositories/*`，而每个 repository 又 import 了 `db.ts` 中的 `DB` 类型。但因为 `DB` 只是 `InstanceType<typeof Database>` 的类型别名，这是类型级别的依赖，不是运行时循环依赖。

---

### R5.2 领域代码直接依赖基础设施

#### 发现 7：所有路由直接依赖 DatabaseAccess（具体类而非接口）

**文件**：`apps/server/src/routes/*.ts`（共 17 个路由文件）

**问题描述**：每个路由文件都直接 import `DatabaseAccess` 具体类（或其类型），并在函数参数中接收 `db: DatabaseAccess`。HTTP 层（routes）直接依赖数据访问层的具体实现，没有通过抽象接口隔离。

**示例**：
```typescript
// routes/publish.ts
import type { AppEnv, DatabaseAccess } from '../db.js';

export function createPublishRoutes(db: DatabaseAccess, publisher: Publisher): Hono<AppEnv> {
  // ... 直接调用 db.getArticle(), db.insertPublishTask() 等
}
```

**风险等级**：中 — 这是典型的"高层依赖低层"而非依赖倒置。导致：
1. 替换数据库实现需要修改所有路由
2. 单元测试需要 mock 整个 DatabaseAccess（60+ 方法）
3. 领域逻辑和持久化细节耦合在一起

---

#### 发现 8：CachedDatabaseAccess 通过继承侵入领域层

**文件**：`apps/server/src/cached-db.ts`

**问题描述**：`CachedDatabaseAccess` 继承自 `DatabaseAccess`，缓存（基础设施关注点）通过继承的方式侵入了数据访问层。这违反了"组合优于继承"和依赖倒置原则。

```typescript
export class CachedDatabaseAccess extends DatabaseAccess {
  private cache: LRUCache;
  // 覆盖读方法添加缓存，覆盖写方法添加失效逻辑
}
```

**风险等级**：中 — 虽然当前实现工作正常，但：
1. 如果未来有其他装饰需求（如审计日志、权限检查），继承链会越来越深
2. `CachedDatabaseAccess` 既是"数据访问"又是"缓存"，违反单一职责

**修复建议**：使用装饰器模式（组合）替代继承，或使用 Proxy 模式。

---

#### 发现 9：业务逻辑类直接依赖 DatabaseAccess

**文件**：
- `apps/server/src/session-health/checker.ts`
- `apps/server/src/session-health/alerter.ts`
- `apps/server/src/session-health/relogin-manager.ts`
- `apps/server/src/session-health/selector-monitor.ts`
- `apps/server/src/session-health/captcha-manager.ts`
- `apps/server/src/scheduler.ts`
- `apps/server/src/session-pool-adapter.ts`

**问题描述**：所有包含业务逻辑的 manager/service 类都直接依赖 `DatabaseAccess` 具体类，并在构造函数中接收 `db: DatabaseAccess`。这些类直接调用 db 的各种方法，而不是通过领域仓储接口。

**示例**：
```typescript
// relogin-manager.ts
export class ReloginManager {
  private db: DatabaseAccess;
  // ...
  async attemptRelogin(platform: string, userId: string = 'user_default') {
    const credential = this.db.getCredential(platform, userId);
    this.db.recordReloginAttempt(...);
    this.db.updateCredentialData(...);
    // ...
  }
}
```

**风险等级**：中高 — 业务逻辑和持久化细节紧密耦合，难以独立测试和演化。

---

### R5.3 高扇出（import 超过 10 个其他模块）

#### 发现 10：service-container.ts — 28 个 import

**文件**：`apps/server/src/service-container.ts`

**import 统计**：28 个 import（2 个第三方包 + 26 个内部模块）
- 第三方：`hono`, `@zemingengine/publisher`, `@zemingengine/shared`, `@zemingengine/ai-engine`
- 内部：db, cached-db, session-pool-adapter, session-health, middleware (2个), routes (16个)

**风险等级**：中 — 这是应用入口/组合根，高扇出是可以预期的。但 16 个路由 import 说明路由数量较多，可以考虑路由自动注册机制。

---

#### 发现 11：session-health/checker.ts — 22 个 import

**文件**：`apps/server/src/session-health/checker.ts`

**import 统计**：约 22 个 import
- 11 个具体 validator 类
- 其他：types, alerter, relogin-manager, db

**风险等级**：中 — 11 个 validator 类的 import 直接导致高扇出。如果采用工厂/注册表模式，import 数量可大幅减少。

---

#### 发现 12：db.ts — 18 个 import

**文件**：`apps/server/src/db.ts`

**import 统计**：约 18 个 import
- 10 个 repository 类
- 加上 better-sqlite3, node 模块, schema, shared 类型

**风险等级**：中 — `DatabaseAccess` 组合了所有 repository，导致此文件 import 数量高。这是"上帝类"的典型特征。

---

#### 发现 13：routes/pipeline.ts — 14 个 import

**文件**：`apps/server/src/routes/pipeline.ts`

**import 统计**：约 14 个 import
- 第三方：`hono`, `@zemingengine/content-generator`, `@zemingengine/content-reviewer`, `@zemingengine/publisher`
- shared 类型：8 个类型
- db 类型

**风险等级**：低 — pipeline 路由本身逻辑复杂（生成-审核-发布全流程），较多 import 属正常。

---

#### 发现 14：App.tsx — 17 个 import（web 端）

**文件**：`apps/web/src/App.tsx`

**import 统计**：约 17 个 import
- 组件：12 个组件
- stores：2 个
- hooks：1 个
- 其他：shared, lucide-react

**风险等级**：低 — 这是应用根组件，高扇出在预期内。

---

## R6 — Domain Model Distortion (领域模型失真)

### R6.1 纯数据类（只有 getter/setter 没有行为）

#### 发现 15：所有 Repository 类都是纯数据访问对象（10 个）

**文件列表**：
- `apps/server/src/repositories/article-repository.ts`
- `apps/server/src/repositories/session-repository.ts`
- `apps/server/src/repositories/publish-repository.ts`
- `apps/server/src/repositories/review-repository.ts`
- `apps/server/src/repositories/credential-repository.ts`
- `apps/server/src/repositories/selector-repository.ts`
- `apps/server/src/repositories/pipeline-repository.ts`
- `apps/server/src/repositories/monitor-repository.ts`
- `apps/server/src/repositories/user-repository.ts`
- `apps/server/src/repositories/plan-repository.ts`

**问题描述**：所有 repository 类都是纯数据访问层，只包含 SQL 操作和数据映射（DB row → domain object），没有任何领域业务逻辑或业务规则。

以 `ArticleRepository` 为例：
- `insertArticle` — 纯写入 + 简单校验（非空、数值范围）
- `updateArticle` — 纯更新
- `getArticle` — 纯读取 + 映射
- `getArticlesBySession` — 纯查询 + 映射
- `getArticlesByStatus` — 纯查询 + 映射
- `mapArticle` — 纯数据转换

**风险等级**：中 — Repository 模式本身是合理的，但这些 repository 只做了 CRUD，没有承载任何领域逻辑。这意味着所有领域逻辑都散落在其他地方。

---

#### 发现 16：领域实体都是纯数据类型

**位置**：领域实体（`Article`, `PublishTask`, `SessionData`, `PlatformCredentials`, `ReviewResult` 等）定义在 `@zemingengine/shared` 包中。

**问题描述**：所有领域对象都是 TypeScript interface/type，没有任何行为方法。例如：
- `Article` 只是数据结构，文章的状态流转（draft → reviewing → approved → publishing → published/failed）完全由外部代码控制
- `PublishTask` 只是数据容器，任务的生命周期管理由外部逻辑处理
- `PlatformCredentials` 没有验证自身状态或刷新自身的能力

**风险等级**：中高 — 典型的贫血领域模型。领域对象只是数据载体，不包含任何业务规则或行为。

---

### R6.2 业务逻辑散落在 service/routes 层而领域对象贫血

#### 发现 17：发布业务逻辑散落在 routes/publish.ts 和 scheduler.ts

**文件**：
- `apps/server/src/routes/publish.ts`
- `apps/server/src/scheduler.ts`

**问题描述**：发布相关的业务逻辑分散在两个文件中，且存在大量重复：

| 逻辑 | routes/publish.ts | scheduler.ts |
|------|-------------------|--------------|
| 凭证解析与 fallback | resolveAccountId + findAlternativeCredential | resolveScheduledCredentials |
| 审核门禁检查 | buildReviewGateError | 内联检查 |
| 发布执行 | publishArticleAsync() | executeScheduledPublish() |
| 错误分类与状态更新 | publishArticleAsync() 内 | executeScheduledPublish() 内 |
| 事务原子性 | publishArticleAsync() 内 | executeScheduledPublish() 内 |

两个函数 `publishArticleAsync` 和 `executeScheduledPublish` 的核心逻辑几乎完全相同（约 60 行重复代码），都是：
1. 获取文章
2. 审核门禁检查
3. 调用 publisher.publishWithRetry
4. 根据结果更新 task + article 状态
5. 错误分类

**风险等级**：中 — 代码重复导致维护成本增加，且发布规则的变更需要修改两处。

---

#### 发现 18：健康检查状态机逻辑在 checker.ts 中

**文件**：`apps/server/src/session-health/checker.ts`

**问题描述**：凭证健康状态机（valid → error → expired → recovered）的状态转换逻辑完全在 `SessionHealthChecker.checkCredential()` 方法中实现，而不是在 `PlatformCredentials` 领域对象上。

状态转换规则包括：
- 检查失败时 consecutive_failures +1
- 连续失败达到 MAX_CONSECUTIVE_FAILURES 时标记为 expired
- 从 expired 恢复为 valid 时触发恢复告警
- 首次失败触发告警

这些都是领域规则，但散落在 service 类的方法中。

**风险等级**：中

---

#### 发现 19：Monitor 图表计算逻辑在路由层

**文件**：`apps/server/src/routes/monitor.ts`

**问题描述**：
- `charts/articles` — 30 天文章时间线计算（在路由处理函数中）
- `charts/publish` — 发布成功率、按平台分组统计（在路由处理函数中）
- `charts/reviews` — 审核评分分布、通过率计算（在路由处理函数中）
- `charts/publish-failures` — 失败类型分类、每日趋势、Top 错误（在路由处理函数中）

这些数据聚合/统计逻辑本质上是**查询/分析领域逻辑**，但直接实现在路由处理函数中。

**对比**：`MonitorRepository` 也有一些统计方法（如 `getPublishFailureAnalysis`, `getReviewStats`），但 `routes/monitor.ts` 又重复实现了一遍类似逻辑。

**风险等级**：中 — 图表统计逻辑应该在 repository 或 service 层，而不是路由层。

---

#### 发现 20：web 端 store 中的业务逻辑（前端贫血模型）

**文件**：
- `apps/web/src/stores/articleStore.ts`
- `apps/web/src/stores/sessionStore.ts`
- `apps/web/src/stores/pipelineStore.ts`
- `apps/web/src/stores/credentialStore.ts`
- `apps/web/src/stores/authStore.ts`

**问题描述**：前端使用 zustand stores，状态管理逻辑都在 store 的 action 函数中。虽然前端的"贫血"和后端含义不同，但也存在类似问题：
- 状态转换逻辑散落在各个 action 中
- 例如 `articleStore` 中，发布后更新文章状态为 'publishing'、删除后自动选中下一篇等逻辑，都直接写在 action 里
- 没有集中的状态机或领域规则

**风险等级**：低 — 前端 store 模式在 React 生态中是常见且合理的。此处仅作记录，不视为主要风险。

---

## Safe 级别可直接修复项汇总

**Safe 级别定义**：单文件/局部修改、纯本地重构、不影响公共接口、风险可控

### 可直接修复（Safe）

| 编号 | 风险类别 | 发现 | 修复方式 | 影响范围 |
|------|----------|------|----------|----------|
| S1 | R4 | 10 个平台 Validator 子类 | 用工厂函数/注册表替代 | 11 个文件（10个 validator + checker.ts）|
| S2 | R4 | Validator 接口无消费者 | 确认后删除 | 1 个文件（types.ts）|
| S3 | R6 | publishArticleAsync 与 executeScheduledPublish 重复代码 | 提取公共发布函数 | 2 个文件（publish.ts, scheduler.ts）|
| S4 | R6 | routes/monitor.ts 中的图表计算逻辑 | 下沉到 MonitorRepository | 2 个文件（monitor.ts 路由 + monitor-repository.ts）|
| S5 | R5 | CachedDatabaseAccess 继承改为组合 | 装饰器模式重构 | 2 个文件（cached-db.ts + 使用方）|

### 详细说明

#### S1：平台 Validator 子类重构（Safe - 需谨慎）
**修改内容**：删除 10 个 validator 子类文件，在 `harvester-browser.ts` 中添加工厂方法或在 `checker.ts` 中用配置注册。
**为什么 Safe**：
- 所有 validator 行为完全相同（都继承 HarvesterBrowserValidator）
- 只改变实例化方式，不改变运行时行为
- 公共接口（BaseValidator 的 validate 方法）不变
**注意**：需要修改 checker.ts 中的 import 和注册逻辑，影响 11 个文件。

#### S2：删除未使用的 Validator 接口（Safe）
**修改内容**：从 types.ts 中删除 `Validator` 接口（需先确认无外部消费者）。
**为什么 Safe**：
- 仅删除类型定义，不影响运行时
- 单文件修改
- 如有外部消费者，编译时会报错

#### S3：提取公共发布逻辑（Safe）
**修改内容**：将 `publishArticleAsync` 和 `executeScheduledPublish` 中的公共逻辑提取为独立函数（如 `executePublishWithResult`）。
**为什么 Safe**：
- 纯代码复用，不改变外部行为
- 函数签名和返回值保持不变
- 两个文件内的局部重构

#### S4：Monitor 图表逻辑下沉（Safe）
**修改内容**：将 `routes/monitor.ts` 中的图表数据计算逻辑移到 `MonitorRepository` 中。
**为什么 Safe**：
- 不改变 API 响应格式
- 路由层只做请求/响应处理，逻辑移到 repository
- 两个文件内的局部重构

#### S5：CachedDatabaseAccess 改为装饰器模式（中等风险，非完全 Safe）
**修改内容**：将继承改为组合，`CachedDatabaseAccess` 持有 `DatabaseAccess` 实例而不是继承它。
**为什么不完全 Safe**：
- `CachedDatabaseAccess` 被当作 `DatabaseAccess` 使用（如 service-container 中）
- 需要引入公共接口（如 `IDatabaseAccess`）
- 影响范围较大（所有使用 db 的地方都需要调整类型）

---

## 总结

| 风险类别 | 发现数量 | 高风险 | 中风险 | 低风险 | Safe 可修复 |
|----------|----------|--------|--------|--------|-------------|
| R4 偶然复杂度 | 6 项 | 0 | 1 | 5 | 2 项 |
| R5 依赖混乱 | 8 项 | 0 | 5 | 3 | 1 项 |
| R6 领域模型失真 | 6 项 | 0 | 5 | 1 | 2 项 |
| **合计** | **20 项** | **0** | **11** | **9** | **5 项** |

**主要结论**：
1. 代码库整体结构较为清晰，没有高风险的架构问题
2. 最突出的问题是**贫血领域模型**（R6）— 业务逻辑散落在 routes 和 service 层，领域对象只是纯数据结构
3. **DatabaseAccess 上帝类**（R4 + R5）是核心耦合点，所有业务逻辑都直接依赖它
4. 10 个平台 Validator 子类是最容易修复的偶然复杂度问题（R4）
5. 发布逻辑在 `publish.ts` 和 `scheduler.ts` 中的重复是最值得修复的代码质量问题（R6）
