# Superpowers 开发流程规范 v1.0

> **适用范围：** 芯图引擎 GEO 系统全团队
> **生效日期：** 2026-09-30
> **维护人：** 技术委员会

---

## 1. 概述

本规范定义了基于 Superpowers 工具链的标准化开发流程，旨在：
- 统一团队开发工作方式，减少沟通成本
- 通过 AI 辅助提升开发效率和代码质量
- 建立可追溯的需求-设计-实现-验证闭环
- 沉淀团队知识，降低新人上手成本

---

## 2. 开发工作流

所有功能开发必须遵循以下六步流程：

```
需求输入 → 头脑风暴 → 方案设计 → 实施计划 → TDD 开发 → 代码审查 → 合并上线
   │          │           │           │          │          │
   │          ▼           ▼           ▼          ▼          ▼
   │      spec-xxx.md  plan-xxx.md  bite-sized  RED→GREEN  brooks-review
   │                                       tasks   ↓REFACTOR
```

### 2.1 需求输入

**触发条件：** 新需求、Bug 修复、技术优化

**输入形式：** Issue / 任务卡片 / 口头需求（需补录）

**验收标准：**
- 需求描述清晰，包含背景、目标、验收标准
- 优先级明确（P0/P1/P2/P3）
- 关联的业务方/产品负责人明确

### 2.2 头脑风暴（Brainstorming）

**工具：** `superpowers:brainstorming`

**输入：** 需求描述

**输出：** 结构化需求分析文档（存放在 `docs/superpowers/specs/YYYY-MM-DD-<feature>-design.md`）

**必须产出的内容：**
1. 问题定义：我们要解决什么问题？
2. 用户故事：作为 X，我想要 Y，以便 Z
3. 功能范围：包含什么 / 不包含什么
4. 技术方案初版：整体架构思路
5. 风险与依赖：可能的技术难点、外部依赖
6. 验收标准：怎么算做完了

**耗时：** 简单需求 15 分钟，复杂需求 1-2 小时

### 2.3 方案设计（Spec）

**工具：** `dev-grill-docs` / `writing-plans` 前置设计

**输入：** 头脑风暴产出

**输出：** 详细设计文档（同 specs 目录，补充技术细节）

**设计文档必须包含：**
- 模块划分与职责边界
- 关键数据结构
- API 接口定义（请求/响应格式）
- 状态流转（如适用）
- 错误处理策略
- 性能考虑

**评审要求：**
- P0 需求：必须 2 人以上评审（含架构组 1 人）
- P1 需求：TL 评审
- P2/P3 需求：同行评审

### 2.4 实施计划（Plan）

**工具：** `superpowers:writing-plans`

**输入：** 通过评审的设计文档

**输出：** 实施计划（存放在 `docs/superpowers/plans/YYYY-MM-DD-<feature>.md`）

**计划格式要求：**
- 遵循 bite-sized 原则，每个任务 2-5 分钟可完成
- 每个任务包含：修改文件列表、具体步骤、验证命令
- TDD 风格：先写测试，再写实现
- 频繁提交，每个任务完成后 commit

### 2.5 TDD 开发

**工具：** `superpowers:test-driven-development` + `superpowers:subagent-driven-development`

**开发循环：**
```
1. 写一个失败的测试（RED）
2. 运行测试，确认失败
3. 写最少的代码让测试通过（GREEN）
4. 运行测试，确认通过
5. 重构代码（REFACTOR）
6. 运行测试，确认重构后仍通过
7. 提交代码
```

**并行开发：**
- 独立的子任务可以通过 `subagent-driven-development` 并行执行
- 每个子任务由独立的 subagent 完成，两阶段审查
- 主控制器负责任务分发和结果整合

### 2.6 代码审查

**工具：** `brooks-lint:brooks-review` + 人工审查

**自动化门禁（CI 自动执行）：**
- Brooks Lint 代码质量扫描（严重问题阻断合并）
- 单元测试通过
- 类型检查通过
- Lint 检查通过
- 测试覆盖率不下降

**人工审查要点：**
- 设计是否符合架构规范
- 边界条件是否处理
- 错误处理是否完善
- 命名是否清晰
- 注释是否必要

---

## 3. 目录结构约定

```
geo-assistant-clean/
├── docs/superpowers/
│   ├── specs/                          # 设计规格文档
│   │   └── YYYY-MM-DD-<feature>-design.md
│   ├── plans/                          # 实施计划
│   │   └── YYYY-MM-DD-<feature>.md
│   ├── adr/                            # 架构决策记录（Archcore 管理）
│   │   └── ADR-XXX-<decision>.md
│   └── workflow.md                     # 本文档
├── .spec-workflow/
│   ├── templates/                      # 文档模板
│   │   ├── product-template.md
│   │   ├── design-template.md
│   │   ├── tech-template.md
│   │   ├── requirements-template.md
│   │   ├── structure-template.md
│   │   └── tasks-template.md
│   └── user-templates/                 # 自定义模板
│       └── README.md
├── apps/
│   ├── server/src/
│   │   ├── routes/                     # 每个路由模块一个文件
│   │   ├── repositories/               # 数据访问层
│   │   ├── middleware/                 # 中间件
│   │   └── session-health/             # 会话健康模块（示例）
│   └── web/src/
│       ├── components/
│       ├── pages/
│       ├── hooks/
│       └── stores/
└── packages/
    ├── shared/                         # 共享类型与常量（最底层）
    ├── ai-engine/                      # AI 分析引擎
    ├── content-generator/              # 内容生成
    ├── content-reviewer/               # 内容审核
    ├── dialogue-engine/                # 对话引擎
    ├── publisher/                      # 发布引擎
    ├── scraper/                        # 网页抓取
    └── ...
```

---

## 4. 命名规范

### 4.1 文件命名

| 类型 | 规范 | 示例 |
|------|------|------|
| 源文件 | kebab-case | `session-health.ts` |
| 测试文件 | 同源文件 + `.test` | `session-health.test.ts` |
| React 组件 | PascalCase | `ArticleList.tsx` |
| 工具函数 | kebab-case | `format-date.ts` |
| 文档 | kebab-case | `session-health-phase1.md` |

### 4.2 Git 提交规范

**格式：**
```
<type>(<scope>): <subject>

<body>

<footer>
```

**Type 类型：**
- `feat`: 新功能
- `fix`: Bug 修复
- `refactor`: 重构（不改变功能）
- `perf`: 性能优化
- `test`: 测试相关
- `docs`: 文档相关
- `chore`: 构建/工具链相关

**示例：**
```
feat(publisher): add dynamic cooldown based on platform health

- Introduce calculateDynamicCooldown() function
- 3 cooldown tiers: 30s (healthy) / 60s (normal) / 120s (cautious)
- Rate limit and captcha trigger extended cooldown

Closes #123
```

---

## 5. 质量门禁

### 5.1 PR 合并条件

所有 PR 必须满足以下条件才能合并：

| 检查项 | 阈值 | 未达标处理 |
|--------|------|-----------|
| Brooks Lint 评分 | ≥ B 级 | 阻断合并 |
| 严重代码坏味道 | 0 个 | 阻断合并 |
| 单元测试 | 全部通过 | 阻断合并 |
| 类型检查 | 通过 | 阻断合并 |
| Lint | 通过 | 阻断合并 |
| 测试覆盖率变化 | 不得下降 | 警告 + 人工审核 |
| 人工审查 | 至少 1 人 approve | 阻断合并 |

### 5.2 代码审查清单

审查者逐项确认：

- [ ] 功能实现符合需求描述
- [ ] 边界条件处理完善（空值、异常、并发）
- [ ] 错误处理策略一致
- [ ] 命名清晰，符合项目规范
- [ ] 无明显性能问题
- [ ] 测试覆盖了核心路径
- [ ] 文档/注释必要且准确
- [ ] 不引入新的技术债务（或已记录）

---

## 6. Superpowers 工具使用指南

### 6.1 可用技能

| 技能 | 触发场景 | 使用频率 |
|------|---------|---------|
| `superpowers:brainstorming` | 新需求启动时 | 每次新功能 |
| `superpowers:writing-plans` | 设计完成后、编码前 | 每次新功能 |
| `superpowers:test-driven-development` | 编码实现阶段 | 每次新功能 |
| `superpowers:subagent-driven-development` | 多任务并行开发 | 复杂功能 |
| `superpowers:receiving-code-review` | 收到审查意见后 | 每次 PR |
| `superpowers:verification-before-completion` | 完成任务前验证 | 每次交付 |
| `brooks-lint:brooks-review` | PR 代码审查 | 每次 PR |
| `brooks-lint:brooks-health` | 定期健康检查 | 每周 |
| `archcore:*` | 架构相关工作 | 按需 |

### 6.2 典型工作流示例

```bash
# 1. 收到新需求，启动头脑风暴
# → 调用 brainstorming，输出 spec 文档

# 2. 设计评审通过后，编写实施计划
# → 调用 writing-plans，输出 plan 文档

# 3. 开始开发（TDD 模式）
# → 调用 test-driven-development
# → 或 subagent-driven-development（多任务并行）

# 4. 完成开发，提交 PR
# → CI 自动运行 brooks-review

# 5. 收到审查意见
# → 调用 receiving-code-review 处理

# 6. 合并前最终验证
# → 调用 verification-before-completion
```

---

## 7. 持续改进

### 7.1 效能度量

每周自动统计以下指标，生成效能周报：

| 指标 | 目标 | 统计方式 |
|------|------|---------|
| 需求交付周期 | ≤ 7 天（P1） | 从需求确认到上线的时间 |
| PR 平均审查时间 | ≤ 4 小时 | PR 创建到首次审查的时间 |
| Brooks Lint 评分趋势 | 持续上升 | 周度健康度扫描 |
| 技术债务趋势 | 持续下降 | 高优先级债务数量 |
| 测试覆盖率 | ≥ 70% | 核心包覆盖率 |

### 7.2 规范更新

- 本规范每季度评审一次
- 团队成员可以随时提出改进建议
- 重大变更需技术委员会审批通过

---

## 附录 A：模板索引

| 模板 | 路径 | 用途 |
|------|------|------|
| 产品需求模板 | `.spec-workflow/templates/product-template.md` | 产品需求文档 |
| 设计文档模板 | `.spec-workflow/templates/design-template.md` | 技术设计文档 |
| 技术方案模板 | `.spec-workflow/templates/tech-template.md` | 技术选型方案 |
| 需求清单模板 | `.spec-workflow/templates/requirements-template.md` | 需求条目化 |
| 结构设计模板 | `.spec-workflow/templates/structure-template.md` | 模块结构设计 |
| 任务拆解模板 | `.spec-workflow/templates/tasks-template.md` | 任务拆解清单 |

---

## 附录 B：相关文档

- [Brooks Lint 健康度报告（最新）](./brooks-health-dashboard-2026-09-30.md)
- [架构决策记录目录](./adr/)
- [任务优先级路线图](../TASK-PRIORITY-ROADMAP.md)
- [CLAUDE.md（项目速查）](../../CLAUDE.md)
