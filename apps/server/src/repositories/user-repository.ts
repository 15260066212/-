import type { DB } from '../db.js';
import type { User } from '../db.js';

export class UserRepository {
  constructor(private db: DB) {}

  insertUser(user: User): void {
    const stmt = this.db.prepare(`
      INSERT INTO users (id, username, display_name, role, api_key, password_hash, created_at, last_active_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      user.id, user.username, user.displayName, user.role,
      user.apiKey, user.passwordHash ?? null, user.createdAt, user.lastActiveAt ?? null,
    );
  }

  getUserByUsername(username: string): User | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as Record<string, unknown> | undefined;
    return row ? this.mapUser(row) : undefined;
  }

  getUserByApiKey(apiKey: string): User | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE api_key = ?').get(apiKey) as Record<string, unknown> | undefined;
    return row ? this.mapUser(row) : undefined;
  }

  getUserById(id: string): User | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapUser(row) : undefined;
  }

  updateUserLastActive(id: string): void {
    this.db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?').run(new Date().toISOString(), id);
  }

  listUsers(): User[] {
    const rows = this.db.prepare('SELECT * FROM users ORDER BY created_at ASC').all() as Record<string, unknown>[];
    return rows.map((r) => this.mapUser(r));
  }

  deleteUser(id: string): void {
    // Prevent deletion of the default admin user
    if (id === 'user_default') {
      throw new Error('Cannot delete the default admin user');
    }
    this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }

  /** Regenerate the API key for a user. Returns the updated user or undefined if not found. */
  regenerateUserApiKey(id: string): User | undefined {
    const newApiKey = `geo-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    const result = this.db.prepare('UPDATE users SET api_key = ? WHERE id = ?').run(newApiKey, id);
    if (result.changes === 0) return undefined;
    return this.getUserById(id);
  }

  private mapUser(row: Record<string, unknown>): User {
    return {
      id: String(row.id),
      username: String(row.username),
      displayName: String(row.display_name),
      role: String(row.role) as User['role'],
      apiKey: String(row.api_key),
      passwordHash: row.password_hash ? String(row.password_hash) : undefined,
      createdAt: String(row.created_at),
      lastActiveAt: row.last_active_at ? String(row.last_active_at) : undefined,
    };
  }
}
