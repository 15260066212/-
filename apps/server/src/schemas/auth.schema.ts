import { createHash } from 'node:crypto';
import type { DB } from '../db.js';

// ---------------------------------------------------------------------------
// Users / Auth
// ---------------------------------------------------------------------------
export function initUserTables(db: DB, currentVersion: number): void {
  // Migration v4 (partial): multi-user support - users table + default admin
  if (currentVersion < 4) {
    // Create users table
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        api_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        last_active_at TEXT
      );
    `);

    // Create default admin user with secure random API key
    const defaultUser = db.prepare('SELECT id FROM users WHERE id = ?').get('user_default');
    if (!defaultUser) {
      // Use env var if provided, otherwise generate a secure random key
      const defaultApiKey = process.env.DEFAULT_ADMIN_API_KEY
        ?? `geo-${Date.now()}-${crypto.randomUUID().replace(/-/g, '')}`;
      db.prepare(
        'INSERT INTO users (id, username, display_name, role, api_key, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run('user_default', 'hsq', 'Administrator', 'admin', defaultApiKey, new Date().toISOString());
      console.log(`[DB] Default admin user created with API key: ${defaultApiKey.slice(0, 8)}... (set DEFAULT_ADMIN_API_KEY to customize)`);
    }

    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
      4, new Date().toISOString(),
    );
    console.log('[DB] Migration v4 applied: added multi-user support');
  }

  // Migration v15: password_hash column on users for username/password login
  const row15 = db.prepare('SELECT version FROM schema_version WHERE version = ?').get(15);
  if (!row15) {
    // Add password_hash column (SQLite ADD COLUMN is safe if not exists)
    try {
      db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT');
    } catch {
      // Column may already exist
    }

    // Set default admin password hash (XTGEO123)
    const hash = createHash('sha256').update('XTGEO123').digest('hex');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, 'user_default');
    // Ensure all users without a password get the default too
    db.prepare('UPDATE users SET password_hash = ? WHERE password_hash IS NULL').run(hash);

    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
      15, new Date().toISOString(),
    );
    console.log('[DB] Migration v15 applied: password_hash on users');
  }

  // 内置账号种子：每次启动都执行（幂等），保证所有单机部署无需手工操作
  // 即拥有同一套可登录账号。新增账号只需在下方数组加一行。
  seedBuiltinUsers(db);
}

interface BuiltinUser {
  username: string;
  displayName: string;
  role: 'admin' | 'user';
  password: string;
}

const BUILTIN_USERS: BuiltinUser[] = [
  { username: 'CL', displayName: 'CL', role: 'user', password: 'XTGEO123' },
];

function seedBuiltinUsers(db: DB): void {
  for (const u of BUILTIN_USERS) {
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(u.username);
    if (existing) continue;
    const hash = createHash('sha256').update(u.password).digest('hex');
    const apiKey = `geo-${Date.now()}-${crypto.randomUUID().replace(/-/g, '')}`;
    db.prepare(
      'INSERT INTO users (id, username, display_name, role, api_key, created_at, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(
      `user_${Date.now()}_${u.username.toLowerCase()}`,
      u.username,
      u.displayName,
      u.role,
      apiKey,
      new Date().toISOString(),
      hash,
    );
    console.log(`[DB] Builtin user seeded: ${u.username}`);
  }
}
