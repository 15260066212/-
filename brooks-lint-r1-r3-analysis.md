# Brooks-Lint R1-R3 风险扫描报告

**扫描范围**: `apps/server/src` + `apps/web/src` 目录下的 TypeScript/TSX 生产代码（排除 test 文件、node_modules、dist）
**扫描文件总数**: 95 个
**扫描日期**: 2026-09-29

---

## R1: Cognitive Overload (认知过载) — 函数体超过 40 行

**总体发现**: 共 **47** 个函数超过 40 行

### Top 10 最长函数

| 排名 | 行数 | 文件 | 函数名 | 行号 | 类型 | Safe 级别 |
|------|------|------|--------|------|------|-----------|
| 1 | 609 | `apps/server/src/schema.ts` | `initDatabase` | L4 | function | **Safe** |
| 2 | 323 | `apps/server/src/routes/publish.ts` | `createPublishRoutes` | L63 | function | Medium |
| 3 | 270 | `apps/web/src/components/ConfigPreview.tsx` | `ConfigPreview` | L10 | function | **Safe** |
| 4 | 183 | `apps/server/src/routes/review.ts` | `createReviewRoutes` | L9 | function | Medium |
| 5 | 172 | `apps/server/src/routes/competitor-monitor.ts` | `buildMockPptHtml` | L460 | function | **Safe** |
| 6 | 168 | `apps/server/src/routes/cookie-harvester.ts` | `createCookieHarvesterRoutes` | L24 | function | Medium |
| 7 | 161 | `apps/server/src/routes/scrape.ts` | `createScrapeRoutes` | L8 | function | Medium |
| 8 | 160 | `apps/server/src/routes/article.ts` | `createArticleRoutes` | L7 | function | Medium |
| 9 | 159 | `apps/server/src/routes/credentials.ts` | `createCredentialRoutes` | L25 | function | Medium |
| 10 | 158 | `apps/server/src/routes/pipeline.ts` | `createPipelineRoutes` | L29 | function | Medium |

### R1 补充清单 (11-20 名)

| 排名 | 行数 | 文件 | 函数名 | 行号 | Safe 级别 |
|------|------|------|--------|------|-----------|
| 11 | 150 | `routes/competitor-monitor.ts` | `buildRealReportHtml` | L181 | **Safe** |
| 12 | 138 | `web/components/pipeline/PipelineDashboard.tsx` | `PipelineDashboard` | L47 | **Safe** |
| 13 | 132 | `web/components/articles/ReviewReport.tsx` | `ReviewReport` | L51 | **Safe** |
| 14 | 121 | `web/components/layout/AppHeader.tsx` | `AppHeader` | L15 | **Safe** |
| 15 | 115 | `routes/optimization-plan.ts` | `buildPrompt` | L166 | **Safe** |
| 16 | 106 | `scheduler.ts` | `startScheduler` | L351 | Medium |
| 17 | 97 | `routes/import.ts` | `createImportRoutes` | L7 | Medium |
| 18 | 95 | `routes/optimization-plan.ts` | `createOptimizationPlanRoutes` | L9 | arrow / Medium |
| 19 | 90 | `routes/competitor-monitor.ts` | `aggregateResults` | L90 | **Safe** |
| 20 | 79 | `web/components/layout/Sidebar.tsx` | `Sidebar` | L39 | **Safe** |

### R1 Safe 级别判定说明

**Safe（可直接修复，单文件纯本地修改，不影响公共接口）**:
- `initDatabase` (schema.ts): 纯 SQL 表创建逻辑，拆分为 `initSessionTables()` / `initArticleTables()` 等子函数即可，对外接口不变
- `ConfigPreview` (ConfigPreview.tsx): React 组件，可拆分为多个子组件（如 `StageSection` / `PlatformList` 等），props 接口不变
- `buildMockPptHtml` / `buildRealReportHtml` (competitor-monitor.ts): 内部 HTML 构建函数，可提取子函数，对外无影响
- `PipelineDashboard` / `ReviewReport` / `AppHeader` / `Sidebar`: React 组件拆分，纯 UI 层重构
- `buildPrompt` (optimization-plan.ts): 内部 prompt 构建函数，可分段提取
- `aggregateResults` (competitor-monitor.ts): 内部聚合逻辑，可拆分

**Medium（需注意接口影响）**:
- 所有 `createXxxRoutes` 工厂函数: 拆分需要提取内部 route handler，但对外 HTTP API 不变，属于中等风险重构
- `startScheduler` (scheduler.ts): 涉及调度器核心逻辑，拆分需谨慎

---

## R2: Change Propagation (变更传播) — 导入 4 个以上模块的文件

**总体发现**: 共 **31** 个文件导入源 >= 4 个

### Top 10 最高耦合文件

| 排名 | 导入源数 | 命名导入数 | 文件 | 性质 | Safe 级别 |
|------|----------|------------|------|------|-----------|
| 1 | 28 | 32 | `apps/server/src/service-container.ts` | 组合根/DI 容器 | 正常 |
| 2 | 18 | 21 | `apps/server/src/session-health/checker.ts` | 平台校验器聚合 | 正常 |
| 3 | 17 | 39 | `apps/server/src/db.ts` | DB 初始化/仓储聚合 | 正常 |
| 4 | 17 | 31 | `apps/web/src/App.tsx` | 根组件/页面路由 | 正常 |
| 5 | 7 | 13 | `apps/server/src/index.ts` | 应用入口 | 正常 |
| 6 | 7 | 7 | `apps/web/src/components/articles/ArticleDetail.tsx` | 详情页组件 | **Safe** |
| 7 | 6 | 9 | `apps/server/src/routes/scrape.ts` | 业务路由 | Medium |
| 8 | 6 | 13 | `apps/server/src/routes/pipeline.ts` | 业务路由 | Medium |
| 9 | 6 | 7 | `apps/web/src/pages/PipelinePage.tsx` | 页面组件 | **Safe** |
| 10 | 6 | 25 | `apps/web/src/pages/OptimizationPlanPage.tsx` | 页面组件 | **Safe** |

### R2 详细分析

#### 前 4 名属于"预期高耦合"，不是问题

1. **service-container.ts (28 imports)**: 这是 DI 组合根 (Composition Root)，职责就是装配所有依赖。高导入数是其设计本质，**不属于风险**。
2. **session-health/checker.ts (18 imports)**: 导入全部 13 个平台校验器 + 辅助模块。属于注册表/聚合模式，**预期高耦合**。
3. **db.ts (17 imports)**: 导入全部 10 个 repository，属于数据库初始化聚合，**预期高耦合**。
4. **App.tsx (17 imports)**: 根组件导入所有页面和核心 store，**预期高耦合**。

#### 真正需要关注的高耦合文件

| 文件 | 问题 | 建议 | Safe 级别 |
|------|------|------|-----------|
| `ArticleDetail.tsx` (7 imports) | 直接依赖 store、shared 类型、多个子组件、图标库 | 可通过组件封装减少直接依赖 | **Safe** |
| `OptimizationPlanPage.tsx` (6 imports, 25 named) | 从 `lucide-react` 导入 20+ 图标 | 可封装图标组件减少命名导入数 | **Safe** |
| `routes/scrape.ts` (6 imports) | 同时依赖 scraper、ai-engine、shared、session-store、db | 可通过 service 层抽象减少直接依赖 | Medium |
| `routes/pipeline.ts` (6 imports) | 依赖 content-generator、content-reviewer、publisher 等多个包 | 同上，可引入 service 层 | Medium |

---

## R3: Knowledge Duplication (知识重复) — 重复代码模式

### R3-1: Store 层错误处理样板重复 (高优先级)

**涉及文件**: 全部 5 个 zustand store 文件

| 文件 | try/catch 数 | 模式描述 |
|------|-------------|----------|
| `stores/articleStore.ts` | 8 | `set({ loading: true, error: null })` → `try { ... } catch { set({ error: ..., loading: false }) }` |
| `stores/sessionStore.ts` | 7 | 完全相同的模式 |
| `stores/credentialStore.ts` | 4 | 完全相同的模式 |
| `stores/pipelineStore.ts` | 3 | 完全相同的模式 |
| `stores/authStore.ts` | 3 | 直接使用 fetch 而非 useApi，额外重复了 API 调用逻辑 |

**重复模式特征**:
```typescript
// 在每个 async action 中重复出现
set({ loading: true, error: null });
try {
  const result = await request('/api/xxx');
  set({ data: result, loading: false });
} catch (err) {
  set({
    error: err instanceof Error ? err.message : 'xxx失败',
    loading: false,
  });
  throw err; // 有些 throw 有些不 throw，不一致
}
```

**Safe 级别**: **Safe** — 可提取高阶函数 `withLoading(set, actionName, fn)` 封装此模式，不影响 store 对外接口。
**额外发现**: `authStore.ts` 绕过了 `useApi.ts` 的 `request` 封装，直接用 `fetch`，导致 API 调用逻辑（headers 处理、错误解析）重复。应统一使用 `useApi` 的 `request` 函数。

### R3-2: 路由文件结构重复 (中优先级)

**涉及文件**: `apps/server/src/routes/` 下 16 个路由文件

**重复模式**:
- 几乎所有路由文件都遵循 `export function createXxxRoutes(db, ...deps): Hono` 的工厂模式
- 内部每个 route handler 重复 `try/catch + c.json({ success: false, error })` 错误返回模式
- 共 16 个路由文件，50+ 个路由处理器

**Safe 级别**: Medium — 提取通用错误处理中间件或 route wrapper 可减少重复，但需确保所有路由行为一致。

### R3-3: 平台名称列表重复 (中优先级)

**涉及文件**: 多处硬编码平台名称列表

| 文件 | 平台数 | 形式 |
|------|--------|------|
| `routes/optimization-plan.ts` | 10 | 数组硬编码: `'weixin', 'zhihu', 'baijia', 'toutiao', 'csdn', 'juejin', 'xiaohongshu', 'sohu', 'netease', 'zhidao'` |
| `session-health/checker.ts` | 13 | 通过 import 各平台 validator 隐式定义 |
| `scheduler.ts` | 多个 | 平台名称逻辑分散 |
| `session-pool-adapter.ts` | 多个 | 平台名称逻辑分散 |
| `web/components/*` (多处) | 多个 | 前端组件中平台名映射 |

**注意**: `@zemingengine/shared` 包中已有 `PLATFORM_NAMES` 等常量（在 `publish.ts` 中被引用），但部分代码仍在本地硬编码。

**Safe 级别**: **Safe** — 统一从 `@zemingengine/shared` 导入平台常量，不影响逻辑。

### R3-4: Repository 模式重复 (中优先级)

**涉及文件**: `apps/server/src/repositories/` 下 10 个 repository

| 文件 | 行数 | 方法数 |
|------|------|--------|
| `credential-repository.ts` | 600 | 24 |
| `publish-repository.ts` | 276 | 16 |
| `selector-repository.ts` | 276 | 7 |
| `monitor-repository.ts` | 350 | 12 |
| `review-repository.ts` | 163 | 8 |
| `plan-repository.ts` | 128 | 7 |
| `article-repository.ts` | 114 | 6 |
| `session-repository.ts` | 120 | 5 |
| `user-repository.ts` | 70 | 8 |
| `pipeline-repository.ts` | 62 | 4 |

**重复模式**:
- 每个 repository 都有类似的 CRUD 方法模式
- 直接操作 `db.prepare()` / `.get()` / `.all()` / `.run()` 的模式在 10 个文件中重复
- 缺少基础 Repository 基类或通用 query helper

**Safe 级别**: Medium — 引入基类需要修改所有 repository 文件，影响面较大但接口不变。

### R3-5: Session-Health Validator 平台特定文件重复 (低优先级)

**涉及文件**: `apps/server/src/session-health/validators/` 下 13 个文件

| 文件 | 行数 | 说明 |
|------|------|------|
| `harvester-browser.ts` | 136 | 最复杂的通用校验器 |
| `wechat.ts` | 53 | 较复杂的平台校验 |
| `base.ts` | 16 | 基类 |
| `baijia.ts` / `netease.ts` / `sohu.ts` / `toutiao.ts` | 8 | 极简实现 |
| `bilibili.ts` / `csdn.ts` / `juejin.ts` / `xiaohongshu.ts` / `zhidao.ts` / `zhihu.ts` | 5 | 几乎是空壳 |

**分析**: 其中 8 个文件只有 5-8 行，大量是"继承 base 后什么都不做"的空实现。这是策略模式的正常用法，但空壳类过多可能意味着设计过度。

**Safe 级别**: **Safe** — 极简 validator 可通过配置化（如 `{ platform: 'csdn', check: () => true }`）替代类文件。

### R3-6: URL 硬编码重复 (低优先级)

**发现**: 4 个 URL 在 2 个以上文件中重复出现：
- `https://aka.doubaocdn.com/s/DkoTkuKQOD` (竞品监控图标) — `competitor-monitor.ts` + `OptimizationPlanPage.tsx`
- `https://brandlogos.sgp1.digitaloceanspaces.com/png/logos/deepseek-400.png` — 同上
- `https://aka.doubaocdn.com/s/PPg55cnPjq` — 同上
- `https://aka.doubaocdn.com/s/PjIVxqYtuc` — 同上

**分析**: 前后端都硬编码了相同的 CDN 资源 URL。影响不大，但可以统一到 shared 包。

**Safe 级别**: **Safe** — 提取常量即可。

---

## 汇总：可直接修复 (Safe 级别) 的项目清单

### R1 Safe (函数拆分，单文件内部重构)

| 优先级 | 函数 | 行数 | 文件 | 修复方式 |
|--------|------|------|------|----------|
| 高 | `initDatabase` | 609 | `schema.ts` | 按模块拆分为多个 initXxxTables 子函数 |
| 高 | `ConfigPreview` | 270 | `ConfigPreview.tsx` | 拆分为多个子组件 |
| 中 | `buildMockPptHtml` | 172 | `competitor-monitor.ts` | 提取 HTML 段构建函数 |
| 中 | `buildRealReportHtml` | 150 | `competitor-monitor.ts` | 同上 |
| 中 | `PipelineDashboard` | 138 | `PipelineDashboard.tsx` | 拆分子组件 |
| 中 | `ReviewReport` | 132 | `ReviewReport.tsx` | 拆分子组件 |
| 低 | `AppHeader` | 121 | `AppHeader.tsx` | 拆分子组件 |
| 低 | `buildPrompt` | 115 | `optimization-plan.ts` | 分段提取 prompt 模板 |

### R2 Safe (减少依赖，不影响接口)

| 优先级 | 文件 | 问题 | 修复方式 |
|--------|------|------|----------|
| 中 | `OptimizationPlanPage.tsx` | 25 个命名导入 (lucide-react 占多数) | 封装图标组件 |
| 低 | `ArticleDetail.tsx` | 7 个导入源 | 合理，无需急改 |

### R3 Safe (消除重复，不影响公共接口)

| 优先级 | 模式 | 涉及文件数 | 修复方式 |
|--------|------|-----------|----------|
| **高** | Store 错误处理样板重复 | 5 个 store | 提取 `withLoading` 高阶函数 |
| **高** | `authStore` 绕过 `useApi` 直接用 fetch | 1 个 store | 统一使用 `useApi.request` |
| 中 | 平台名称硬编码重复 | 5+ 文件 | 统一从 `@zemingengine/shared` 导入 |
| 中 | CDN URL 硬编码重复 | 4 个 URL | 提取为 shared 常量 |
| 低 | 空壳 validator 文件过多 | 8 个文件 | 配置化替代类继承 |

---

## 修复建议优先级

**第一批 (Quick Wins, 全 Safe)**:
1. `authStore.ts` 改用 `useApi.request` — 消除 API 调用逻辑重复
2. 提取 store 层 `withLoading` 工具函数 — 消除 try/catch 样板
3. 统一平台名称常量来源 — 消除散点硬编码
4. `schema.ts` 的 `initDatabase` 拆分 — 单文件大函数最容易拆分

**第二批 (Safe, 工作量中等)**:
5. `ConfigPreview.tsx` 组件拆分
6. `competitor-monitor.ts` 中 HTML 构建函数拆分
7. CDN URL 常量提取

**第三批 (Medium 风险，需规划)**:
8. 路由层通用错误处理中间件
9. Repository 基类提取
10. Route 工厂函数拆分
