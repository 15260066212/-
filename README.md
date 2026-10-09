# GEO-assistant — GEO 实操配置教练

> 通过 6 阶段深度对话，引导企业完成 AI 搜索引擎优化（GEO）的完整配置，从品牌画像到平台策略，一站式生成可落地的配置手册。

[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb)](https://react.dev/)
[![Hono](https://img.shields.io/badge/Hono-4.x-e36002)](https://hono.dev/)
[![pnpm](https://img.shields.io/badge/pnpm-10-f69220)](https://pnpm.io/)
[![Turborepo](https://img.shields.io/badge/Turborepo-latest-ef4444)](https://turbo.build/repo)

---

## 目录

- [背景与定位](#背景与定位)
- [核心流程](#核心流程)
- [功能特性](#功能特性)
- [技术栈](#技术栈)
- [项目架构](#项目架构)
- [快速开始](#快速开始)
- [API 概览](#api-概览)
- [部署指南](#部署指南)
- [许可证](#许可证)

---

## 背景与定位

### 什么是 GEO？

**GEO（Generative Engine Optimization，生成式引擎优化）** 是面向 AI 搜索引擎（如 ChatGPT、Perplexity、Gemini、Kimi、豆包等）的内容优化方法。与传统 SEO 面向搜索引擎爬虫不同，GEO 的目标是让企业的内容在 AI 的生成式回答中被引用和推荐。

### 为什么需要 GEO-assistant？

很多企业知道需要做 GEO，但不知道从何入手。GEO-assistant 通过**结构化引导对话**，一步步帮助企业完成从品牌梳理到平台策略的完整 GEO 配置，最终生成一份可以直接执行的配置手册。

---

## 核心流程

GEO-assistant 通过 **6 个阶段**的深度对话，引导用户完成 GEO 配置：

| 阶段 | 名称 | 说明 |
|------|------|------|
| 1 | **品牌画像** (Profile) | 完善企业基本信息、品牌故事、信任锚点、品牌调性 |
| 2 | **关键词** (Keywords) | 确定核心关键词、长尾词、问题形式、对比词 |
| 3 | **词库** (WordBank) | 自动生成品牌词、产品词、行业词、前缀和后缀 |
| 4 | **知识库** (Knowledge) | 规划知识库文档、图片素材和归类标签 |
| 5 | **提示词** (Prompts) | 基于企业画像和知识库自动生成多平台提示词 |
| 6 | **平台策略** (Platforms) | 基于行业、调性和人群画像自动制定发布策略 |

每阶段采用 **"系统说明 → 逐个提问 → 校验通过 → 推进"** 的步进式交互，一次只问一个问题，确保用户不会感到信息过载。

---

## 功能特性

- **双模式 AI 分析引擎**
  - 规则引擎模式：无需 API Key，基于离线规则完成基础配置
  - LLM 增强模式：接入 OpenAI，提供品牌故事提炼、自然语言问题推测等深度分析
  - 混合模式 (Hybrid)：规则优先，关键节点调用 LLM 增强

- **智能网页抓取**
  - 用户提供官网 URL，自动抓取企业信息
  - 90% 静态页面用 Cheerio 处理，SPA 站点自动 fallback 到 Puppeteer
  - 同一域名 3 秒间隔，24 小时缓存

- **实时配置预览**
  - 对话过程中，右侧边栏实时展示已收集的配置数据
  - 支持导出 JSON 结构化数据

- **手册生成**
  - 配置完成后一键生成可执行的 GEO 配置手册
  - 支持 Markdown 和 HTML 两种格式下载

- **HTTP + SSE 通信**
  - 步进式一问一答，无需 WebSocket，架构更轻量

---

## 技术栈

| 层面 | 技术 | 说明 |
|------|------|------|
| **前端** | React 19 + TypeScript + Vite 6 | 现代 SPA 框架 |
| **样式** | Tailwind CSS 4 | 原子化 CSS，快速构建 UI |
| **状态管理** | Zustand 5 | 轻量级前端状态管理 |
| **后端** | Hono 4 (Node.js) | 超轻量 API 框架，~13KB，支持 Edge Runtime |
| **构建工具** | Turborepo + pnpm workspace | Monorepo 管理，高效依赖管理与并行构建 |
| **网页抓取** | Cheerio + Puppeteer | 双引擎，静态动态页面全覆盖 |
| **AI 引擎** | 规则引擎 + OpenAI SDK | 双模式设计，离线可用 |
| **对话引擎** | XState 状态机 | 6 阶段状态驱动对话流程 |
| **模板渲染** | Handlebars + Marked | 手册生成 |

---

## 项目架构

```
zemingengine-app/
├── apps/
│   ├── web/                     # React SPA 前端应用
│   │   └── src/
│   │       ├── components/      # UI 组件
│   │       ├── stores/          # Zustand 状态管理
│   │       └── hooks/           # API 调用 hooks
│   └── server/                  # Hono BFF + API 服务
│       └── src/
│           ├── routes/          # REST API 路由
│           └── session-store.ts # 会话存储
├── packages/
│   ├── shared/                  # 共享类型定义与常量（所有包的底层依赖）
│   ├── scraper/                 # 网页抓取引擎（Cheerio + Puppeteer）
│   ├── ai-engine/               # AI 分析引擎（规则 + LLM 双模式）
│   ├── dialogue-engine/         # 对话状态机（6 阶段引导式对话）
│   └── manual-generator/        # 手册生成器（Handlebars 模板渲染）
└── scripts/                     # 工具脚本
```

### 架构特点

- **严格的依赖单向性**：`shared` 是底层依赖，所有包都引用它；`scraper`、`ai-engine`、`dialogue-engine`、`manual-generator` 是纯逻辑包，无运行时依赖
- **前端后端解耦**：`web` 仅依赖 `shared` 中的类型定义，通过 REST API 与 server 通信
- **双模式 AI**：无 API Key 也能用，降低使用门槛

### 数据流

```
用户输入 → Web UI → REST API → Server(BFF)
                                  ├→ Scraper（按需抓取官网）
                                  ├→ Dialogue Engine（处理对话逻辑）
                                  ├→ AI Engine（规则/LLM 分析）
                                  └→ Manual Generator（生成手册）
                                  ↓
                            SSE 推送 → Web UI 实时更新
```

---

## 快速开始

### 环境要求

- Node.js >= 22
- pnpm >= 10

### 安装与运行

```bash
# 克隆仓库
git clone https://github.com/clarance2018/GEO-assistant.git
cd GEO-assistant

# 安装依赖
pnpm install

# 启动开发模式（同时启动 web + server）
pnpm dev
```

前端默认运行在 `http://localhost:5174`，API 服务默认运行在 `http://localhost:3000`。

### 配置 LLM 增强模式（可选）

在 `apps/server/.env` 中配置 OpenAI API Key：

```env
OPENAI_API_KEY=sk-your-key-here
```

不配置此选项也不影响基础功能，系统会自动降级为规则引擎模式。

---

## API 概览

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/health` | GET | 健康检查 |
| `/api/session` | POST | 创建新会话 |
| `/api/session/:id` | GET | 获取会话数据 |
| `/api/session/:id/scrape` | POST | 抓取官网信息 |
| `/api/session/:id/message` | POST | 发送对话消息（SSE 响应） |
| `/api/session/:id/manual` | GET | 生成配置手册 |

---

## 部署指南

| 组件 | 推荐平台 | 说明 |
|------|----------|------|
| **前端** (apps/web) | Vercel | 静态站点，零配置部署 |
| **后端** (apps/server) | Railway / Fly.io | 需要支持 Puppeteer 运行环境 |
| **数据库** | PostgreSQL (Neon) | Serverless PostgreSQL |
| **缓存** | Redis (Upstash) | 可选，用于会话缓存 |

---

## 许可证

MIT License

---

<div align="center">
  <sub>Built with ❤️ for the AI search era</sub>
</div>
