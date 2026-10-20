import { Hono } from 'hono';
import { getHarvesterPlatformName } from '@zemingengine/shared';
import type { AppEnv, DatabaseAccess } from '../db.js';
import { HarvesterClient } from '../session-health/harvester-client.js';

function getHarvesterUrl(): string {
  return process.env.HARVESTER_URL || process.env.RPA_REMOTE_URL || 'http://harvester:3003';
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

/**
 * Associate profiles with their credential info from the database.
 * Enriches each profile with accountName, status, cookieCount, lastValidatedAt, etc.
 */
function enrichProfilesWithCredentials(
  profiles: Array<Record<string, unknown>>,
  db: DatabaseAccess,
): Array<Record<string, unknown>> {
  try {
    const allCreds = db.credentials.getAllCredentials();
    const credMap = new Map<string, {
      status: string;
      cookieCount: number;
      accountName: string;
      lastValidatedAt: string | null;
      brandId: number | null;
    }>();

    for (const cred of allCreds) {
      const key = `${cred.platform}:${cred.accountId || 'default'}`;
      credMap.set(key, {
        status: cred.status || 'unknown',
        cookieCount: (cred as Record<string, unknown>).cookieCount as number || 0,
        accountName: cred.accountName || (cred.accountId as string) || 'default',
        lastValidatedAt: (cred as Record<string, unknown>).lastValidatedAt as string | null || null,
        brandId: (cred as Record<string, unknown>).brandId as number | null || null,
      });
    }

    return profiles.map((profile) => {
      const platform = String(profile.platform || '');
      const account = String(profile.account || profile.accountName || 'default');
      const key = `${platform}:${account}`;
      const cred = credMap.get(key);

      return {
        ...profile,
        credential: cred || null,
      };
    });
  } catch {
    // If DB lookup fails, return profiles as-is
    return profiles;
  }
}

/**
 * Profile management routes — proxies to harvester's profile API.
 *
 * Mounted at: /api/profiles
 *
 * Endpoints:
 *   GET    /                          - List all profiles
 *   GET    /:platform                 - List profiles for a platform
 *   GET    /:platform/:account/health - Check login health
 *   DELETE /:platform/:account        - Delete a profile
 *   POST   /:platform/:account/renew  - Renew a single profile
 *   POST   /renew-all                 - Renew all profiles
 */
export function createProfileRoutes(db: DatabaseAccess): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const harvesterUrl = getHarvesterUrl();
  const client = new HarvesterClient(harvesterUrl);

  // GET / - List all profiles
  app.get('/', async (c) => {
    try {
      const profiles = await client.listProfiles();
      if (profiles === null) {
        return c.json(
          { success: false, error: 'Harvester service unavailable' },
          502,
        );
      }
      const enriched = enrichProfilesWithCredentials(
        profiles as unknown as Array<Record<string, unknown>>,
        db,
      );
      return c.json({
        success: true,
        total: enriched.length,
        profiles: enriched,
      });
    } catch (error) {
      return c.json(
        { success: false, error: formatError(error) },
        500,
      );
    }
  });

  // GET /:platform - List profiles for a specific platform
  app.get('/:platform', async (c) => {
    try {
      const platform = c.req.param('platform');
      const harvesterPlatform = getHarvesterPlatformName(platform);
      const profiles = await client.listProfiles();
      if (profiles === null) {
        return c.json(
          { success: false, error: 'Harvester service unavailable' },
          502,
        );
      }
      const enriched = enrichProfilesWithCredentials(
        profiles as unknown as Array<Record<string, unknown>>,
        db,
      );
      const platformProfiles = enriched.filter((p) => p.platform === harvesterPlatform);
      return c.json({
        success: true,
        platform,
        total: platformProfiles.length,
        accounts: platformProfiles,
      });
    } catch (error) {
      return c.json(
        { success: false, error: formatError(error) },
        500,
      );
    }
  });

  // GET /:platform/:account/health - Health check for a profile
  app.get('/:platform/:account/health', async (c) => {
    try {
      const platform = c.req.param('platform');
      const account = decodeURIComponent(c.req.param('account'));
      const harvesterPlatform = getHarvesterPlatformName(platform);
      const result = await client.checkProfileHealth(harvesterPlatform, account);
      if (result === null) {
        return c.json(
          { success: false, error: 'Harvester service unavailable' },
          502,
        );
      }
      return c.json(result);
    } catch (error) {
      return c.json(
        { success: false, error: formatError(error) },
        500,
      );
    }
  });

  // DELETE /:platform/:account - Delete a profile
  app.delete('/:platform/:account', async (c) => {
    try {
      const platform = c.req.param('platform');
      const account = decodeURIComponent(c.req.param('account'));
      const harvesterPlatform = getHarvesterPlatformName(platform);
      const deleted = await client.deleteProfile(harvesterPlatform, account);
      return c.json({
        success: deleted,
        platform,
        account,
        deleted,
      });
    } catch (error) {
      return c.json(
        { success: false, error: formatError(error) },
        500,
      );
    }
  });

  // POST /:platform/:account/renew - Renew a single profile
  app.post('/:platform/:account/renew', async (c) => {
    try {
      const platform = c.req.param('platform');
      const account = decodeURIComponent(c.req.param('account'));
      const harvesterPlatform = getHarvesterPlatformName(platform);
      const result = await client.renewProfile(harvesterPlatform, account);
      if (result === null) {
        return c.json(
          { success: false, error: 'Harvester service unavailable' },
          502,
        );
      }
      return c.json(result);
    } catch (error) {
      return c.json(
        { success: false, error: formatError(error) },
        500,
      );
    }
  });

  // POST /renew-all - Renew all profiles
  app.post('/renew-all', async (c) => {
    try {
      const result = await client.renewAllProfiles();
      if (result === null) {
        return c.json(
          { success: false, error: 'Harvester service unavailable' },
          502,
        );
      }
      return c.json(result);
    } catch (error) {
      return c.json(
        { success: false, error: formatError(error) },
        500,
      );
    }
  });

  return app;
}
