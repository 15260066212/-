# ADR-020: Monorepo 工具链（Turborepo + npm Workspaces + Vitest + TypeScript）

**Type:** ADR
**Status:** accepted
**Tags:** architecture, monorepo, tooling, build

## Context

GEO 系统由多个包组成，需要统一的工具链管理代码共享、构建、测试和类型检查。核心需求：

- **多包管理**：10 个内部包（shared、publisher、ai-engine 等）+ 2 个应用（server、web）；
- **代码共享**：`@zemingengine/shared` 的类型和工具被所有包使用，需支持包间引用；
- **构建依赖**：publisher 依赖 shared 的构建产物，server 依赖 publisher 的构建产物；
- **统一工具链**：TypeScript 类型检查、ESLint 代码规范、Prettier 格式化、Vitest 测试需全包统一；
- **开发体验**：本地开发时修改 shared 包后，依赖它的包应自动感知变更；
- **Node 版本**：使用 Node 22+ 的新特性（如 `node --watch`）。

## Decision

采用 **Turborepo + npm Workspaces + Vitest + TypeScript** 的 monorepo 工具链。

### 1. Workspace 配置

根目录 `package.json`：

```json
{
  "workspaces": ["packages/*", "apps/*"],
  "engines": { "node": ">=22.0.0" },
  "packageManager": "npm"
}
```

| 配置项 | 值 | 说明 |
|--------|-----|------|
| `workspaces` | `packages/*`, `apps/*` | npm Workspaces 自动链接内部包 |
| `engines` | `node >= 22.0.0` | 要求 Node 22+ |
| `packageManager` | `npm` | 不使用 pnpm/yarn |

### 2. 包结构

| 包路径 | 名称 | 职责 |
|--------|------|------|
| `packages/shared` | `@zemingengine/shared` | 共享类型、工具函数、平台注册表 |
| `packages/publisher` | `@zemingengine/publisher` | 发布引擎、平台适配器、RPA Handler |
| `packages/ai-engine` | `@zemingengine/ai-engine` | AI 引擎（双模式：OpenAI / 本地） |
| `packages/content-reviewer` | `@zemingengine/content-reviewer` | 内容审核器 |
| `packages/content-generator` | `@zemingengine/content-generator` | 内容生成器 |
| `packages/types` | `@zemingengine/types` | 通用类型定义 |
| `packages/utils` | `@zemingengine/utils` | 通用工具函数 |
| `packages/config` | `@zemingengine/config` | 通用配置 |
| `packages/seo-optimizer` | `@zemingengine/seo-optimizer` | SEO 优化器 |
| `packages/database` | `@zemingengine/database` | 数据库层 |
| `apps/server` | `geo-server` | Hono 服务端 |
| `apps/web` | `geo-web` | Vue 前端 |

### 3. 包间引用

内部包通过 `@zemingengine/` 命名空间引用：

```typescript
// packages/publisher/src/rpa-engine.ts
import type { Article, PlatformId } from '@zemingengine/shared';
import { getSessionPlatformName } from '@zemingengine/shared';
```

- npm Workspaces 自动创建 `node_modules` 符号链接；
- 源码引用通过 `tsconfig.json` 的 `paths` 或直接引用构建产物；
- 构建产物为 `dist/` 目录（`.js` + `.d.ts`）。

### 4. Turborepo 构建流水线

根目录 `package.json` 脚本：

| 命令 | 说明 |
|------|------|
| `npm run dev` | `turbo dev` — 并行启动所有包的 dev 模式 |
| `npm run build` | `turbo build` — 按依赖顺序构建所有包 |
| `npm test` | `vitest run` — 运行所有测试 |
| `npm run typecheck` | `turbo typecheck` — 全量类型检查 |
| `npm run lint` | `turbo lint` — ESLint 检查 |
| `npm run format` | `prettier --write .` — 格式化代码 |

**Turborepo 优势**：

| 特性 | 说明 |
|------|------|
| 增量构建 | 只构建变更的包及其依赖 |
| 缓存 | 构建结果缓存，二次构建秒级完成 |
| 并行 | 无依赖关系的包并行构建 |
| 依赖拓扑 | 自动识别包间依赖，按正确顺序构建 |

### 5. TypeScript 配置

每个包有自己的 `tsconfig.json`，引用共享配置：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "references": [
    { "path": "../shared" }
  ]
}
```

- `tsconfig.base.json`：根目录的通用配置；
- `references`：TypeScript 项目引用，支持增量编译和跨包类型检查。

### 6. Vitest 测试

| 特性 | 配置 |
|------|------|
| 测试框架 | Vitest（Vite 驱动，ESM 原生支持） |
| 测试文件命名 | `*.test.ts` |
| 运行命令 | `npx vitest run`（CI）或 `npx vitest`（watch） |
| 覆盖率 | Vitest 内置 `--coverage` |
| Mock | `vi.fn()`, `vi.mock()` |

测试文件与源码同目录放置，便于查找。

### 7. 代码规范

| 工具 | 用途 | 配置文件 |
|------|------|----------|
| ESLint | 代码规范检查 | `eslint.config.js` |
| Prettier | 代码格式化 | `.prettierrc` |

通过 Turborepo 统一在所有包执行 `lint` 和 `format`。

## Alternatives Considered

### 替代方案 1：pnpm 替代 npm

**描述**：使用 pnpm 作为包管理器，利用其更好的磁盘空间效率。

**否决理由**：npm 22+ 的 Workspaces 已足够好；pnpm 的符号链接策略偶尔导致工具兼容问题；团队已熟悉 npm。

### 替代方案 2：Nx 替代 Turborepo

**描述**：使用 Nx 作为 monorepo 管理工具。

**否决理由**：Nx 配置复杂度高，学习曲线陡；Turborepo 配置极简（`turbo.json` 一行配置），满足需求；Nx 的代码生成能力当前不需要。

### 替代方案 3：Jest 替代 Vitest

**描述**：使用 Jest 作为测试框架。

**否决理由**：Vitest 原生支持 ESM，无需额外配置；与 TypeScript 集成更自然；启动速度比 Jest 快 3-5 倍；API 与 Jest 兼容，迁移成本低。

### 替代方案 4：独立仓库（非 Monorepo）

**描述**：每个包独立仓库，通过 npm 发布共享。

**否决理由**：跨仓库修改需多次发布和版本升级；本地开发调试困难；代码共享成本高。

## Consequences

### 正面影响

1. **代码共享简单**：内部包直接引用，无需发布到 npm registry；
2. **构建高效**：Turborepo 增量构建 + 缓存，二次构建秒级完成；
3. **统一工具链**：所有包共享 TypeScript、ESLint、Prettier、Vitest 配置；
4. **开发体验好**：修改 shared 后，依赖包立即感知（通过 `tsconfig references` 或构建）。

### 负面影响

1. **构建依赖链**：修改 shared 需要重新构建，依赖它的包才能感知变更；
2. **npm 链接偶尔失效**：npm Workspaces 的符号链接偶有问题，需 `npm install` 修复；
3. **Node 22 要求**：限制了部分 CI/CD 环境的使用；
4. **单仓库体积大**：所有代码在一个仓库，clone 和历史记录较大。

### 需要跟进的事项

- [ ] 增加 `turbo.json` 的 task 依赖配置（确保 build 在 test 前完成）
- [ ] 增加 CI/CD 流水线配置（GitHub Actions / Jenkins）
- [ ] 引入 changeset 管理版本发布
- [ ] 增加 `turbo` 远程缓存支持

## Superseded when

1. 包数量超过 20 个，Turborepo 的增量构建管理不够用；
2. 需要多语言 monorepo（如 Rust + TypeScript）；
3. npm Workspaces 的符号链接问题严重影响开发效率。
