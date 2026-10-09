import { Hono } from 'hono';
import { createHash } from 'node:crypto';
import type { AppEnv, DatabaseAccess } from '../db.js';

export function createAuthRoutes(db: DatabaseAccess): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post('/login', async (c) => {
    try {
      const body = await c.req.json<{ username: string; password: string }>();

      if (!body.username || !body.password) {
        return c.json(
          { success: false, error: '账号和密码不能为空' },
          400,
        );
      }

      const user = db.users.getUserByUsername(body.username);
      if (!user) {
        return c.json({ success: false, error: '账号或密码错误' }, 401);
      }

      const hash = createHash('sha256').update(body.password).digest('hex');
      if (user.passwordHash !== hash) {
        return c.json({ success: false, error: '账号或密码错误' }, 401);
      }

      db.users.updateUserLastActive(user.id);

      return c.json({
        success: true,
        data: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          role: user.role,
          apiKey: user.apiKey,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return c.json({ success: false, error: message }, 500);
    }
  });

  app.post('/verify', async (c) => {
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    return c.json({
      success: true,
      data: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
      },
    });
  });

  app.post('/logout', (c) => {
    return c.json({ success: true });
  });

  return app;
}
