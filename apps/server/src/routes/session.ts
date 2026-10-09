import { Hono } from 'hono';
import { createSession, getSession, deleteSession } from '../session-store.js';
import type { AppEnv, DatabaseAccess, User } from '../db.js';

export function createSessionRoutes(db: DatabaseAccess): Hono<AppEnv> {
  const sessionRoutes = new Hono<AppEnv>();

  // POST /api/session - Create new session
  sessionRoutes.post('/', (c) => {
    const user = c.get('user') as User | undefined;
    const userId = user?.id ?? 'user_default';
    const entry = createSession(db, userId);
    const introMessage = entry.engine.getIntroMessage();
    return c.json({
      success: true,
      data: {
        sessionId: entry.data.id,
        sessionData: entry.data,
        introMessage,
      },
    });
  });

  // GET /api/session/:id - Get session state
  sessionRoutes.get('/:id', (c) => {
    const id = c.req.param('id');
    const entry = getSession(id, db);
    if (!entry) {
      return c.json({ success: false, error: 'Session not found' }, 404);
    }
    return c.json({
      success: true,
      data: {
        sessionData: entry.data,
        progress: entry.engine.getProgress(),
      },
    });
  });

  // DELETE /api/session/:id - Delete session
  sessionRoutes.delete('/:id', (c) => {
    const id = c.req.param('id');
    const deleted = deleteSession(id, db);
    if (!deleted) {
      return c.json({ success: false, error: 'Session not found' }, 404);
    }
    return c.json({ success: true });
  });

  // GET /api/session - List sessions (filtered by current user)
  sessionRoutes.get('/', (c) => {
    const user = c.get('user') as User | undefined;
    const userId = user?.id ?? 'user_default';
    // Query from DB for reliable listing (cache may not contain all sessions)
    const sessions = db.sessions.getSessionsByUser(userId);
    return c.json({ success: true, data: sessions });
  });

  return sessionRoutes;
}
