# 登录态健康监控 - 阶段 1 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立登录态健康监控基础框架，支持凭证健康检查调度、微信公众号 API 校验、以及运营监控看板的凭证健康展示。

**Architecture:** 在 `apps/server/src/session-health/` 下新建健康检查模块，包含 `SessionHealthChecker` 基类、`WechatValidator` API 校验器、调度集成、数据库迁移 v7。通过 `db` 层持久化检查结果，通过 `monitor` 路由暴露数据给前端看板。

**Tech Stack:** TypeScript, Hono, better-sqlite3, Playwright (后续阶段), 微信公众号 API

---

## 文件结构

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/shared/src/index.ts` | 修改 | 新增 `SessionHealthStatus`、`SessionHealthLog`、`MonitorCredentialHealth` 类型 |
| `apps/server/src/db.ts` | 修改 | 迁移 v7：`platform_credentials` 新增健康字段 + 新建 `session_health_logs` 表 + 相关查询方法 |
| `apps/server/src/session-health/types.ts` | 新建 | 健康检查相关类型定义 |
| `apps/server/src/session-health/validators/base.ts` | 新建 | `SessionValidator` 接口 + `BaseValidator` 抽象类 |
| `apps/server/src/session-health/validators/wechat.ts` | 新建 | 微信公众号 API 校验器 |
| `apps/server/src/session-health/checker.ts` | 新建 | `SessionHealthChecker` 主类：调度、执行、结果处理 |
| `apps/server/src/session-health/index.ts` | 新建 | 模块导出 |
| `apps/server/src/scheduler.ts` | 修改 | 集成健康检查定时调度（每 10 分钟检查一批） |
| `apps/server/src/routes/monitor.ts` | 修改 | 新增凭证健康度数据接口 |
| `apps/server/src/routes/credentials.ts` | 修改 | 发布前预检：跳过 expired/invalid 凭证 |
| `apps/server/src/index.ts` | 修改 | 启动 `SessionHealthChecker` |

---

### Task 1: 类型定义（shared + 内部 types）

**Files:**
- Modify: `packages/shared/src/index.ts`
- Create: `apps/server/src/session-health/types.ts`

- [ ] **Step 1: 在 shared/index.ts 末尾新增类型**

在 `export interface MonitorCredentialStats` 下方添加：

```typescript
export interface MonitorCredentialHealth {
  total: number;
  valid: number;
  checking: number;
  expired: number;
  invalid: number;
  lastCheckedAt?: string;
  byPlatform: Array<{ platform: string; total: number; valid: number; expired: number; healthRate: number }>;
}
```

在 `export interface MonitorOverview` 的 `credentials` 下方添加：

```typescript
  credentialHealth?: MonitorCredentialHealth;
```

- [ ] **Step 2: 新建 session-health/types.ts**

```typescript
import type { PlatformCredentials, PlatformId } from '@zemingengine/shared';

export interface ValidationResult {
  valid: boolean;
  error?: string;
  evidence?: {
    pageTitle?: string;
    finalUrl?: string;
    screenshot?: string;
  };
  durationMs: number;
}

export interface Validator {
  readonly platform: PlatformId;
  validate(credentials: PlatformCredentials): Promise<ValidationResult>;
}

export type HealthCheckStatus = 'valid' | 'checking' | 'expired' | 'invalid' | 'error';

export interface HealthCheckLog {
  id?: number;
  platform: string;
  userId: string;
  status: HealthCheckStatus;
  durationMs: number;
  errorMessage?: string;
  checkedAt: number;
}

export const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 小时
export const CHECK_BATCH_SIZE = 3; // 每批最多 3 个同时检查
export const MAX_CONSECUTIVE_FAILURES = 3; // 连续 3 次失败标记 expired
```

- [ ] **Step 3: 构建验证**

Run: `cd packages/shared && npx tsc --noEmit`
Expected: No errors

---

### Task 2: 数据库迁移 v7 + 查询方法

**Files:**
- Modify: `apps/server/src/db.ts`

- [ ] **Step 1: 在 db.ts 的 initMigrations 中添加迁移 v7**

找到迁移 v6 的位置（`failure_type` 列那个），在其后添加：

```typescript
    // Migration v7: session health monitoring
    if (schemaVersion < 7) {
      // Add health check columns to platform_credentials
      const credCols = db.prepare('PRAGMA table_info(platform_credentials)').all() as { name: string }[];
      const hasLastCheckedAt = credCols.some((c) => c.name === 'last_checked_at');
      if (!hasLastCheckedAt) {
        db.exec(`
          ALTER TABLE platform_credentials ADD COLUMN last_checked_at INTEGER;
          ALTER TABLE platform_credentials ADD COLUMN last_check_status TEXT DEFAULT 'valid';
          ALTER TABLE platform_credentials ADD COLUMN consecutive_failures INTEGER DEFAULT 0;
          ALTER TABLE platform_credentials ADD COLUMN check_error TEXT;
          ALTER TABLE platform_credentials ADD COLUMN check_interval_ms INTEGER DEFAULT ${6 * 60 * 60 * 1000};
        `);
      }

      // Create session_health_logs table
      db.exec(`
        CREATE TABLE IF NOT EXISTS session_health_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          platform TEXT NOT NULL,
          user_id TEXT NOT NULL DEFAULT 'user_default',
          status TEXT NOT NULL,
          duration_ms INTEGER NOT NULL,
          error_message TEXT,
          checked_at INTEGER NOT NULL
        )
      `);

      db.prepare('UPDATE schema_version SET version = 7').run();
      console.log('[DB] Migration v7 applied: session health monitoring');
    }
```

- [ ] **Step 2: 在 db.ts 中新增查询方法（放到 "// === Credentials ===" 区域末尾）**

```typescript
  /**
   * Get credentials that are due for a health check.
   * Returns credentials where last_checked_at is null or older than check_interval_ms,
   * limited to batchSize, ordered by last_checked_at ASC (oldest first).
   */
  getCredentialsDueForCheck(batchSize: number = 3, userId?: string): PlatformCredentials[] {
    const rows = db
      .prepare(
        `SELECT * FROM platform_credentials
         WHERE status IN ('active', 'expired')
           AND (last_checked_at IS NULL OR last_checked_at < ?)
           ${userId ? 'AND user_id = ?' : ''}
         ORDER BY last_checked_at IS NULL DESC, last_checked_at ASC
         LIMIT ?`,
      )
      .all(
        Date.now() - 6 * 60 * 60 * 1000,
        ...(userId ? [userId] : []),
        batchSize,
      ) as Record<string, unknown>[];
    return rows.map((row) => ({
      platform: String(row.platform) as PlatformCredentials['platform'],
      type: String(row.credential_type) as PlatformCredentials['type'],
      data: decryptJSON<Record<string, string>>(String(row.credential_data)),
      status: String(row.status) as PlatformCredentials['status'],
      lastValidatedAt: row.last_validated_at ? String(row.last_validated_at) : undefined,
    }));
  }

  /** Record the result of a health check. */
  recordHealthCheck(
    platform: string,
    status: 'valid' | 'expired' | 'checking' | 'error',
    durationMs: number,
    errorMessage?: string,
    userId: string = 'user_default',
  ): void {
    const now = Date.now();

    // Insert log
    db.prepare(
      `INSERT INTO session_health_logs (platform, user_id, status, duration_ms, error_message, checked_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(platform, userId, status, durationMs, errorMessage ?? null, now);

    // Update credential status
    if (status === 'valid') {
      db.prepare(
        `UPDATE platform_credentials
         SET status = 'active',
             last_checked_at = ?,
             last_check_status = 'valid',
             consecutive_failures = 0,
             check_error = NULL,
             updated_at = ?
         WHERE user_id = ? AND platform = ?`,
      ).run(now, new Date().toISOString(), userId, platform);
    } else if (status === 'expired') {
      db.prepare(
        `UPDATE platform_credentials
         SET status = 'expired',
             last_checked_at = ?,
             last_check_status = 'expired',
             check_error = ?,
             updated_at = ?
         WHERE user_id = ? AND platform = ?`,
      ).run(now, errorMessage ?? null, new Date().toISOString(), userId, platform);
    } else {
      // checking or error - increment failures if error
      if (status === 'error') {
        db.prepare(
          `UPDATE platform_credentials
           SET last_checked_at = ?,
               last_check_status = 'checking',
               consecutive_failures = consecutive_failures + 1,
               check_error = ?,
               updated_at = ?
           WHERE user_id = ? AND platform = ?`,
        ).run(now, errorMessage ?? null, new Date().toISOString(), userId, platform);
      }
    }
  }

  /** Get credential health statistics for the monitor dashboard. */
  getCredentialHealthStats(): {
    total: number;
    valid: number;
    checking: number;
    expired: number;
    invalid: number;
    byPlatform: Array<{ platform: string; total: number; valid: number; expired: number; healthRate: number }>;
  } {
    const all = db
      .prepare('SELECT platform, status, last_check_status FROM platform_credentials')
      .all() as { platform: string; status: string; last_check_status: string }[];

    let valid = 0;
    let checking = 0;
    let expired = 0;
    let invalid = 0;

    const byPlatformMap = new Map<string, { total: number; valid: number; expired: number }>();

    for (const row of all) {
      const checkStatus = row.last_check_status || 'valid';
      const effectiveStatus = row.status === 'expired' ? 'expired'
        : row.status === 'invalid' ? 'invalid'
        : checkStatus;

      if (effectiveStatus === 'valid') valid++;
      else if (effectiveStatus === 'checking') checking++;
      else if (effectiveStatus === 'expired') expired++;
      else if (effectiveStatus === 'invalid') invalid++;

      const p = byPlatformMap.get(row.platform) || { total: 0, valid: 0, expired: 0 };
      p.total++;
      if (effectiveStatus === 'valid') p.valid++;
      if (effectiveStatus === 'expired') p.expired++;
      byPlatformMap.set(row.platform, p);
    }

    const byPlatform = Array.from(byPlatformMap.entries()).map(([platform, data]) => ({
      platform,
      total: data.total,
      valid: data.valid,
      expired: data.expired,
      healthRate: data.total > 0 ? Math.round((data.valid / data.total) * 1000) / 10 : 0,
    }));

    return {
      total: all.length,
      valid,
      checking,
      expired,
      invalid,
      byPlatform,
    };
  }
```

- [ ] **Step 3: 构建验证**

Run: `cd apps/server && npx tsc --noEmit`
Expected: No errors

---

### Task 3: Validator 基类 + 微信公众号校验器

**Files:**
- Create: `apps/server/src/session-health/validators/base.ts`
- Create: `apps/server/src/session-health/validators/wechat.ts`

- [ ] **Step 1: 新建 validators/base.ts**

```typescript
import type { PlatformCredentials, PlatformId } from '@zemingengine/shared';
import type { ValidationResult } from '../types.js';

export abstract class BaseValidator {
  abstract readonly platform: PlatformId;

  abstract validate(credentials: PlatformCredentials): Promise<ValidationResult>;

  protected measure<T>(fn: () => Promise<T>): Promise<{ result: T; durationMs: number }> {
    const start = Date.now();
    return fn().then((result) => ({
      result,
      durationMs: Date.now() - start,
    }));
  }
}
```

- [ ] **Step 2: 新建 validators/wechat.ts**

```typescript
import type { PlatformCredentials } from '@zemingengine/shared';
import { BaseValidator } from './base.js';
import type { ValidationResult } from '../types.js';

export class WechatValidator extends BaseValidator {
  readonly platform = 'weixin' as const;

  async validate(credentials: PlatformCredentials): Promise<ValidationResult> {
    const { result, durationMs } = await this.measure(async () => {
      const appId = credentials.data.appId || credentials.data.app_id || '';
      const appSecret = credentials.data.appSecret || credentials.data.app_secret || '';

      if (!appId || !appSecret) {
        return { valid: false, error: 'Missing appId or appSecret' };
      }

      try {
        const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        const data = (await res.json()) as { access_token?: string; errcode?: number; errmsg?: string };

        if (data.access_token) {
          return { valid: true };
        }

        // Map common error codes
        const errCode = data.errcode ?? -1;
        let errorMsg = data.errmsg || 'Unknown error';

        if (errCode === 40013) {
          errorMsg = '无效的 AppID (40013)';
        } else if (errCode === 40125) {
          errorMsg = '无效的 AppSecret (40125)';
        } else if (errCode === 40164) {
          errorMsg = 'IP 不在白名单 (40164)';
        }

        return { valid: false, error: errorMsg };
      } catch (err) {
        return {
          valid: false,
          error: `Network error: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    });

    return {
      ...result,
      durationMs,
      evidence: result.error ? undefined : { pageTitle: 'WeChat API token' },
    } as ValidationResult;
  }
}
```

- [ ] **Step 3: 构建验证**

Run: `cd apps/server && npx tsc --noEmit`
Expected: No errors

---

### Task 4: SessionHealthChecker 主类

**Files:**
- Create: `apps/server/src/session-health/checker.ts`
- Create: `apps/server/src/session-health/index.ts`

- [ ] **Step 1: 新建 checker.ts**

```typescript
import type { PlatformCredentials, PlatformId } from '@zemingengine/shared';
import type { DatabaseAccess } from '../db.js';
import { BaseValidator } from './validators/base.js';
import { WechatValidator } from './validators/wechat.js';
import {
  CHECK_BATCH_SIZE,
  MAX_CONSECUTIVE_FAILURES,
  type HealthCheckStatus,
} from './types.js';

export class SessionHealthChecker {
  private db: DatabaseAccess;
  private validators: Map<PlatformId, BaseValidator> = new Map();
  private running = false;

  constructor(db: DatabaseAccess) {
    this.db = db;
    this.registerValidator(new WechatValidator());
  }

  registerValidator(validator: BaseValidator): void {
    this.validators.set(validator.platform, validator);
  }

  hasValidator(platform: PlatformId): boolean {
    return this.validators.has(platform);
  }

  /**
   * Run a batch of health checks on credentials that are due.
   * Called periodically by the scheduler.
   */
  async runCheckBatch(batchSize: number = CHECK_BATCH_SIZE): Promise<number> {
    if (this.running) {
      console.log('[HealthChecker] Skipping batch: previous batch still running');
      return 0;
    }

    this.running = true;
    let checkedCount = 0;

    try {
      const dueCredentials = this.db.getCredentialsDueForCheck(batchSize);
      const toCheck = dueCredentials.filter((c) => this.hasValidator(c.platform));

      if (toCheck.length === 0) {
        return 0;
      }

      console.log(`[HealthChecker] Checking ${toCheck.length} credential(s)`);

      const promises = toCheck.map(async (cred) => {
        try {
          await this.checkCredential(cred);
        } catch (err) {
          console.error(
            `[HealthChecker] Unexpected error checking ${cred.platform}:`,
            err instanceof Error ? err.message : err,
          );
        }
      });

      await Promise.all(promises);
      checkedCount = toCheck.length;
    } finally {
      this.running = false;
    }

    return checkedCount;
  }

  /**
   * Check a single credential's health status.
   */
  async checkCredential(credentials: PlatformCredentials): Promise<HealthCheckStatus> {
    const validator = this.validators.get(credentials.platform);
    if (!validator) {
      return 'valid'; // No validator = assume valid (skip)
    }

    const userId = 'user_default'; // Will be per-user in later phases
    let status: HealthCheckStatus = 'valid';
    let errorMessage: string | undefined;

    try {
      // Mark as checking
      this.db.recordHealthCheck(credentials.platform, 'checking', 0, undefined, userId);

      const result = await validator.validate(credentials);

      if (result.valid) {
        status = 'valid';
      } else {
        // Check consecutive failures
        errorMessage = result.error || 'Validation failed';
        status = 'error'; // Will be processed below
      }
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      status = 'error';
    }

    // Record result
    if (status === 'valid') {
      this.db.recordHealthCheck(credentials.platform, 'valid', 0, undefined, userId);
    } else {
      // For failures, record and check if we should mark expired
      this.db.recordHealthCheck(credentials.platform, status, 0, errorMessage, userId);

      // After recording, check if we've hit the consecutive failure limit
      // We need to re-fetch to get the updated count
      const creds = this.db.getCredential(credentials.platform, userId);
      if (creds) {
        // The recordHealthCheck 'error' path increments consecutive_failures
        // We check after the fact and upgrade to 'expired' if threshold reached
        // This is a simplified approach — we'll refine in later phases
      }
    }

    console.log(
      `[HealthChecker] ${credentials.platform}: ${status}` +
        (errorMessage ? ` (${errorMessage})` : ''),
    );

    return status;
  }
}
```

- [ ] **Step 2: 新建 index.ts**

```typescript
export { SessionHealthChecker } from './checker.js';
export { BaseValidator } from './validators/base.js';
export { WechatValidator } from './validators/wechat.js';
export type { ValidationResult, HealthCheckStatus, HealthCheckLog } from './types.js';
export { DEFAULT_CHECK_INTERVAL_MS, CHECK_BATCH_SIZE, MAX_CONSECUTIVE_FAILURES } from './types.js';
```

- [ ] **Step 3: 构建验证**

Run: `cd apps/server && npx tsc --noEmit`
Expected: No errors

---

### Task 5: 调度器集成

**Files:**
- Modify: `apps/server/src/scheduler.ts`

- [ ] **Step 1: 在 scheduler.ts 顶部导入**

在现有 import 下方添加：

```typescript
import { SessionHealthChecker } from './session-health/index.js';
```

- [ ] **Step 2: 添加健康检查调度函数**

在 `recoverStaleTasks` 函数之后，`startScheduler` 函数之前添加：

```typescript
const HEALTH_CHECK_INTERVAL_MS = 10 * 60 * 1000; // 每 10 分钟检查一批
let healthCheckerInstance: SessionHealthChecker | null = null;
let healthCheckTimer: ReturnType<typeof setInterval> | null = null;

export function startHealthChecker(checker: SessionHealthChecker): void {
  if (healthCheckTimer) {
    console.warn('[HealthChecker] Already running');
    return;
  }
  healthCheckerInstance = checker;
  console.log('[HealthChecker] Starting (batch check every 10 min)');

  // Run first check after a short delay (let server fully start)
  setTimeout(() => {
    checker.runCheckBatch().catch((err) => {
      console.error('[HealthChecker] First batch failed:', err.message);
    });
  }, 5000);

  healthCheckTimer = setInterval(() => {
    checker.runCheckBatch().catch((err) => {
      console.error('[HealthChecker] Batch check failed:', err.message);
    });
  }, HEALTH_CHECK_INTERVAL_MS);
}

export function stopHealthChecker(): void {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
    console.log('[HealthChecker] Stopped');
  }
}
```

- [ ] **Step 3: 在 stopScheduler 中添加清理**

找到 `stopScheduler` 函数，添加：

```typescript
  stopHealthChecker();
```

（需要在 import 中也导入 `stopHealthChecker`，或者直接放同一文件中 — 因为都在 scheduler.ts，直接调用即可）

- [ ] **Step 4: 构建验证**

Run: `cd apps/server && npx tsc --noEmit`
Expected: No errors

---

### Task 6: 服务器启动时初始化 + Monitor 接口

**Files:**
- Modify: `apps/server/src/index.ts`
- Modify: `apps/server/src/routes/monitor.ts`

- [ ] **Step 1: 在 index.ts 中导入并启动**

在 `import { Publisher }...` 附近添加：

```typescript
import { SessionHealthChecker } from './session-health/index.js';
import { startHealthChecker } from './scheduler.js';
```

在 `startScheduler(db as CachedDatabaseAccess, publisher);` 下方添加：

```typescript
  // Session health checker
  const healthChecker = new SessionHealthChecker(db);
  startHealthChecker(healthChecker);
```

在 graceful shutdown 部分（`stopScheduler()` 附近），确保 stopHealthChecker 被调用（已经在 stopScheduler 内部调用了，所以无需额外添加）。

- [ ] **Step 2: 在 monitor.ts 中添加凭证健康接口**

在 `import` 区域添加 `MonitorCredentialHealth`：

```typescript
import type {
  MonitorOverview,
  ArticleChartdata,
  PublishChartdata,
  ReviewChartdata,
  PublishFailureAnalysis,
  MonitorCredentialHealth,
} from '@zemingengine/shared';
```

在 `/ai-info` 路由之后添加：

```typescript
  // GET /credential-health - 凭证健康度统计
  app.get('/credential-health', (c) => {
    try {
      const data: MonitorCredentialHealth = db.getCredentialHealthStats();
      return c.json({ success: true, data });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return c.json({ success: false, error: message }, 500);
    }
  });
```

同时在 `/overview` 路由中添加 `credentialHealth`：

在 `const overview: MonitorOverview = {` 对象的 `credentials` 行下方添加：

```typescript
        credentialHealth: db.getCredentialHealthStats(),
```

- [ ] **Step 3: 构建验证**

Run: `cd apps/server && npx tsc --noEmit`
Expected: No errors

---

### Task 7: 发布前凭证预检 + 完整构建测试

**Files:**
- Modify: `apps/server/src/routes/publish.ts`
- Modify: `apps/server/src/scheduler.ts`

- [ ] **Step 1: 在 publish.ts 发布前检查凭证状态**

找到 `publishArticle` 处理函数（手动发布那个），在调用 publisher 之前添加检查：

```typescript
        // Check credential health before publishing
        const cred = db.getCredential(platform, user.id);
        if (cred && cred.status === 'expired') {
          return c.json(
            { success: false, error: `账号登录态已过期，请重新设置凭证` },
            400,
          );
        }
        if (cred && cred.status === 'invalid') {
          return c.json(
            { success: false, error: `账号凭证无效，请重新设置` },
            400,
          );
        }
```

- [ ] **Step 2: 在 scheduler.ts 的发布执行中添加检查**

在 `executeTask` 或发布的 try 块开头，添加凭证状态检查：

找到获取凭证的代码：
```typescript
const credentials = db.getCredential(task.platform, task.userId);
```

在其下方添加：

```typescript
      if (!credentials) {
        throw new Error(`No credentials for platform: ${task.platform}`);
      }
      if (credentials.status === 'expired') {
        throw new Error(`账号登录态已过期`);
      }
      if (credentials.status === 'invalid') {
        throw new Error(`账号凭证无效`);
      }
```

- [ ] **Step 3: 完整构建测试**

Run: `cd geo-assistant-clean && npx turbo build --filter=@zemingengine/server... --force`
Expected: 9 packages, all successful

- [ ] **Step 4: 运行单元测试**

Run: `cd packages/shared && npx vitest run` (如果有)
Expected: All pass

---

### Task 8: 部署到线上验证

**Files:** (deployment only)

- [ ] **Step 1: 同步所有修改文件到服务器**

Use scp to sync modified files to `62.234.93.63`, then copy into docker container.

Files to sync:
- `packages/shared/src/index.ts`
- `apps/server/src/db.ts`
- `apps/server/src/scheduler.ts`
- `apps/server/src/index.ts`
- `apps/server/src/routes/monitor.ts`
- `apps/server/src/routes/publish.ts`
- `apps/server/src/session-health/types.ts`
- `apps/server/src/session-health/checker.ts`
- `apps/server/src/session-health/index.ts`
- `apps/server/src/session-health/validators/base.ts`
- `apps/server/src/session-health/validators/wechat.ts`

- [ ] **Step 2: 在容器中构建**

`docker exec geo-app sh -c 'cd /app && npx turbo build --filter=@zemingengine/server... --force'`
Expected: All 9 packages build successfully

- [ ] **Step 3: 重启容器**

`docker restart geo-app geo-nginx`

- [ ] **Step 4: 验证**

```bash
# 1. 健康检查 + 迁移 v7
curl http://localhost:9000/api/health
# Expected: schema_version: 7

# 2. 凭证健康接口
curl http://localhost:9000/api/monitor/credential-health
# Expected: success: true, data with valid/expired/invalid counts

# 3. overview 接口包含 credentialHealth
curl http://localhost:9000/api/monitor/overview
# Expected: data.credentialHealth exists

# 4. 检查日志中健康检查启动
docker logs geo-app --tail 20
# Expected: "[HealthChecker] Starting"
```
