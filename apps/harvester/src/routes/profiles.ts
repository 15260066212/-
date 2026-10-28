/**
 * Account profile management routes.
 *
 * Endpoints:
 *   GET    /api/profiles              — list all account profiles
 *   GET    /api/profiles/:platform    — list profiles for a platform
 *   GET    /api/profiles/:platform/:account/health — check login state
 *   DELETE /api/profiles/:platform/:account — delete a profile
 */

import type { Express, Request, Response } from 'express';
import {
  listAccountProfiles,
  profileExists,
  deleteAccountProfile,
  getProfileSize,
  launchAccountProfile,
  closeProfileContext,
  renewProfile,
  renewAllProfiles,
} from '../lib/account-profiles.js';
import { verifyLoginState } from '../lib/publish-context.js';

export function registerProfileRoutes(app: Express): void {
  // List all profiles
  app.get('/api/profiles', (_req: Request, res: Response) => {
    const profiles = listAccountProfiles();
    res.json({
      success: true,
      count: profiles.length,
      profiles,
    });
  });

  // List profiles for a platform
  app.get('/api/profiles/:platform', (req: Request, res: Response) => {
    const { platform } = req.params;
    const profiles = listAccountProfiles().filter((p) => p.platform === platform);
    res.json({
      success: true,
      platform,
      count: profiles.length,
      profiles,
    });
  });

  // Check profile login health
  app.get('/api/profiles/:platform/:account/health', async (req: Request, res: Response) => {
    const { platform, account } = req.params;

    if (!profileExists(platform, account)) {
      return res.status(404).json({
        success: false,
        error: 'Profile not found',
        platform,
        account,
      });
    }

    try {
      const { context, isPersistent } = await launchAccountProfile(platform, account, {
        headless: true,
      });

      const loggedIn = await verifyLoginState(context, platform);
      const size = getProfileSize(platform, account);

      await closeProfileContext(context);

      res.json({
        success: true,
        platform,
        account,
        isPersistent,
        loggedIn,
        sizeBytes: size,
        sizeHuman: formatBytes(size),
        checkedAt: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: formatError(error),
        platform,
        account,
      });
    }
  });

  // Delete a profile
  app.delete('/api/profiles/:platform/:account', (req: Request, res: Response) => {
    const { platform, account } = req.params;
    const deleted = deleteAccountProfile(platform, account);
    res.json({
      success: deleted,
      platform,
      account,
      deleted,
    });
  });

  // --- Renew a single profile (refresh cookies) ---
  app.post('/api/profiles/:platform/:account/renew', async (req: Request, res: Response) => {
    const { platform, account } = req.params;
    try {
      const result = await renewProfile(platform, account);
      res.json({
        success: result.success,
        platform,
        account,
        loggedIn: result.loggedIn,
        error: result.error,
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: formatError(err),
      });
    }
  });

  // --- Renew all profiles ---
  app.post('/api/profiles/renew-all', async (_req: Request, res: Response) => {
    try {
      const result = await renewAllProfiles();
      res.json(result);
    } catch (err) {
      res.status(500).json({
        success: false,
        error: formatError(err),
      });
    }
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
