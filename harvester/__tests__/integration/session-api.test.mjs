import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Access the playwright mocks set up by the setup file via Module._load patch
const { launchFn, browserMock, contextMock, pageMock } = global.__playwrightMocks;

describe('Session API', () => {
  let app;
  let sessions;
  let tempDir;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harvester-test-'));
    process.env.CREDENTIALS_DIR = tempDir;

    const server = await import('../../server.js');
    app = server.app;
    sessions = server.sessions;
  });

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
  });

  beforeEach(() => {
    launchFn.mockClear();
    browserMock.newContext.mockClear();
    contextMock.newPage.mockClear();
    contextMock.cookies.mockClear();
    contextMock.cookies.mockResolvedValue([]);
    contextMock.close.mockClear();
    browserMock.close.mockClear();
    pageMock.goto.mockClear();
    pageMock.close.mockClear();

    sessions.clear();
  });

  describe('GET /api/sessions', () => {
    it('returns empty list when no sessions', async () => {
      const res = await request(app).get('/api/sessions');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.sessions).toEqual([]);
      expect(res.body.count).toBe(0);
    });
  });

  describe('POST /api/session/start', () => {
    it('starts a new session successfully', async () => {
      const res = await request(app)
        .post('/api/session/start')
        .send({ platform: 'zhihu' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.sessionId).toBeDefined();
      expect(res.body.platform).toBe('zhihu');
      expect(res.body.noVncUrl).toBeDefined();
      expect(res.body.loginUrl).toBeDefined();
      expect(sessions.size).toBe(1);
      expect(sessions.has(res.body.sessionId)).toBe(true);
      expect(launchFn).toHaveBeenCalled();
    });

    it('returns 400 for invalid platform', async () => {
      const res = await request(app)
        .post('/api/session/start')
        .send({ platform: 'invalid-platform' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(sessions.size).toBe(0);
    });

    it('returns 400 when platform is missing', async () => {
      const res = await request(app)
        .post('/api/session/start')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 500 when browser launch fails', async () => {
      launchFn.mockRejectedValueOnce(new Error('Browser launch failed'));

      const res = await request(app)
        .post('/api/session/start')
        .send({ platform: 'csdn' });

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Failed to start browser');
    });
  });

  describe('GET /api/session/:id/status', () => {
    it('returns 404 for non-existent session', async () => {
      const res = await request(app).get('/api/session/nonexistent/status');
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('returns status for existing session', async () => {
      const startRes = await request(app)
        .post('/api/session/start')
        .send({ platform: 'zhihu' });

      const sessionId = startRes.body.sessionId;

      contextMock.cookies.mockResolvedValue([
        { name: 'z_c0', value: 'test', domain: '.zhihu.com' },
      ]);

      const res = await request(app).get(`/api/session/${sessionId}/status`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.sessionId).toBe(sessionId);
      expect(res.body.platform).toBe('zhihu');
      expect(res.body.loggedIn).toBe(true);
      expect(res.body.cookieCount).toBeGreaterThan(0);
    });
  });

  describe('GET /api/session/:id/cookies', () => {
    it('returns 404 for non-existent session', async () => {
      const res = await request(app).get('/api/session/nonexistent/cookies');
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('returns cookies for existing session', async () => {
      const startRes = await request(app)
        .post('/api/session/start')
        .send({ platform: 'zhihu' });

      const sessionId = startRes.body.sessionId;

      contextMock.cookies.mockResolvedValue([
        { name: 'z_c0', value: 'abc123', domain: '.zhihu.com', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' },
        { name: 'other', value: 'val', domain: '.other.com', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' },
      ]);

      const res = await request(app).get(`/api/session/${sessionId}/cookies`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.cookieCount).toBe(1);
      expect(res.body.cookieString).toContain('z_c0=abc123');
      expect(Array.isArray(res.body.cookies)).toBe(true);
    });
  });

  describe('POST /api/session/:id/close', () => {
    it('closes an existing session successfully', async () => {
      const startRes = await request(app)
        .post('/api/session/start')
        .send({ platform: 'juejin' });

      const sessionId = startRes.body.sessionId;
      expect(sessions.size).toBe(1);

      const res = await request(app).post(`/api/session/${sessionId}/close`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.sessionId).toBe(sessionId);
      expect(sessions.size).toBe(0);
    });

    it('returns 404 for non-existent session', async () => {
      const res = await request(app).post('/api/session/nonexistent/close');
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });
});
