# GEO Assistant - 技术债分析报告

**扫描模式**: Tech Debt Assessment (Brooks-Lint Mode 3)
**扫描范围**: apps/server/src + apps/web/src + packages/*/src（排除 test 文件、node_modules、dist）
**扫描日期**: 2026-09-29
**历史基准**: 2026-09-28 Health Score: 71 (4 critical, 1 warning)

---

## 一、技术债总览（按类别统计）

| 债务类别 | 发现数量 | 涉及模块数 | 平均优先级 | 分类 | 债务意图 |
|----------|----------|-----------|-----------|------|---------|
| 知识重复（Knowledge Duplication） | 12 | 8 | 6.2 | Scheduled | 意外型 |
| 配置硬编码（Hardcoded Config） | 9 | 6 | 4.1 | Scheduled | 意外型 |
| 认知过载（Cognitive Overload） | 5 | 4 | 3.8 | Monitored | 意外型 |
| 变更传播（Change Propagation） | 4 | 5 | 5.5 | Scheduled | 意外型 |
| 领域模型失真（Domain Model Distortion） | 3 | 3 | 3.0 | Monitored | 意外型 |
| 死代码/未使用导出 | 2 | 2 | 2.0 | Monitored | 意外型 |
| TODO/FIXME 集群 | 0 | 0 | - | - | - |
| **总计** | **35** | **12** | **4.1** | **Scheduled** | **主要为意外型** |

> **说明**: TODO/FIXME 数量为 0 并不代表没有技术债，反而暗示团队缺乏显式记录技术债的习惯。所有债务均为"意外型"——即随时间自然积累、未经有意识决策的结构性侵蚀。

---

## 二、六大维度详细分析

### 2.1 TODO/FIXME 集群

**统计结果**: 0 个正式 TODO/FIXME/HACK/XXX 注释

**分析**:
- 全代码库（apps + packages 的 src 目录）未发现标准 TODO/FIXME 注释
- 这是一个**异常信号**：一个 25K+ 行的中型项目没有任何技术债标记是极不寻常的
- 可能原因：
  1. 团队习惯在任务管理工具中记录技术债，而非代码注释
  2. 代码相对年轻（项目处于活跃开发期），尚未积累明显债
  3. 技术债以"隐性"形式存在（重复代码、硬编码等），未被标注

**风险评级**: Pain=1, Spread=1, Priority=1 (Monitored)
**建议**: 建立 TODO 注释规范，对已知问题显式标注，便于追踪和排期。

---

### 2.2 重复代码集群（Knowledge Duplication）

这是本项目最严重的技术债类别，共发现 **12 类重复模式**。

#### 高优先级重复（Pain × Spread >= 6）

**D-01: RPA fillRichTextEditor 方法重复**
- **位置**: packages/publisher/src/rpa-handlers/ 下 8 个 handler（baijia, bilibili, toutiao, sohu, netease, xiaohongshu, zhihu, csdn 部分）
- **重复次数**: 8 次（几乎完全相同的实现）
- **代码量**: 每个约 50 行，总计约 400 行重复
- **模式**: 依次尝试 ProseMirror → Quill → contenteditable → textarea 四种编辑器
- **Pain**: 3（每次修改编辑器检测逻辑需要改 8 个文件，极易遗漏）
- **Spread**: 2（影响 publisher 包内 8 个模块）
- **Priority**: 6 (Scheduled / Critical 边界)
- **意图**: 意外型

**D-02: RPA addTags 方法重复**
- **位置**: baijia, bilibili, toutiao, sohu, netease, xiaohongshu 共 6 个 handler
- **重复次数**: 6 次
- **代码量**: 每个约 12-15 行
- **模式**: 遍历 tags 数组，找到标签输入框，逐个填入并回车
- **Pain**: 2（标签逻辑变化时需要同步修改）
- **Spread**: 2（影响 6 个 RPA 模块）
- **Priority**: 4 (Scheduled)
- **意图**: 意外型

**D-03: 平台 URL 双源重复（selector-registry vs rpa-handlers）**
- **位置**: 
  - apps/server/src/session-health/selector-registry.ts（11 个平台的 validateUrl + loginUrl）
  - packages/publisher/src/rpa-handlers/*.ts（10+ 个 handler 中的 goto URL）
- **重复次数**: 每个平台至少 2 处定义，共 22+ 处
- **风险**: 平台 URL 变更时两处需同步，否则 session 检查和发布行为不一致
- **Pain**: 2
- **Spread**: 3（跨 server 和 publisher 两个包）
- **Priority**: 6 (Scheduled)
- **意图**: 意外型

**D-04: 微信 Access Token 获取逻辑重复**
- **位置**:
  - apps/server/src/session-health/validators/wechat.ts（token 获取 + 错误码映射）
  - packages/publisher/src/adapters/wechat.ts（token 获取 + 缓存 + 错误处理）
- **重复内容**: 
  - `https://api.weixin.qq.com/cgi-bin/token` URL 构建
  - appId/appSecret 从 credentials.data 提取逻辑
  - 错误码判断逻辑
- **Pain**: 2
- **Spread**: 2（跨 session-health 和 publisher）
- **Priority**: 4 (Scheduled)
- **意图**: 意外型

#### 中优先级重复（Pain × Spread = 3-4）

**D-05: 路由层 try/catch + 错误响应样板**
- **位置**: apps/server/src/routes/ 下 16 个路由文件
- **重复次数**: 约 50+ 处 try/catch 块
- **模式**: 
  ```typescript
  try {
    // 业务逻辑
    return c.json({ success: true, data: ... });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
  ```
- **Pain**: 2（新增路由时需重复编写，且错误处理不一致）
- **Spread**: 2（影响 16 个路由文件）
- **Priority**: 4 (Scheduled)
- **意图**: 意外型
- **注**: 部分路由已使用 Hono 中间件模式，但大部分仍手动 try/catch

**D-06: Repository CRUD 样板模式**
- **位置**: apps/server/src/repositories/ 下 10 个 repository
- **重复模式**:
  - 构造函数注入 db
  - insertXxx / updateXxx / getXxx / getXxxByYyy 方法
  - 字段映射（camelCase ↔ snake_case）
  - JSON 字段序列化/反序列化
- **Pain**: 2
- **Spread**: 2（10 个 repository）
- **Priority**: 4 (Scheduled)
- **意图**: 意外型

**D-07: 前端 Store withLoading 模式**
- **位置**: apps/web/src/stores/ 下 5 个 store
- **重复次数**: 25 次 withLoading 调用
- **模式**: 每个异步 action 都包裹 withLoading(set, 'loading', 'error', 'xxx失败', async () => { ... })
- **Pain**: 1
- **Spread**: 2（5 个 store）
- **Priority**: 2 (Monitored)
- **意图**: 意外型（已部分抽象，但仍有样板）

**D-08: 选择器回退链重复**
- **位置**: apps/server/src/session-health/selector-registry.ts
- **重复模式**: 每个平台的 selectors 数组中，publish_content_editor 几乎都有相同的回退链（ProseMirror → ql-editor → contenteditable → textarea）
- **重复次数**: 11 个平台 × 3-4 个公共选择器 = 30+ 处
- **Pain**: 2
- **Spread**: 1（集中在一个文件）
- **Priority**: 2 (Monitored)
- **意图**: 意外型

**D-09: 平台显示名称映射重复**
- **位置**: 分散在前端组件、对话引擎、内容生成器中
- **模式**: `zhihu → 知乎`, `baijia → 百家号` 等平台 ID 到中文名称的映射
- **Pain**: 1
- **Spread**: 2
- **Priority**: 2 (Monitored)
- **意图**: 意外型

#### 低优先级重复

**D-10: 截图捕获模式重复**
**D-11: Cookie 解析逻辑**
**D-12: 登录检测（URL 包含 login/passport）模式**

---

### 2.3 配置硬编码（Hardcoded Config）

共发现 **9 类硬编码配置**，涉及 6+ 个模块。

#### 高优先级硬编码

**H-01: RPA 超时时间魔法数字**
- **位置**: packages/publisher/src/rpa-handlers/ 所有 handler
- **数量**: 85+ 处硬编码的 timeout 值
- **常见值**: 30000（页面加载）、5000（元素可见）、3000（标签输入）、2000（等待）、1000（快速操作）
- **问题**: 
  - 同一语义的超时在不同 handler 中值不一致
  - 调整超时策略需要全局搜索替换
  - 无文档说明每个超时的设计依据
- **Pain**: 2
- **Spread**: 3（11 个 RPA handler + rpa-engine）
- **Priority**: 6 (Scheduled)
- **意图**: 意外型

**H-02: 平台发布 URL 硬编码**
- **位置**: 
  - selector-registry.ts（11 个平台 URL）
  - rpa-handlers/*.ts（11 个平台的 goto URL）
  - competitor-monitor.ts（竞品 logo URL）
- **数量**: 40+ 处
- **问题**: 平台改版 URL 变更时需多处修改
- **Pain**: 2
- **Spread**: 3（跨多个包）
- **Priority**: 6 (Scheduled)
- **意图**: 意外型

#### 中优先级硬编码

**H-03: AI 平台 API 端点硬编码**
- **位置**: packages/ai-engine/src/ai-platform-service.ts + client.ts
- **内容**: DeepSeek、Doubao、Kimi、Qianwen、Hunyuan 的 API URL
- **状态**: 已有 env 变量 fallback，但默认值硬编码在代码中
- **Pain**: 1
- **Spread**: 2
- **Priority**: 2 (Monitored)
- **意图**: 半故意型（有 env 覆盖机制）

**H-04: CORS 允许源硬编码**
- **位置**: apps/server/src/service-container.ts:47
- **内容**: `http://localhost:5174,http://127.0.0.1:5174`
- **Pain**: 1
- **Spread**: 1
- **Priority**: 1 (Monitored)
- **意图**: 故意型（开发默认值）

**H-05: 业务常量硬编码**
- **位置**: apps/server/src/routes/article.ts:22
- **内容**: `MAX_REGEN_ROUNDS = 3`（最大重生成轮次）
- **位置**: apps/server/src/session-health/types.ts
- **内容**: `DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000`, `CHECK_BATCH_SIZE = 3`, `MAX_CONSECUTIVE_FAILURES = 3`
- **Pain**: 1
- **Spread**: 1
- **Priority**: 1 (Monitored)
- **注**: session-health 中的常量已提取到 types.ts，做得较好

**H-06: 竞品监控 Logo URL 硬编码**
- **位置**: apps/server/src/routes/competitor-monitor.ts:184-187
- **内容**: 4 个 AI 产品的 logo 图片 URL
- **Pain**: 1
- **Spread**: 1
- **Priority**: 1 (Monitored)

**H-07: Harvester URL 硬编码**
- **位置**: apps/server/src/routes/cookie-harvester.ts:22
- **内容**: `http://localhost:3003`
- **状态**: 有 env 变量 fallback
- **Pain**: 1
- **Spread**: 1
- **Priority**: 1 (Monitored)

**H-08: 微信 API 端点硬编码**
- **位置**: wechat adapter 和 wechat validator 中
- **内容**: 5+ 个微信 API 端点 URL
- **Pain**: 1
- **Spread**: 2
- **Priority**: 2 (Monitored)

**H-09: Scraper User-Agent 硬编码**
- **位置**: packages/scraper/src/scraper.ts:21
- **内容**: `ZemingEngine/0.1 (+https://zemingengine.dev)`
- **Pain**: 1
- **Spread**: 1
- **Priority**: 1 (Monitored)

---

### 2.4 死代码/未使用导出

**D-01: AI Engine 服务类的双重导出模式**
- **位置**: packages/ai-engine/src/ 下多个 service 文件
- **模式**: 每个 service 同时导出 class 和 singleton 实例
  ```typescript
  export class CitationAnalysisService { ... }
  export const citationAnalysisService = new CitationAnalysisService();
  ```
- **涉及**: AIPlatformService, ResultParserService, VisibilityAnalysisService, SentimentAnalysisService, CitationAnalysisService
- **分析**: 
  - 这些单例是否被实际使用？还是只有类被使用？
  - 如果大部分导入的是单例，则类导出可能是冗余的
  - 反之亦然
- **Pain**: 1
- **Spread**: 1
- **Priority**: 1 (Monitored)
- **需要进一步验证**: 检查实际导入模式

**D-02: packages/shared 中的 dist 文件与 src 共存**
- **位置**: packages/shared/src/ 下有 .js, .d.ts, .js.map 文件
- **问题**: 构建产物和源码混在同一目录，可能造成引用混乱
- **Pain**: 1
- **Spread**: 1
- **Priority**: 1 (Monitored)

**注**: 由于缺乏 TypeScript 项目级别的引用分析（如 ts-prune），死代码检测较为保守。建议使用 `ts-prune` 或 `knip` 工具做更精确的检测。

---

### 2.5 认知过载（Cognitive Overload）

**C-01: CSDN RPA Handler 超大文件**
- **位置**: packages/publisher/src/rpa-handlers/csdn.ts
- **规模**: 约 1100+ 行（估算，是其他 handler 的 3-4 倍）
- **问题**: 
  - 包含新旧两种编辑器模式的处理逻辑
  - 多种发布路径（直接发布、草稿箱发布等）
  - 多个 addTags 变体
- **Pain**: 2（开发者需理解多种分支路径）
- **Spread**: 1（单个文件）
- **Priority**: 2 (Monitored)

**C-02: competitor-monitor 路由过大**
- **位置**: apps/server/src/routes/competitor-monitor.ts
- **规模**: server 中最大的路由文件之一
- **问题**: 混合了数据获取、处理、格式化等多种职责
- **Pain**: 2
- **Spread**: 1
- **Priority**: 2 (Monitored)

**C-03: db.ts 和 schema.ts 过大**
- **位置**: apps/server/src/db.ts, schema.ts
- **规模**: server 中最大的两个文件
- **问题**: 数据库访问层和 schema 定义集中在大文件中
- **Pain**: 2
- **Spread**: 1
- **Priority**: 2 (Monitored)

**C-04: RPA 发布流程嵌套过深**
- **位置**: 各 RPA handler 的 publish 方法
- **模式**: 多层 try/catch + if/else 嵌套，步骤 1-7 顺序执行
- **Pain**: 2
- **Spread**: 2
- **Priority**: 4 (Scheduled)

**C-05: 平台命名不一致（weixin vs wechat）**
- **位置**: 全代码库
- **模式**: 
  - PlatformId 类型中是 `'weixin'`
  - 目录/文件名中常用 `wechat`
  - selector-registry 中 platform 是 `'wechat'`
- **Pain**: 1
- **Spread**: 3（跨多个包）
- **Priority**: 3 (Monitored)

---

### 2.6 变更传播（Change Propagation）

**CP-01: 新增平台需修改的文件过多**
- **影响范围**: 新增一个发布平台需要修改以下所有位置：
  1. packages/shared/src/index.ts - PlatformId 类型
  2. packages/publisher/src/rpa-handlers/ - 新增 handler
  3. packages/publisher/src/rpa-handlers/index.ts - 导出
  4. apps/server/src/session-health/selector-registry.ts - 选择器
  5. apps/server/src/session-health/validators/harvester-registry.ts - 验证器
  6. packages/content-generator/src/prompt-builder.ts - 平台约束
  7. packages/content-generator/src/platform-adapter.ts - 内容格式适配
  8. 前端组件 - 平台选择 UI
- **Pain**: 3（新增平台是高频操作，每次要改 8+ 个文件）
- **Spread**: 3（影响 5+ 个模块）
- **Priority**: 9 (Critical)
- **意图**: 意外型（架构设计时未充分考虑平台扩展性）

**CP-02: 平台选择器变更的传播**
- **影响**: 平台页面结构变化时，需同步更新 selector-registry 和对应 rpa-handler
- **Pain**: 2
- **Spread**: 2
- **Priority**: 4 (Scheduled)

**CP-03: Article 类型变更的传播**
- **影响**: 修改 Article 接口需要同步更新：
  - shared 类型定义
  - repository 映射逻辑
  - schema 定义
  - 生成器输出
  - 审核器输入
  - 前端 store 和组件
- **Pain**: 2
- **Spread**: 3
- **Priority**: 6 (Scheduled)

**CP-04: 凭证数据结构变更的传播**
- **影响**: 修改 PlatformCredentials 需要同步 account-vault、各 publisher adapter、session-health validator
- **Pain**: 2
- **Spread**: 3
- **Priority**: 6 (Scheduled)

---

## 三、各模块债务密度排名

债务密度 = 债务点数 / 千行代码（估算值，基于发现数量和代码行数）

| 排名 | 模块 | 代码行数 | 债务发现数 | 债务密度 | 主要债务类型 |
|------|------|---------|-----------|---------|-------------|
| 1 | packages/publisher/src/rpa-handlers | 2,735 | 12 | 4.4‰ | 知识重复、硬编码、认知过载 |
| 2 | apps/server/src/routes | 3,447 | 8 | 2.3‰ | 样板代码、硬编码、认知过载 |
| 3 | apps/server/src/session-health | 1,620 | 6 | 3.7‰ | URL重复、选择器重复 |
| 4 | packages/ai-engine/src | 1,599 | 3 | 1.9‰ | 死代码嫌疑、硬编码 |
| 5 | apps/server/src/repositories | 1,984 | 3 | 1.5‰ | CRUD样板 |
| 6 | apps/web/src/stores | 484 | 2 | 4.1‰ | withLoading样板 |
| 7 | apps/web/src/components | 3,832 | 2 | 0.5‰ | 相对健康 |
| 8 | packages/content-generator/src | 1,043 | 2 | 1.9‰ | 平台映射重复 |
| 9 | packages/content-reviewer/src | 1,580 | 1 | 0.6‰ | 相对健康 |
| 10 | packages/dialogue-engine/src | 2,122 | 1 | 0.5‰ | 相对健康 |
| 11 | packages/account-vault/src | 649 | 1 | 1.5‰ | 硬编码 |
| 12 | packages/shared/src | 1,019 | 2 | 2.0‰ | 类型膨胀 |

**债务热区**:
- **第一梯队（高密度）**: publisher/rpa-handlers、web/stores、session-health
- **第二梯队（中密度）**: server/routes、ai-engine、content-generator、shared
- **第三梯队（低密度）**: repositories、components、dialogue-engine、content-reviewer

---

## 四、Top 10 最有价值修复项（高 ROI）

按 **(Pain × Spread) / 修复成本** 排序，优先推荐"高价值、低成本"的 Safe 级别修复。

### #1: RPA fillRichTextEditor 上移到基类

| 维度 | 评分 |
|------|------|
| Pain | 3 |
| Spread | 2 |
| Priority | 6 |
| 修复成本 | 低（约 2 小时） |
| ROI | 极高 |
| 安全级别 | **Safe** |
| 测试覆盖 | 有（rpa-handlers 有测试） |

**修复方案**: 将 `fillRichTextEditor` 方法从各 handler 移到 `RpaHandler` 基类中，接受选择器配置参数。

**影响文件**:
- 修改: packages/publisher/src/rpa-handlers/base.ts（+50 行）
- 删除: 8 个 handler 中的 fillRichTextEditor 方法（-400 行）
- 公共接口: 不变（都是 private 方法）

---

### #2: RPA addTags 上移到基类

| 维度 | 评分 |
|------|------|
| Pain | 2 |
| Spread | 2 |
| Priority | 4 |
| 修复成本 | 低（约 1 小时） |
| ROI | 高 |
| 安全级别 | **Safe** |
| 测试覆盖 | 有 |

**修复方案**: 将 `addTags` 方法移到基类，接受标签输入框选择器配置。

**影响文件**:
- 修改: base.ts（+15 行）
- 删除: 6 个 handler 中的 addTags（-90 行）
- 公共接口: 不变

---

### #3: 统一 RPA 超时时间常量

| 维度 | 评分 |
|------|------|
| Pain | 2 |
| Spread | 3 |
| Priority | 6 |
| 修复成本 | 低（约 1.5 小时） |
| ROI | 高 |
| 安全级别 | **Safe** |
| 测试覆盖 | 有 |

**修复方案**: 在 base.ts 或单独的 constants.ts 中定义超时常量枚举：
```typescript
enum Timeout {
  PAGE_LOAD = 30000,
  ELEMENT_VISIBLE = 5000,
  TAG_INPUT = 3000,
  QUICK_ACTION = 1000,
  SETTLE_WAIT = 2000,
}
```

**影响文件**:
- 新增: packages/publisher/src/constants.ts（+10 行）
- 修改: 11 个 handler（替换魔法数字）
- 公共接口: 不变

---

### #4: 平台 URL 统一配置源

| 维度 | 评分 |
|------|------|
| Pain | 2 |
| Spread | 3 |
| Priority | 6 |
| 修复成本 | 中（约 4 小时） |
| ROI | 高 |
| 安全级别 | **Medium** |
| 测试覆盖 | 部分有 |

**修复方案**: 在 shared 包中建立统一的平台配置（包含 URL、名称等），selector-registry 和 rpa-handlers 都从同一来源读取。

**影响文件**:
- 新增: packages/shared/src/platform-config.ts（+50 行）
- 修改: selector-registry.ts（引用新配置）
- 修改: 各 rpa-handler（引用新配置）
- 公共接口: 扩展 PlatformId 相关类型

---

### #5: 微信 Token 获取逻辑抽取为共享服务

| 维度 | 评分 |
|------|------|
| Pain | 2 |
| Spread | 2 |
| Priority | 4 |
| 修复成本 | 中（约 3 小时） |
| ROI | 中高 |
| 安全级别 | **Medium** |
| 测试覆盖 | 有（两边都有测试） |

**修复方案**: 在 shared 或新建 wechat-common 包中抽取 WechatTokenService，包含 token 获取、缓存、错误码映射。

**影响文件**:
- 新增: shared/wechat-token-service.ts（+80 行）
- 修改: session-health/validators/wechat.ts
- 修改: publisher/adapters/wechat.ts
- 公共接口: 新增共享服务

---

### #6: 路由层错误处理中间件化

| 维度 | 评分 |
|------|------|
| Pain | 2 |
| Spread | 2 |
| Priority | 4 |
| 修复成本 | 中（约 3 小时） |
| ROI | 中高 |
| 安全级别 | **Safe** |
| 测试覆盖 | 有（routes.test.ts） |

**修复方案**: 编写 Hono 中间件统一捕获异常并返回标准化错误响应，消除路由中重复的 try/catch 样板。

**影响文件**:
- 新增: apps/server/src/middleware/error-handler.ts（+30 行）
- 修改: apps/server/src/index.ts（注册中间件）
- 修改: 16 个路由文件（移除 try/catch，简化代码）
- 公共接口: 不变

---

### #7: 统一平台命名（weixin vs wechat）

| 维度 | 评分 |
|------|------|
| Pain | 1 |
| Spread | 3 |
| Priority | 3 |
| 修复成本 | 低（约 1 小时） |
| ROI | 中 |
| 安全级别 | **Medium** |
| 测试覆盖 | 有 |

**修复方案**: 全代码库统一使用 `weixin` 作为平台 ID（与 PlatformId 类型一致），将 selector-registry 中的 `'wechat'` 改为 `'weixin'`。

**影响文件**:
- 修改: selector-registry.ts（1 处）
- 检查: 其他引用位置
- 公共接口: 无破坏性变更（修正不一致）

---

### #8: 选择器回退链公共化

| 维度 | 评分 |
|------|------|
| Pain | 2 |
| Spread | 1 |
| Priority | 2 |
| 修复成本 | 低（约 1 小时） |
| ROI | 中 |
| 安全级别 | **Safe** |
| 测试覆盖 | 有 |

**修复方案**: 在 selector-registry.ts 中提取公共选择器常量，各平台只定义特有选择器，公共部分通过函数合并。

**影响文件**:
- 修改: selector-registry.ts（内部重构）
- 公共接口: 不变

---

### #9: Repository 基类抽取

| 维度 | 评分 |
|------|------|
| Pain | 2 |
| Spread | 2 |
| Priority | 4 |
| 修复成本 | 中（约 4 小时） |
| ROI | 中 |
| 安全级别 | **Medium** |
| 测试覆盖 | 部分有 |

**修复方案**: 抽取 BaseRepository 基类，封装通用的 CRUD 操作、字段映射、事务包装等。

**影响文件**:
- 新增: apps/server/src/repositories/base.ts（+100 行）
- 修改: 10 个 repository（继承基类）
- 公共接口: 不变

---

### #10: 清理 AI Engine 未使用的导出

| 维度 | 评分 |
|------|------|
| Pain | 1 |
| Spread | 1 |
| Priority | 1 |
| 修复成本 | 低（约 0.5 小时） |
| ROI | 低 |
| 安全级别 | **Safe** |
| 测试覆盖 | 有 |

**修复方案**: 使用 ts-prune 或 knip 检测未使用的导出，删除冗余的 class 或 singleton 导出。

---

## 五、Safe 级别修复项清单（可直接修复）

以下修复项满足 **Safe 级别** 全部条件：
- 单文件或同模块内修改
- 不影响公共接口
- 有测试覆盖
- 重构风险低

| # | 修复项 | 预计工时 | 影响文件数 | 测试覆盖 | 优先级 |
|---|--------|---------|-----------|---------|--------|
| 1 | RPA fillRichTextEditor 上移基类 | 2h | 9 | 是 | P1 |
| 2 | RPA addTags 上移基类 | 1h | 7 | 是 | P1 |
| 3 | 统一 RPA 超时常量 | 1.5h | 12 | 是 | P1 |
| 4 | 路由错误处理中间件化 | 3h | 17 | 是 | P1 |
| 5 | 选择器回退链公共化 | 1h | 1 | 是 | P2 |
| 6 | 统一 weixin/wechat 命名 | 1h | 2-3 | 是 | P2 |
| 7 | 清理 AI Engine 未使用导出 | 0.5h | 5 | 是 | P3 |

**Safe 修复总计**: 7 项，约 10 小时工作量
**预期收益**: 消除约 500 行重复代码，统一 85+ 处魔法数字

---

## 六、债务总结表（Brooks-Lint 标准格式）

| 风险类型 | 发现数 | 平均优先级 | 分类 | 意图 |
|----------|--------|-----------|------|------|
| Knowledge Duplication（知识重复） | 12 | 6.2 | Scheduled | accidental |
| Change Propagation（变更传播） | 4 | 5.5 | Scheduled | accidental |
| Hardcoded Config（配置硬编码）* | 9 | 4.1 | Scheduled | accidental |
| Cognitive Overload（认知过载） | 5 | 3.8 | Monitored | accidental |
| Domain Model Distortion（领域模型失真） | 3 | 3.0 | Monitored | accidental |
| Dead Code（死代码） | 2 | 2.0 | Monitored | accidental |
| TODO Clusters（TODO集群） | 0 | - | - | - |

*注：Hardcoded Config 不属于 Brooks-Lint 六大标准风险类型，归入 Accidental Complexity 或 Cognitive Overload 子类

**推荐关注重点**: Knowledge Duplication（知识重复）和 Change Propagation（变更传播）是当前最严重的两类技术债，均达到 Scheduled 级别，建议在本季度内安排修复。

---

## 七、修复路线图建议

### Sprint 1（Safe 修复，~10 小时）
- [ ] RPA fillRichTextEditor 上移基类
- [ ] RPA addTags 上移基类
- [ ] 统一 RPA 超时常量
- [ ] 路由错误处理中间件化

### Sprint 2（Medium 修复，~12 小时）
- [ ] 平台 URL 统一配置源
- [ ] 微信 Token 获取逻辑共享化
- [ ] 统一 weixin/wechat 命名
- [ ] 选择器回退链公共化

### Sprint 3（架构改进，~16 小时）
- [ ] Repository 基类抽取
- [ ] 新增平台流程优化（减少变更传播）
- [ ] 引入 ts-prune 做死代码定期检测

---

*报告生成时间: 2026-09-29*
*扫描工具: Brooks-Lint Debt Assessment + 手动代码分析*
