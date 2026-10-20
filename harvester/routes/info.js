/**
 * Platform listing, session listing, credentials CRUD, and health check.
 */

const {
  sessions,
  loadCredentials,
  getCredential,
  upsertCredential,
  deleteCredential,
  getAllCredentials,
  MAIN_SERVER_URL,
  NODE_ID,
  NODE_NAME,
} = require('../config');
const { PLATFORM_URLS, PLATFORM_NAMES } = require('../config/platforms');

function registerInfoRoutes(app) {
  /**
   * GET /api/platforms
   */
  app.get('/api/platforms', (req, res) => {
    const creds = loadCredentials();
    const platforms = Object.entries(PLATFORM_URLS).map(([id, url]) => ({
      id,
      name: PLATFORM_NAMES[id],
      loginUrl: url,
      hasCredentials: !!creds[id] && creds[id].status === 'active',
    }));

    res.json({ success: true, platforms, count: platforms.length });
  });

  /**
   * GET /api/sessions
   */
  app.get('/api/sessions', (req, res) => {
    const activeSessions = Array.from(sessions.entries()).map(([id, s]) => ({
      sessionId: id,
      platform: s.platform,
      platformName: PLATFORM_NAMES[s.platform],
      createdAt: s.createdAt.toISOString(),
      elapsed: Date.now() - s.createdAt.getTime(),
    }));

    res.json({ success: true, sessions: activeSessions, count: activeSessions.length });
  });

  /**
   * GET /api/credentials
   */
  app.get('/api/credentials', (req, res) => {
    const creds = loadCredentials();
    const list = Object.values(creds).map(c => ({
      platform: c.platform,
      platformName: c.platformName || PLATFORM_NAMES[c.platform] || c.platform,
      type: c.type,
      status: c.status,
      cookieCount: c.cookieCount || 0,
      updatedAt: c.updatedAt,
      lastValidatedAt: c.lastValidatedAt,
      hasCookie: !!(c.data && c.data.cookie),
    }));

    res.json({ success: true, data: list, count: list.length });
  });

  /**
   * GET /api/credentials/:platform
   */
  app.get('/api/credentials/:platform', (req, res) => {
    const { platform } = req.params;
    const cred = getCredential(platform);
    if (!cred) {
      return res.status(404).json({ success: false, error: 'Credentials not found' });
    }
    res.json({ success: true, data: cred });
  });

  /**
   * PUT /api/credentials/:platform
   */
  app.put('/api/credentials/:platform', (req, res) => {
    const { platform } = req.params;
    if (!PLATFORM_URLS[platform]) {
      return res.status(400).json({ success: false, error: `Invalid platform: ${platform}` });
    }

    const { type, data, status } = req.body;
    const saved = upsertCredential(platform, {
      type: type || 'cookie',
      data: data || {},
      status: status || 'active',
      cookieCount: (data && data.cookie) ? data.cookie.split(';').length : 0,
      lastValidatedAt: new Date().toISOString(),
      platformName: PLATFORM_NAMES[platform],
    });

    if (saved) {
      res.json({ success: true, data: { platform, status: status || 'active', saved: true } });
    } else {
      res.status(500).json({ success: false, error: 'Failed to save credentials' });
    }
  });

  /**
   * DELETE /api/credentials/:platform
   */
  app.delete('/api/credentials/:platform', (req, res) => {
    const { platform } = req.params;
    const deleted = deleteCredential(platform);
    if (deleted) {
      res.json({ success: true, data: { deleted: true } });
    } else {
      res.status(404).json({ success: false, error: 'Credentials not found' });
    }
  });

  /**
   * POST /api/credentials/sync
   */
  app.post('/api/credentials/sync', async (req, res) => {
    try {
      const creds = getAllCredentials();
      const results = [];

      for (const [key, cred] of Object.entries(creds)) {
        if (!cred.data || !cred.data.cookie) {
          results.push({ platform: key, success: false, error: 'No cookie data' });
          continue;
        }

        // 解析 key：格式为 "accountName:platform" 或 "platform"
        // 如果 key 包含冒号，前面是 accountName，后面是 platform
        // 如果不包含冒号，整个 key 是 platform，使用节点默认 accountId
        let accountId, accountName, platform;
        const colonIdx = key.indexOf(':');
        if (colonIdx > 0 && colonIdx < key.length - 1) {
          accountName = key.slice(0, colonIdx);
          platform = key.slice(colonIdx + 1);
          accountId = accountName; // 有名有姓的账号，用账号名作为 accountId
        } else {
          platform = key;
          // 无账号名的默认凭证，使用节点 ID 作为 accountId 实现多机隔离
          accountId = NODE_ID !== 'default' ? NODE_ID : 'default';
          accountName = NODE_NAME;
        }

        const payload = {
          platform,
          accountId,
          accountName,
          nodeId: NODE_ID,
          nodeName: NODE_NAME,
          type: 'cookie',
          cookie: cred.data.cookie,
          status: cred.status || 'active',
        };

        try {
          const resp = await fetch(`${MAIN_SERVER_URL}/api/credentials/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

          if (resp.ok) {
            results.push({ platform, success: true });
            console.log(`[Sync] Synced ${platform} credentials to main server (accountId=${accountId})`);
          } else {
            const text = await resp.text();
            results.push({ platform, success: false, error: `Server ${resp.status}: ${text}` });
          }
        } catch (e) {
          results.push({ platform, success: false, error: e.message });
        }
      }

      const succeeded = results.filter(r => r.success).length;
      res.json({ success: true, synced: succeeded, total: results.length, results });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * GET /health
   */
  app.get('/health', (req, res) => {
    const creds = loadCredentials();
    res.json({
      success: true,
      status: 'healthy',
      activeSessions: sessions.size,
      savedCredentials: Object.keys(creds).length,
      uptime: process.uptime(),
    });
  });
}

module.exports = { registerInfoRoutes };
