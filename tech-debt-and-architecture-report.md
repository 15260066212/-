# GEO Assistant - 技术债务与架构审计报告

> 审计范围：`apps/`、`packages/`、`harvester/` 目录下所有源文件（排除 node_modules、dist、build、.git）
> 审计日期：2026-10-14

---

## 第一部分：技术债务评估

### 债务总览

| 债务类别 | 数量 | 债务点数估算 |
|---------|------|-------------|
| TODO/FIXME 注释 | 0 条 | 0 |
| 注释掉的代码 | 未发现明显块 | 5 |
| 死代码 / 不可达代码 | 3 处可疑 | 15 |
| 过时/不一致的依赖 | 多处版本不一致 | 20 |
| 命名不一致 | snake_case 泄漏 + 平台命名混乱 | 25 |
| 错误处理缺失 | 3 个空 catch + 多处静默失败 | 20 |
| TypeScript `any` 使用 | 47 处（生产代码约 28 处） | 30 |
| 硬编码配置 | 平台 URL + 魔法数字 + 阈值 | 35 |
| **合计** | | **~150 点** |

> 债务点数说明：1 点约等于 30 分钟的修复工作量。总计约 75 人天的技术债务，属于中等偏高水平。

---

### Top 10 债务项（按影响/努力比排序）

| 排名 | 描述 | 位置 | 债务类型 | 修复等级 | 建议操作 |
|-----|------|------|---------|---------|---------|
| 1 | **前端 planGenerator.ts 包含大量业务逻辑**（1000+ 行：内容类型推断、主题生成、SARM策略、TDK生成、Schema生成） | `apps/web/src/utils/planGenerator.ts` | 领域逻辑泄漏 / 重复实现 | Extended-Safe | 将计划生成逻辑抽取到 `packages/manual-generator` 或新建 `packages/plan-engine`，前后端共用 |
| 2 | **harvester 独立于 monorepo 之外**，有独立 node_modules、Express框架、CommonJS模块、重复的平台配置 | `harvester/` 整个目录 | 架构不一致 / 代码重复 | Residual | 将 harvester 纳入 npm workspaces，统一为 ESM + Hono，平台配置迁移到 shared |
| 3 | **路由层包含大量业务逻辑**（pipeline.ts 423行、article.ts生成-审核循环、publish.ts发布验证逻辑） | `apps/server/src/routes/pipeline.ts`、`article.ts`、`publish.ts` | 层违规 | Extended-Safe | 将业务逻辑抽取到 service 层，路由只负责参数解析和响应格式化 |
| 4 | **平台配置多处重复**（harvester/config/platforms.js vs shared/platform-registry.ts vs publisher内部映射） | `harvester/config/platforms.js`、`packages/shared/src/platform-registry.ts` | 硬编码 / 重复 | Extended-Safe | 统一使用 shared 包的 platform-registry 作为唯一真相源，harvester 改为导入 shared |
| 5 | **account-vault / session-pool 中大量 any 类型**（better-sqlite3 行结果未定义类型） | `packages/account-vault/src/vault.ts`（14处）、`packages/session-pool/src/pool.ts`（13处） | any 类型 | Safe | 为数据库行定义 Row 类型接口，替换 `as any` 强转 |
| 6 | **3 处空 catch 块（静默失败）** + 多处吞掉错误 | `session-pool-adapter.ts:214`、`schema.ts:175-176` | 错误处理缺失 | Safe | 添加错误日志（至少 console.warn），schema 迁移失败应报警 |
| 7 | **依赖版本不一致**（better-sqlite3 v11 vs v12；依赖引用方式混用 file: vs workspace:*） | 各 package.json | 依赖管理 | Safe | 统一 better-sqlite3 版本到 v12，统一使用 `workspace:*` 引用内部包 |
| 8 | **DB snake_case 字段泄漏到 TypeScript 层**（session_id、plan_duration、content_type 等） | `apps/server/src/schema.ts`、`index.ts:45` | 命名不一致 | Extended-Safe | 在 repository 层统一做 snake_case → camelCase 映射，领域层只使用 camelCase |
| 9 | **魔法数字硬编码**（MAX_REGEN_ROUNDS=3、MAX_ROUNDS=3、SESSION_TIMEOUT=10min、ARTICLES_PER_PLATFORM 映射表） | `apps/server/src/routes/article.ts:23`、`pipeline.ts:18/386`、`harvester/config/index.js:17` | 硬编码配置 | Safe | 提取到配置模块或环境变量，集中管理可调参数 |
| 10 | **console.log 泛滥**（server 48处 + packages 13处），无统一日志框架 | 分散在各文件 | 可维护性 | Safe | 引入统一 logger（如 pino），支持日志级别和结构化输出 |

---

### 各类别详细分析

#### 1. TODO/FIXME 注释
- **结果：0 条**
- 整个代码库中未发现任何 TODO、FIXME、HACK、XXX 标记注释
- 这可能是之前 brooks-lint sweep 清理的结果（项目中有 brooks-sweep-report-2026-10-09.md）
- 风险：没有 TODO 标记不代表没有未完成的工作，可能意味着技术债务被"隐藏"而非被记录

#### 2. 注释掉的代码
- 在已审阅的核心文件中未发现大块注释掉的代码
- 代码整体较干净，注释以文档性注释为主

#### 3. 死代码 / 不可达代码
- `apps/server/src/session-pool-adapter.ts:199` 的 `_userDataDir` 私有字段前缀下划线，暗示内部使用但需确认是否真的用到
- `packages/manual-generator` 包的实际使用范围有限，可能部分功能与 content-generator 重叠
- `harvester/check_toutiao_login.js`、`check_xingtu.js`、`check_xt.js` 看起来是临时调试脚本

#### 4. 过时/不一致的依赖
| 问题 | 详情 |
|------|------|
| better-sqlite3 版本不一致 | account-vault v11、session-pool v11、server v12 |
| 依赖引用方式不统一 | 有的用 `file:../shared`，有的用 `workspace:*` |
| harvester 不在 workspaces 中 | 独立 node_modules，重复安装 playwright 等 |
| 框架不一致 | server 用 Hono，harvester 用 Express |
| 模块系统不一致 | 主项目用 ESM，harvester 用 CommonJS |
| SQLite 库不一致 | 主项目用 better-sqlite3，harvester 用 sqlite3 |

#### 5. 命名不一致
- **snake_case 泄漏**：数据库列名（`session_id`、`plan_duration`、`content_type`、`account_id`、`brand_id`、`user_id`）在 schema.ts 和 index.ts 的 scheduled task 中直接使用 snake_case，导致类型安全的领域层和数据库层之间需要手动映射
- **平台命名混乱**：同一平台在不同上下文中有不同名称（如 `weixin` vs `wechat`、`toutiao` vs `toutiaohao`），虽然 shared/platform-registry.ts 已做了统一，但 harvester 中仍有独立的命名系统
- **文件命名**：packages 中普遍为 kebab-case，较一致

#### 6. 错误处理缺失
- **空 catch 块（3 处）**：
  1. `session-pool-adapter.ts:214` — `try { await entry.context.close(); } catch {}` — 关闭 context 失败完全静默
  2. `schema.ts:175` — ALTER TABLE 添加列失败静默（可能是有意的幂等迁移，但应记录日志）
  3. `schema.ts:176` — 同上
- **静默失败的 catch**：
  - `message.ts:171` — AI 验证失败无日志
  - `message.ts:195` — AI 引导生成失败无日志
  - `pipeline.ts:52` — 发布日志写入失败静默（有注释说明但仍应记录 warn）
  - `service-container.ts:82` — 同上

#### 7. TypeScript `any` 使用
总计 **47 处**，分布如下：

| 位置 | 数量 | 分类 |
|------|------|------|
| `packages/account-vault/src/vault.ts` | 14 处 | 数据库行映射（可改进为定义 Row 类型） |
| `packages/session-pool/src/pool.ts` | 13 处 | 浏览器 API / Fingerprint 注入互操作（部分必要） |
| `apps/server` 测试文件 | 18 处 | 测试 mock（可接受） |
| `apps/server/src/index.ts:45` | 1 处 | `task: any` — 应定义 ScheduledTask 类型 |
| `packages/publisher/src/rpa-engine.ts` | 3 处 | fingerprintManager + contextOpts — 应定义类型 |
| `packages/publisher` 测试 | 1 处 | 测试代码（可接受） |

- **必要互操作型**：约 30 处（better-sqlite3 行结果、Playwright 浏览器 API、window 对象扩展）
- **可避免的懒惰型**：约 5-10 处（测试中的 `db as any` 可以用 proper mock type；index.ts 中的 task:any）
- **测试代码**：约 19 处（测试中的快速 mock，可接受但可改进）

#### 8. 硬编码配置
- **平台 URL**：harvester 中有完整的 PLATFORM_URLS、CHECK_URLS、LOGIN_CONFIG 等硬编码（与 shared 包重复）
- **AI API 端点**：ai-engine 中硬编码了 6+ 个 AI 提供商的默认 API URL
- **魔法数字**：
  - `MAX_REGEN_ROUNDS = 3`（article.ts）
  - `MAX_ROUNDS = 3`（pipeline.ts）
  - `SESSION_TIMEOUT = 10 * 60 * 1000`（harvester）
  - `ARTICLES_PER_PLATFORM` 映射表（pipeline.ts）
  - 各处超时值（15000ms URL 验证超时、20000ms 登录超时等）
- **特性标志**：硬编码的 `RPA_FINGERPRINT !== 'false'` 模式（环境变量默认值散落在各处）

---

## 第二部分：架构审计

### 包依赖图（文本形式）

```
                          ┌─────────────────┐
                          │     shared      │  类型定义、平台注册、存储状态工具
                          │  (零内部依赖)    │
                          └────────┬────────┘
                                   │
           ┌───────────┬───────────┼───────────┬───────────┐
           │           │           │           │           │
     ┌─────▼─────┐ ┌───▼─────┐ ┌───▼──────┐ ┌──▼──────┐ ┌──▼──────────┐
     │ ai-engine │ │ scraper │ │ dialogue │ │ account │ │ manual-     │
     │  AI客户端  │ │ 网页抓取 │ │ 对话引擎  │ │  vault  │ │  generator  │
     └─────┬─────┘ └─────────┘ │ (状态机)  │ └───┬─────┘ └─────────────┘
           │                   └───────────┘     │
     ┌─────┴──────┐                              │
     │            │                              │
┌────▼─────┐ ┌────▼──────┐                  ┌───▼───────┐
│ content- │ │ content-  │                  │ session-  │
│ generator│ │ reviewer  │                  │   pool    │
│  内容生成 │ │  内容审核  │                  │ 会话池     │
└──────────┘ └───────────┘                  └─────┬─────┘
                                                  │
                                            ┌─────▼─────┐
                                            │ publisher │
                                            │  发布引擎  │
                                            │ (API+RPA) │
                                            └───────────┘

  apps/server  →  依赖所有 9 个包（聚合根）
  apps/web     →  仅依赖 shared
  harvester    →  完全独立（不在 workspaces 中）
```

**依赖方向验证：**
- shared 不依赖任何业务包 ✅
- 所有包都依赖 shared ✅
- ai-engine 作为中间层被 content-generator/content-reviewer 依赖 ✅
- 无包依赖 apps/server 或 apps/web ✅
- **无循环依赖** ✅

---

### 5 个最重要的架构问题

| 序号 | 问题 | 严重程度 | 修复等级 | 建议操作 |
|-----|------|---------|---------|---------|
| 1 | **Harvester 游离于 monorepo 体系之外** — 独立的 node_modules、Express 框架、CommonJS、重复的平台配置和凭证存储。导致维护成本翻倍，平台信息容易不一致 | 🔴 Critical | Residual | 将 harvester 迁移为 `apps/harvester`，纳入 workspaces；统一为 Hono + ESM；平台配置统一使用 shared 包；凭证存储统一使用 account-vault |
| 2 | **前端包含重量级业务逻辑** — planGenerator.ts (1000+ 行) 包含内容类型推断算法、SARM策略模型、关键词矩阵生成、TDK规范生成、Schema结构化数据生成等纯领域逻辑。这些逻辑应属于后端或共享包，而非前端。与后端逻辑可能产生不一致 | 🔴 Critical | Extended-Safe | 新建 `packages/plan-engine` 包，将所有计划生成逻辑移入；前后端都通过此包调用；消除重复实现的风险 |
| 3 | **路由层承担过多业务逻辑职责** — pipeline.ts 有完整的流水线执行引擎（423行），article.ts 有生成-审核-重生循环，publish.ts 有发布验证逻辑。违反"路由只做 HTTP 适配"的清洁架构原则。导致业务逻辑无法在路由外复用，难以单元测试 | 🟡 Warning | Extended-Safe | 引入 service 层：创建 `PipelineService`、`ArticleService`、`PublishService`；路由层只负责：参数校验 → 调用 service → 格式化响应 |
| 4 | **publisher 包过于庞大（上帝模块）** — 包含 10+ 个 RPA 平台处理器、API 适配器、RPA 引擎、浏览器指纹、LLMWiki 回退、CSDN 多策略模式。单一包内聚了太多不同的职责，单个文件可达数百行 | 🟡 Warning | Extended-Safe | 拆分为：`publisher-core`（核心编排 + 接口定义）、`publisher-rpa`（所有 RPA 处理器）、`publisher-api`（API 平台适配器）。core 包定义接口，rpa 和 api 作为插件式实现 |
| 5 | **session-pool 在 server 中被复制适配** — packages/session-pool 是独立包，但 apps/server 中有 session-pool-adapter.ts（200+ 行），两者职责边界模糊。同时 server 还有 session-health 目录（20+ 文件），与会话管理相关的逻辑分散在三处 | 🟡 Warning | Extended-Safe | 明确 session-pool 的职责边界：如果 session-health 的校验器逻辑属于会话健康管理，应移入 session-pool 包；adapter 模式应简化为直接使用 session-pool 的 API |

---

### 层完整性详细分析

#### 路由层 vs 服务层（违反清洁架构）

**问题严重的路由文件：**

| 文件 | 行数 | 业务逻辑含量 | 典型问题 |
|------|------|-------------|---------|
| `routes/pipeline.ts` | 423 | **高** | 包含 executePipeline 引擎、generateArticleWithRetry 重试逻辑、activeRuns/pipelineFeedback 状态管理、buildArticleList 算法 |
| `routes/publish.ts` | 510 | **高** | 包含 publishArticleAsync 异步发布逻辑、verifyTaskPublication 验证逻辑、verifyUrlReachability URL 可达性检查 |
| `routes/article.ts` | 171 | **中** | 包含生成-审核-重生 3 轮循环逻辑（MAX_REGEN_ROUNDS） |
| `routes/message.ts` | 236 | **中** | 包含 profile 字段确认逻辑、AI 验证编排、系统消息构造 |

**建议：** 引入 service 层后，路由文件应缩减到当前的 1/3 ~ 1/2 大小。

#### 服务层 vs 基础设施层

- `publisher` 包直接依赖 Playwright 和 fingerprint-injector，没有 RPA 抽象接口（虽然有 RpaHandler 基类，但 RPAEngine 直接实例化 Playwright）
- `account-vault` 直接使用 better-sqlite3，无 Repository 接口抽象
- `ai-engine` 中 `ai-platform-service.ts` 做了一定程度的平台抽象，但 client.ts 仍直接依赖 openai SDK

#### 领域逻辑泄漏到前端

- `apps/web/src/utils/planGenerator.ts` — 1036 行，包含：
  - 内容类型推荐算法 (`inferContentTypes`)
  - 话题生成算法 (`generateTopics`)
  - 关键词分组 (`groupKeywords`)
  - SARM 策略生成 (`generateSARMStrategy`)
  - 平台策略生成 (`generatePlatformStrategy`)
  - 行业分类 (`getEnterpriseIndustry`)
  - TDK 规范生成 (`generateTDK`)
  - Schema.org 结构化数据生成 (`generateSchemaJsonLd`)
  - 关键词矩阵生成 (`generateKeywordMatrix`)

这些都是纯业务/领域逻辑，放在前端意味着：
1. 后端无法复用（后端的 optimization-plan 路由可能重复实现）
2. 前后端逻辑可能产生不一致
3. 前端包体积膨胀

---

### 模块边界问题

#### 上帝模块：apps/server
- 18 个路由文件 + 10 个 repository + session-health 子系统（20+ 文件）+ scheduler（7 文件）+ cache + db 层
- `CachedDatabaseAccess` 是一个上帝对象，聚合了 10+ 个 repository
- `service-container.ts` 手动组装所有依赖，缺乏 DI 容器

#### 职责模糊的模块

| 模块 | 问题 |
|------|------|
| `session-pool` vs `session-pool-adapter` | 包内已有 SessionPool，server 中又有 adapter，边界不清 |
| `account-vault` vs `credential-resolver.ts` | account-vault 管存储，resolver 管解析，职责有重叠且分散 |
| `manual-generator` vs `content-generator` | 命名相似，职责边界不明确 |
| `session-health` 子系统 | 20+ 文件放在 server 内，实际是独立的子系统，应考虑提取为包 |

#### Harvester 的架构孤岛

harvester 项目与主项目之间存在**6 重不一致**：
1. 不在 npm workspaces 中 → 依赖重复安装
2. 用 Express vs 主项目用 Hono → 框架不统一
3. 用 CommonJS vs 主项目用 ESM → 模块系统不统一
4. 用 sqlite3 vs 主项目用 better-sqlite3 → 数据库库不统一
5. 平台配置硬编码在本地 vs 主项目有 shared 统一注册 → 数据重复
6. 凭证存 JSON 文件 vs 主项目用 account-vault (SQLite + 加密) → 存储不统一

---

## 总结

### 技术债务评分
- **总债务点数：约 150 点**（~75 人天）
- 债务密度：中等偏高
- 最严重类别：硬编码配置、any 类型、命名不一致
- 最容易修复：空 catch 块、console.log 替换、依赖版本统一

### 架构健康度评分
- **包结构：良好** — 分层清晰，无循环依赖，shared 是干净的基础层
- **层完整性：需改进** — 路由层业务逻辑过重，缺乏明确的 service 层
- **模块边界：需改进** — publisher 过大，harvester 孤立，session 相关逻辑分散
- **最大架构风险：harvester 孤岛 + 前端业务逻辑泄漏**

### 建议优先级
1. **立即处理**（Safe，低风险高收益）：空 catch 加日志、统一 better-sqlite3 版本、替换 console.log
2. **短期规划**（Extended-Safe，1-2 周）：引入 service 层重构路由、account-vault 添加 Row 类型消除 any
3. **中期重构**（Extended-Safe，1-2 月）：planGenerator 抽取为共享包、publisher 拆分
4. **长期架构调整**（Residual，需专项规划）：harvester 纳入 monorepo、session-health 提取为独立包
