import { Hono } from 'hono';
import type { AppEnv, DatabaseAccess, User } from '../db.js';

export function createUserRoutes(db: DatabaseAccess): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Helper: check if the current user is an admin
  function requireAdmin(c: { get: (key: 'user') => User | undefined }): User | null {
    const user = c.get('user');
    if (!user || user.role !== 'admin') {
      return null;
    }
    return user;
  }

  // POST / - Create a new user (admin only)
  app.post('/', async (c) => {
    try {
      const admin = requireAdmin(c);
      if (!admin) {
        return c.json({ success: false, error: 'Forbidden: admin access required' }, 403);
      }

      const body = await c.req.json<{
        username: string;
        displayName: string;
        role?: 'admin' | 'user';
      }>();

      if (!body.username || !body.displayName) {
        return c.json(
          { success: false, error: 'username and displayName are required' },
          400,
        );
      }

      // Check for duplicate username
      const existing = db.users.getUserByUsername(body.username);
      if (existing) {
        return c.json({ success: false, error: 'Username already exists' }, 409);
      }

      const user: User = {
        id: `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        username: body.username,
        displayName: body.displayName,
        role: body.role ?? 'user',
        apiKey: `geo-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`,
        createdAt: new Date().toISOString(),
      };

      db.users.insertUser(user);

      return c.json({ success: true, data: user });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return c.json({ success: false, error: message }, 500);
    }
  });

  // GET / - List all users (admin only)
  app.get('/', (c) => {
    try {
      const admin = requireAdmin(c);
      if (!admin) {
        return c.json({ success: false, error: 'Forbidden: admin access required' }, 403);
      }

      const users = db.users.listUsers();
      return c.json({ success: true, data: users });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return c.json({ success: false, error: message }, 500);
    }
  });

  // GET /me - Get current user info
  app.get('/me', (c) => {
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    return c.json({ success: true, data: user });
  });

  // DELETE /:id - Delete a user (admin only, cannot delete default admin)
  app.delete('/:id', (c) => {
    try {
      const admin = requireAdmin(c);
      if (!admin) {
        return c.json({ success: false, error: 'Forbidden: admin access required' }, 403);
      }

      const id = c.req.param('id');
      if (id === 'user_default') {
        return c.json(
          { success: false, error: 'Cannot delete the default admin user' },
          400,
        );
      }

      const existing = db.users.getUserById(id);
      if (!existing) {
        return c.json({ success: false, error: 'User not found' }, 404);
      }

      db.users.deleteUser(id);
      return c.json({ success: true, data: { deleted: true } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return c.json({ success: false, error: message }, 500);
    }
  });

  // POST /:id/regenerate-key - Regenerate API key (admin only)
  app.post('/:id/regenerate-key', (c) => {
    try {
      const admin = requireAdmin(c);
      if (!admin) {
        return c.json({ success: false, error: 'Forbidden: admin access required' }, 403);
      }

      const id = c.req.param('id');
      const existing = db.users.getUserById(id);
      if (!existing) {
        return c.json({ success: false, error: 'User not found' }, 404);
      }

      const updated = db.users.regenerateUserApiKey(id);
      if (!updated) {
        return c.json({ success: false, error: 'Failed to regenerate API key' }, 500);
      }

      return c.json({ success: true, data: updated });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return c.json({ success: false, error: message }, 500);
    }
  });

  return app;
}
