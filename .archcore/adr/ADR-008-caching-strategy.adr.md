# ADR-008: 缓存策略（LRU + TTL + CachedDatabaseAccess 读写穿透）

**Type:** ADR
**Status:** accepted
**Tags:** architecture, caching, performance, lru

## Context

GEO 系统基于 SQLite 提供数据持久化，所有读操作直接命中数据库。随着发布任务量增长和 API 调用频率提升，以下问题逐渐显现：

- **高频读操作压力大**：文章列表、发布任务状态、凭证信息等被频繁查询，每次都走 SQLite 全表扫描或索引查找，响应延迟随数据量增长线性上升；
- **会话健康检查频繁**：每 10 分钟的批次巡检会集中查询所有凭证的会话状态，短时间产生大量并发读；
- **API 响应延迟敏感**：前端轮询发布进度、队列状态等接口要求 < 200ms 响应，无缓存时难以保证；
- **写少读多**：发布任务的状态变更频率远低于查询频率，适合用缓存吸收读压力。

直接引入 Redis 等外部缓存服务会增加部署复杂度和运维成本，与当前单实例 + SQLite 的轻量架构不匹配。

## Decision

采用**自建 LRU + TTL 内存缓存**方案，以 `LRUCache` 为核心，通过 `CachedDatabaseAccess` 实现读写穿透（Read-Through + Write-Through Invalidation）。

### 1. 缓存架构分层

| 层级 | 职责 | 核心模块 |
|------|------|----------|
| **缓存基础设施** | LRU 淘汰 + TTL 过期 + 统计 | `LRUCache` (`apps/server/src/cache.ts`) |
| **数据访问缓存层** | 读写穿透 + 缓存键管理 + 无效化策略 | `CachedDatabaseAccess` (`apps/server/src/cached-db.ts`) |
| **定时清理调度** | 批量清除过期条目，释放内存 | `CacheCleanupScheduler` (`apps/server/src/scheduler/cache-cleanup.ts`) |

### 2. LRU 淘汰机制

`LRUCache` 基于 JavaScript `Map` 实现，利用 Map 的**插入顺序特性**（先插入的在前）：

- **读取时更新访问顺序**：`get()` 命中后先 `delete(key)` 再 `set(key, entry)`，将条目移动到 Map 末尾（最近使用）；
- **容量满时淘汰**：`set()` 新增条目时，若 `cache.size >= maxEntries`，取 `Map.keys().next().value`（最老的 key）执行 `evictLRU()` 删除；
- **默认容量**：200 个条目（`CachedDatabaseAccess` 配置）。

### 3. TTL 过期策略

支持三种 TTL 模式，通过 `set(key, value, ttlMs)` 的第三个参数控制：

| `ttlMs` 值 | 含义 | 使用场景 |
|------------|------|----------|
| `0`（默认） | 使用 `defaultTtlMs`（60s） | 通用场景 |
| 正数 | 自定义 TTL | 按数据类型差异化配置 |
| `-1` | 永不过期 | 极少变更的配置类数据 |

**过期检查时机**：
- **懒检查**：`get()` 和 `has()` 时检查 `Date.now() > entry.expiresAt`，过期则删除并返回 miss；
- **主动清理**：`cleanup()` 批量扫描全部条目，删除已过期项，由 `CacheCleanupScheduler` 每 5 分钟触发一次。

### 4. CachedDatabaseAccess 读写穿透

`CachedDatabaseAccess` 继承 `DatabaseAccess`，为读操作增加缓存，为写操作增加无效化：

**读操作（Read-Through）**：
```
get(key) → cache.get(key) → 命中则返回
                             ↓ 未命中
                          db.query(key) → cache.set(key, result) → 返回
```

**各数据类型 TTL 配置**：

| 数据类型 | 缓存键格式 | TTL | 理由 |
|----------|-----------|-----|------|
| 文章详情 | `article:{id}` | 60s | 文章内容发布后不变，变更频率低 |
| 会话文章列表 | `articles:session:{id}` | 30s | 列表可能因新文章加入而变化 |
| 发布任务 | `task:{id}` | 30s | 任务状态变更频繁，TTL 不宜过长 |
| 平台凭证 | `cred:{platform}` | 120s | 凭证信息稳定，但需留更新窗口 |
| 会话信息 | `session:{id}` | 30s | 会话状态可能快速变化 |
| 健康检查 | `health` | 10s | 健康状态需近实时 |
| 队列状态 | `queue:status` | 10s | 队列状态高频变化 |

**写操作无效化（Write-Through Invalidation）**：
- **精确删除**：写入操作成功后，删除对应的精确缓存键（如更新文章后删除 `article:{id}`）；
- **模式前缀删除**：对于列表类缓存，使用前缀模式删除（如更新会话文章后删除 `articles:session:{id}` 下所有条目）；
- **双重保障**：精确删除 + 模式前缀删除同时执行，确保缓存一致性。

### 5. 缓存统计与可观测性

`LRUCache` 内置统计计数器，通过 `stats()` 方法暴露：

| 指标 | 说明 |
|------|------|
| `entries` | 当前缓存条目数 |
| `hits` | 命中次数 |
| `misses` | 未命中次数 |
| `hitRate` | 命中率百分比 |
| `evictions` | LRU 淘汰次数 |

`CacheCleanupScheduler` 每次清理后输出日志，包含移除条目数、剩余条目数和命中率。

### 6. wrap() 异步函数缓存

`LRUCache` 提供 `wrap(key, fn, ttlMs)` 方法，用于缓存异步函数结果：

```typescript
const article = await cache.wrap(`article:${id}`, () => db.getArticle(id), 60_000);
```

- 缓存命中时直接返回缓存值，跳过 `fn` 执行；
- 未命中时执行 `fn`，将结果写入缓存后返回；
- 适用于 `CachedDatabaseAccess` 中所有读操作的统一缓存模式。

## Alternatives Considered

### 替代方案 1：Redis 外部缓存

**描述**：使用 Redis 作为外部缓存服务，替代内存缓存。

**否决理由**：
- 当前为单实例部署，无多节点缓存共享需求；
- Redis 引入额外进程和运维成本，与轻量 SQLite 架构不匹配；
- 内存缓存命中率已足够高，性能差距可忽略。

**保留可能性**：多节点部署或缓存数据量超过内存容量时引入。

### 替代方案 2：纯 TTL 缓存（无 LRU 淘汰）

**描述**：仅依赖 TTL 过期，不做 LRU 淘汰，缓存满时拒绝新写入。

**否决理由**：
- 无法自适应访问模式，热点数据可能被冷数据挤出；
- TTL 到期前缓存可能已满，导致新数据无法缓存；
- LRU 淘汰实现简单（Map 原生支持），无额外复杂度。

### 替代方案 3：多级缓存（L1 内存 + L2 SQLite WAL）

**描述**：内存为 L1，SQLite WAL 缓冲为 L2，形成两级缓存。

**否决理由**：
- SQLite WAL 本身已有读优化，再加 L2 层收益有限；
- 多级缓存一致性管理复杂度高，不值得当前规模引入。

## Consequences

### 正面影响

1. **读性能大幅提升**：热点数据命中缓存后跳过 SQLite 查询，API 响应延迟从 5-20ms 降至 < 1ms；
2. **数据库压力降低**：高频读操作被缓存吸收，SQLite 并发读竞争减少；
3. **自包含无外部依赖**：纯 TypeScript 实现，无额外进程或服务依赖；
4. **可观测性好**：内置统计指标，命中率、淘汰数一目了然；
5. **灵活的 TTL 配置**：按数据类型差异化配置，平衡一致性和性能。

### 负面影响

1. **内存占用**：200 个缓存条目约占用 5-20MB 内存，对内存受限环境需关注；
2. **短暂不一致窗口**：TTL 过期前，其他进程的写入不会反映到缓存中（单实例下不是问题）；
3. **重启丢失缓存**：进程重启后缓存清空，冷启动期间有短暂性能下降；
4. **缓存键管理负担**：新增数据类型时需手动维护缓存键格式和无效化策略。

### 需要跟进的事项

- [ ] 增加缓存预热机制（启动时加载热点数据）
- [ ] 按数据类型动态调整 maxEntries
- [ ] 增加缓存穿透保护（空结果也缓存短 TTL）

## Superseded when

当出现以下任一情况时，本决策应被重新评估：

1. 部署为多节点集群，需要跨节点缓存共享；
2. 缓存数据量超过可用内存；
3. 引入 Redis 作为会话存储或消息队列，可复用为缓存；
4. 缓存一致性要求达到强一致（当前为最终一致）。
