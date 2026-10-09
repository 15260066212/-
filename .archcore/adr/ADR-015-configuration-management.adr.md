# ADR-015: 配置管理（环境变量 + dotenv + service-container 依赖注入）

**Type:** ADR
**Status:** accepted
**Tags:** architecture, configuration, dependency-injection

## Context

GEO 系统作为多组件 monorepo（server + publisher + AI engine + shared + web），配置需求多样：

- **数据库路径**：SQLite 文件路径需可配置；
- **AI 引擎**：OpenAI API Key、模型选择、是否启用 AI；
- **RPA 引擎**：远程 Harvester URL、LLMWiki 兜底开关、浏览器配置；
- **认证**：是否强制 API Key、加密密钥；
- **调度器**：Cookie 保温间隔、批次大小、Session 巡检间隔；
- **Web 前端**：API 基础 URL、CORS 允许来源；
- **部署环境**：端口、Docker 配置、本地开发 vs 生产。

需要一个统一但轻量的配置管理方案，避免引入重型配置框架的同时保持可维护性。

## Decision

采用**环境变量 + dotenv + service-container 依赖注入**的三层配置管理架构。

### 1. 配置分层

| 层级 | 机制 | 职责 |
|------|------|------|
| **配置源** | `.env` 文件 + 系统环境变量 | 提供配置值 |
| **配置读取** | `process.env` 直接读取 | 各模块按需读取 |
| **配置注入** | `service-container.ts` 集中组装 | 依赖注入到各服务 |

### 2. 环境变量清单

| 变量名 | 默认值 | 说明 | 使用位置 |
|--------|--------|------|----------|
| `PORT` | 3000 | 服务监听端口 | `index.ts` |
| `DATABASE_PATH` | `data/geo.db` | SQLite 数据库路径 | `db.ts` |
| `OPENAI_API_KEY` | - | OpenAI API Key | `ai-engine` |
| `AUTH_REQUIRE_API_KEY` | `false` | 是否强制 API Key 认证 | `middleware/auth.ts` |
| `CREDENTIAL_ENCRYPTION_KEY` | - | 凭证加密密钥 | `credentials` |
| `CORS_ALLOWED_ORIGINS` | `*` | CORS 允许来源（逗号分隔） | `service-container.ts` |
| `RPA_REMOTE_URL` | - | Harvester 服务地址 | `rpa-engine.ts` |
| `RPA_LLMWIKI_FALLBACK` | `true` | LLMWiki 兜底开关 | `rpa-engine.ts` |
| `SESSION_MAX_AGE_HOURS` | 24 | Session 最大有效期 | `session-pool-adapter.ts` |
| `COOKIE_WARMER_INTERVAL_HOURS` | 2 | Cookie 保温间隔 | `cookie-warmer.ts` |
| `COOKIE_WARMER_BATCH_SIZE` | 5 | Cookie 保温批次大小 | `cookie-warmer.ts` |
| `RATE_LIMIT_WINDOW_MS` | 60000 | 速率限制窗口 | `middleware/rate-limit.ts` |
| `RATE_LIMIT_MAX_REQUESTS` | 100 | 窗口内最大请求数 | `middleware/rate-limit.ts` |

### 3. .env 文件管理

| 文件 | 用途 | 版本控制 |
|------|------|----------|
| `.env` | 根目录通用配置 | ❌ gitignore |
| `apps/server/.env` | 服务端本地配置 | ❌ gitignore |
| `apps/server/.env.example` | 配置模板 | ✅ 提交 |
| `.env.docker` | Docker 部署配置 | ✅ 提交 |

**加载方式**：`apps/server/src/index.ts` 首行 `import 'dotenv/config'` 加载 `.env` 文件到 `process.env`。

### 4. service-container 依赖注入

`createServices()` 是整个服务端的核心组装函数：

```
createServices():
  db = CachedDatabaseAccess.create()          // 数据库 + 缓存
  app = new Hono<AppEnv>()                   // Web 框架
  sessionPool = new SessionPoolAdapter(db)     // 会话池
  rpaEngine = new RPAEngine(sessionPool)      // RPA 引擎
  publisher = Publisher.createDefault(rpaEngine)  // 发布门面
  reloginManager = new ReloginManager(db)     // 重登管理
  selectorMonitor = new SelectorMonitor()     // 选择器监控
  captchaManager = new CaptchaManager(db)     // 验证码管理

  // 挂载路由
  app.route('/api/auth', createAuthRoutes(db))
  app.route('/api/articles', createArticleRoutes(db))
  app.route('/api/publish', createPublishRoutes(db, publisher))
  // ...

  // 挂载中间件
  app.use('*', logger())                      // HTTP 日志
  app.use('*', createAuthMiddleware(db))       // 认证
  app.use('*', rateLimit())                    // 速率限制

  return { db, app, publisher, reloginManager, selectorMonitor }
```

### 5. 配置消费模式

各模块通过两种方式获取配置：

**直接读取**（简单值）：
```typescript
const port = Number(process.env.PORT ?? 3000);
const requireApiKey = process.env.AUTH_REQUIRE_API_KEY === 'true';
```

**通过 service-container 注入**（复杂对象）：
```typescript
// service-container.ts 组装
const publisher = Publisher.createDefault(rpaEngine);
publisher.setLogCallback((level, msg, meta) => db.publishLogs.insertLog(...));
```

## Alternatives Considered

### 替代方案 1：配置文件（YAML/JSON）

**描述**：使用 YAML 或 JSON 配置文件替代环境变量。

**否决理由**：环境变量是 12-Factor App 标准，Docker 部署友好；YAML/JSON 需要额外的解析和类型校验逻辑。

### 替代方案 2：Zod schema 验证

**描述**：使用 Zod 定义配置 schema，启动时校验所有环境变量。

**否决理由**：增加构建依赖；当前配置项不多（~15 个），手动校验足够；可后续增量引入。

### 替代方案 3：配置中心（如 Consul）

**描述**：引入配置中心动态管理配置。

**否决理由**：单实例部署不需要动态配置；引入配置中心增加运维成本和外部依赖。

## Consequences

### 正面影响

1. **零依赖**：纯 `process.env` + `dotenv`，无额外配置框架；
2. **Docker 友好**：所有配置通过环境变量传入，容器编排简单；
3. **集中组装**：`service-container.ts` 一处管理所有服务创建和注入；
4. **渐进式**：新配置只需新增环境变量并在使用处读取。

### 负面影响

1. **无类型安全**：`process.env` 返回 `string | undefined`，需手动转换和默认值；
2. **无启动校验**：缺少必填配置的启动时校验（如忘配 `OPENAI_API_KEY` 运行时才报错）；
3. **配置分散**：各模块各自读取 `process.env`，配置消费点散布在多个文件；
4. **无文档生成**：环境变量清单需手动维护。

### 需要跟进的事项

- [ ] 引入 Zod 配置 schema，启动时校验必填项
- [ ] 自动生成 `.env.example` 从 schema
- [ ] 统一配置读取入口（替代各模块直接 `process.env`）

## Superseded when

1. 配置项超过 30 个，手动管理成本过高；
2. 需要运行时动态更新配置（不重启服务）；
3. 多节点部署需要集中配置管理。
