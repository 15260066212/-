# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

芯图引擎：GEO 是一个"GEO 实操配置教练"网页应用，通过 6 阶段深度对话引导用户完成 AI 搜索引擎优化（GEO）配置。核心流程：用户提供官网 URL → 自动抓取分析 → 结构化对话补充 → 生成配置手册。

## 技术栈

- **前端**：React 19 + TypeScript + Vite 6 + Tailwind CSS 4 + Zustand（状态管理）
- **后端**：Node.js + TypeScript + Hono（API 框架）
- **Monorepo**：pnpm workspace + Turborepo
- **数据库**：PostgreSQL + Drizzle ORM
- **缓存**：Redis（会话缓存，可选）
- **网页解析**：Cheerio（静态）+ Puppeteer（动态，按需）
- **AI 集成**：规则引擎（离线）+ OpenAI SDK / LLM API（增强模式）
- **文档生成**：Marked + Handlebars

## 常用命令

```bash
# 安装依赖
pnpm install

# 开发模式（同时启动 web + server）
pnpm dev

# 构建所有包
pnpm build

# 运行测试
pnpm test

# Lint 检查
pnpm lint

# 类型检查
pnpm typecheck
```

## Monorepo 结构

```
zemingengine-app/
├── apps/
│   ├── web/                  # React SPA 前端应用
│   └── server/               # Hono BFF + API 服务
├── packages/
│   ├── shared/               # 共享类型定义与常量（所有包的底层依赖）
│   ├── scraper/              # 网页抓取引擎（Cheerio + Puppeteer）
│   ├── ai-engine/            # AI 分析引擎（规则引擎 + LLM 双模式）
│   ├── dialogue-engine/      # 对话状态机（6 阶段引导式对话）
│   └── manual-generator/     # 手册生成器（Handlebars 模板渲染）
```

## 包依赖关系

- `shared` 是底层依赖，所有包都引用它
- `scraper`、`ai-engine`、`dialogue-engine`、`manual-generator` 是纯逻辑包，无运行时依赖
- `server`（BFF）编排所有 packages，对外暴露 REST API
- `web` 仅依赖 `shared` 中的类型定义，与后端完全解耦

## 核心架构要点

### 对话引擎（dialogue-engine）
- 基于 XState 状态机实现 6 阶段对话流程（intro → profile → keywords → wordbank → knowledge → prompts → platforms）
- 采用"结构化引导 + 自由输入"混合模式：每阶段系统先说明再提问，一次只问一个问题
- 校验通过后存入 sessionData，推进到下一个问题

### AI 分析引擎（ai-engine）
- 双模式设计：`rules`（离线规则引擎）/ `llm`（LLM API）/ `hybrid`（混合）
- 规则引擎保证无 API Key 也能完成基础配置
- LLM 作为增强选项，用于品牌故事提炼、自然语言问题推测等

### 网页抓取（scraper）
- 规则优先：90% 静态/SSR 页面用 Cheerio 处理，仅 SPA 站点 fallback 到 Puppeteer
- 同一域名 3 秒间隔，24 小时缓存结果

### API 设计
- RESTful API，核心端点：`/api/session`（会话管理）、`/api/session/:id/scrape`（抓取）、`/api/session/:id/message`（对话）、`/api/session/:id/manual`（手册生成）
- 对话交互使用 HTTP + SSE（非 WebSocket），因为是步进式一问一答

## 部署

- **前端（apps/web）**：Vercel 静态站点
- **后端（apps/server）**：Railway / Fly.io（支持 Puppeteer）
- **Redis**：Upstash
- **PostgreSQL**：Neon（Serverless）

## 关键设计决策

1. Hono 替代 Express：更轻量（~13KB），原生支持 Edge Runtime，与 Vite 生态契合
2. 规则引擎与 LLM 分离：降低使用门槛，避免强依赖外部服务
3. HTTP + SSE 替代 WebSocket：本应用是一问一答的步进式交互，不需要实时双向通信
4. 全 TypeScript 技术栈：消除跨语言调用复杂度
