# ADR-016: 数据库迁移与 Schema 版本管理（SQLite + 版本号迁移 + WAL 模式）

**Type:** ADR
**Status:** accepted
**Tags:** architecture, database, migration, sqlite

## Context

GEO 系统基于 SQLite 提供数据持久化，数据库 Schema 随功能迭代持续演进。核心挑战：

- **Schema 变更频繁**：从 v1 到 v18 共 18 次迁移，涉及建表、加列、新增审核维度等；
- **SQLite 限制**：SQLite 不支持 `DROP COLUMN`、`ALTER COLUMN` 等复杂 DDL，迁移手段有限；
- **向后兼容**：已有部署需要平滑升级，不能要求用户清空数据库；
- **多表关联**：articles、publish_tasks、credentials、users、health_alerts 等表之间有外键关联；
- **开发与生产同步**：开发者本地数据库需要与生产保持一致的 Schema 版本。

## Decision

采用**版本号驱动的迁移机制**，通过 `schema_version` 表记录迁移版本，按版本顺序执行增量迁移。

### 1. 数据库初始化

`initDatabase(db)` 在创建数据库连接后执行：

```typescript
db.pragma('journal_mode = WAL');      // Write-Ahead Logging 提升并发读性能
db.pragma('foreign_keys = ON');        // 启用外键约束
```

| PRAGMA | 作用 |
|--------|------|
| `journal_mode = WAL` | WAL 模式，读写不互斥，提升并发性能 |
| `foreign_keys = ON` | 启用外键约束，确保数据完整性 |

### 2. 版本号迁移机制

**迁移表**：`schema_version` 表记录已执行的迁移版本号。

**迁移流程**：

```
currentVersion = SELECT MAX(version) FROM schema_version

for migration in migrations:
  if migration.version > currentVersion:
    executeMigration(migration)
    INSERT INTO schema_version (version) VALUES (migration.version)
```

- **幂等安全**：已执行的迁移不会重复执行；
- **顺序保证**：按版本号从小到大顺序执行；
- **原子性**：每个迁移在单个事务中执行，失败则回滚。

### 3. 核心表结构

| 表名 | 用途 | 关键字段 |
|------|------|----------|
| `articles` | 文章存储 | id, sessionId, title, content, status, reviewRound |
| `sessions` | 内容会话 | id, name, sourceType, createdAt |
| `publish_tasks` | 发布任务 | id, articleId, platform, accountId, status, scheduledAt |
| `publish_logs` | 发布日志 | id, taskId, level, message, metadata |
| `credentials` | 平台凭证 | id, platform, accountId, cookies, status |
| `users` | 用户管理 | id, username, passwordHash, apiKey, role |
| `health_alerts` | 健康告警 | id, platform, alertType, message, status |
| `captcha_events` | 验证码事件 | id, platform, captchaType, source, status |
| `optimization_plans` | 优化计划 | id, name, status, scheduledDate |
| `scheduled_plan_tasks` | 计划任务 | id, planId, status, executedAt |
| `review_audit_logs` | 审核审计 | id, articleId, round, reviewer, result |
| `pipeline_runs` | 流水线运行 | id, sessionId, status, startedAt |
| `session_health` | 会话健康 | id, platform, accountId, status, consecutiveFailures |

### 4. 迁移历史摘要

| 版本 | 变更内容 |
|------|----------|
| v1 | 新增审核维度列（compliance/quality/seo 等） |
| v2 | 创建 `pipeline_runs` 表 |
| v3, v5, v6, v12 | 调整 `publish_tasks` 表结构 |
| v4 | 创建 `users` 表和多账号凭证支持 |
| v7-v11 | 创建健康监测相关表（health_alerts、captcha_events 等） |
| v13 | 新增审核审计日志表 |
| v15 | 添加用户密码哈希列 |
| v16 | 创建 `optimization_plans` 和 `scheduled_plan_tasks` |
| v17 | 添加 `review_round` 列 |
| v18 | 添加 `publish_url` 列 |

**迁移模式**：全部使用 `ALTER TABLE ADD COLUMN` 或 `CREATE TABLE`，规避 SQLite 不支持的 DDL。

### 5. 数据库连接管理

```typescript
import Database from 'better-sqlite3';

function createDatabase(): DB {
  const db = new Database(process.env.DATABASE_PATH ?? 'data/geo.db');
  initDatabase(db);  // PRAGMA + 迁移
  return db;
}
```

- **better-sqlite3**：同步 API，性能优于 sqlite3（异步），无需 Promise 包装；
- **单例连接**：进程内共享一个数据库连接（SQLite 不支持多连接写）；
- **路径可配置**：通过 `DATABASE_PATH` 环境变量指定。

### 6. WAL 模式选择

| 特性 | WAL 模式 | 默认模式（DELETE） |
|------|----------|-------------------|
| 读写并发 | ✅ 读不阻塞写 | ❌ 读写互斥 |
| 性能 | 写入快（顺序写 WAL 文件） | 写入慢（回滚日志） |
| 崩溃恢复 | 自动恢复 | 需要回滚 |
| 文件 | 多一个 `.wal` 文件 | 仅 `.db` 文件 |
| 网络存储 | ⚠️ 不推荐 | ✅ 兼容 |

## Alternatives Considered

### 替代方案 1：ORM 迁移（如 Prisma Migrate）

**描述**：使用 Prisma 管理 Schema 和迁移。

**否决理由**：better-sqlite3 与 Prisma 不兼容；Prisma 引入额外的 Schema 定义语言和代码生成步骤；当前迁移机制简单有效。

### 替代方案 2：不留版本号，启动时重建

**描述**：启动时执行 `CREATE TABLE IF NOT EXISTS`，不跟踪版本。

**否决理由**：无法处理列变更（加列、改类型）；已有部署升级时无法增量迁移。

### 替代方案 3：PostgreSQL 替代 SQLite

**描述**：使用 PostgreSQL 获得更强大的迁移和 DDL 支持。

**否决理由**：SQLite 零配置部署适合单实例；PostgreSQL 需要额外的数据库服务进程；当前数据量（< 10GB）不需要。

## Consequences

### 正面影响

1. **平滑升级**：已有部署自动执行增量迁移，无需人工干预；
2. **版本可追溯**：`schema_version` 表清晰记录迁移历史；
3. **WAL 提升性能**：读写并发不互斥，调度器读和发布写可同时进行；
4. **零外部依赖**：better-sqlite3 是原生模块，无需数据库服务进程。

### 负面影响

1. **SQLite DDL 限制**：不支持删列、改列类型，复杂 Schema 变更需要重建表；
2. **单连接写入**：SQLite 不支持多连接并发写，大规模写入场景受限；
3. **无回滚机制**：迁移只能向前执行，无法回滚到旧版本；
4. **WAL 文件管理**：`.wal` 文件可能增长，需定期 checkpoint。

### 需要跟进的事项

- [ ] 增加 migration 回滚脚本（down migration）
- [ ] WAL checkpoint 定期执行策略
- [ ] 数据库备份机制
- [ ] 迁移测试（空库 → 最新版本的完整流程测试）

## Superseded when

1. 数据量超过 SQLite 性能上限（建议 > 50GB）；
2. 需要多节点并发写入；
3. 迁移复杂度超过 `ADD COLUMN` 能力范围，频繁需要重建表。
