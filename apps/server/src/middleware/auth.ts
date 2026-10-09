import type { MiddlewareHandler } from 'hono';
import type { AppEnv, DatabaseAccess } from '../db.js';

/**
 * Create an authentication middleware that resolves the current user from
 * the `x-api-key` header or `Authorization: Bearer <key>` header.
 *
 * - If a valid API key is provided, the corresponding user is attached to
 *   the Hono context via `c.set('user', user)`.
 * - If AUTH_REQUIRE_API_KEY is not set to 'true' (dev mode) and no API key
 *   is provided, the default admin user (`user_default`) is used for
 *   backward compatibility.
 * - If AUTH_REQUIRE_API_KEY is 'true' and no API key is provided, 401 is returned.
 * - If an invalid API key is provided, a 401 response is returned.
 */
export function createAuthMiddleware(db: DatabaseAccess): MiddlewareHandler<AppEnv> {
  const requireApiKey = process.env.AUTH_REQUIRE_API_KEY === 'true';

  return async (c, next) => {
    // Try x-api-key header first
    let apiKey = c.req.header('x-api-key');

    // Fall back to Authorization: Bearer <key>
    if (!apiKey) {
      const authHeader = c.req.header('authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        apiKey = authHeader.slice(7).trim();
      }
    }

    // No API key provided
    if (!apiKey) {
      if (requireApiKey) {
        return c.json({ success: false, error: 'Unauthorized: API key required' }, 401);
      }
      // Dev mode: fall back to default admin user (backward compatibility)
      const defaultUser = db.users.getUserById('user_default');
      if (defaultUser) {
        c.set('user', defaultUser);
      }
      await next();
      return;
    }

    // Look up user by API key
    const user = db.users.getUserByApiKey(apiKey);
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized: invalid API key' }, 401);
    }

    // Attach user to context and update last active time
    c.set('user', user);
    db.users.updateUserLastActive(user.id);

    await next();
  };
}
