import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Access the playwright mocks set up by the setup file via Module._load patch
const HTTP_STATUS_OK = 200;
const HTTP_STATUS_BAD_REQUEST = 400;
const HTTP_STATUS_NOT_FOUND = 404;
const HTTP_STATUS_INTERNAL_SERVER_ERROR = 500;

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
      expect(res.status).toBe(HTTP_STATUS_OK, 'should set status to expected value for returns empty list when no sessions');
      expect(res.body.success).toBe(true, 'should return true when returns empty list when no sessions');
      expect(res.body.sessions).toEqual([], 'should return expected array for returns empty list when no sessions');
      expect(res.body.count).toBe(0, 'should set count to 0 for returns empty list when no sessions');
    });
  });

  describe('POST /api/session/start', () => {
    it('starts a new session successfully', async () => {
      const res = await request(app)
        .post('/api/session/start')
        .send({ platform: 'zhihu' });

      expect(res.status).toBe(HTTP_STATUS_OK, 'should set status to expected value for starts a new session successfully');
      expect(res.body.success).toBe(true, 'should return true when starts a new session successfully');
      expect(res.body.sessionId).toBeDefined('should be defined for starts a new session successfully');
      expect(res.body.platform).toBe('zhihu', 'should set response to zhihu for starts a new session successfully');
      expect(res.body.noVncUrl).toBeDefined('should be defined for starts a new session successfully');
      expect(res.body.loginUrl).toBeDefined('should be defined for starts a new session successfully');
      expect(sessions.size).toBe(1, 'should set size to 1 for starts a new session successfully');
      expect(sessions.has(res.body.sessionId)).toBe(true, 'should return true when starts a new session successfully');
      expect(launchFn).toHaveBeenCalled('should have been called for starts a new session successfully');
    });

    it('returns 400 for invalid platform', async () => {
      const res = await request(app)
        .post('/api/session/start')
        .send({ platform: 'invalid-platform' });

      expect(res.status).toBe(HTTP_STATUS_BAD_REQUEST, 'should set status to expected value for returns 400 for invalid platform');
      expect(res.body.success).toBe(false, 'should return false when returns 400 for invalid platform');
      expect(sessions.size).toBe(0, 'should set size to 0 for returns 400 for invalid platform');
    });

    it('returns 400 when platform is missing', async () => {
      const res = await request(app)
        .post('/api/session/start')
        .send({});

      expect(res.status).toBe(HTTP_STATUS_BAD_REQUEST, 'should set status to expected value for returns 400 when platform is missing');
      expect(res.body.success).toBe(false, 'should return false when returns 400 when platform is missing');
    });

    it('returns 500 when browser launch fails', async () => {
      launchFn.mockRejectedValueOnce(new Error('Browser launch failed'));

      const res = await request(app)
        .post('/api/session/start')
        .send({ platform: 'csdn' });

      expect(res.status).toBe(HTTP_STATUS_INTERNAL_SERVER_ERROR, 'should set status to expected value for returns 500 when browser launch fails');
      expect(res.body.success).toBe(false, 'should have correct success flag when 500 when browser launch fails');
      expect(res.body.error).toContain('Failed to start browser', 'should contain expected value in error field for 500 when browser launch fails');
    });
  });

  describe('GET /api/session/:id/status', () => {
    it('returns 404 for non-existent session', async () => {
      const res = await request(app).get('/api/session/nonexistent/status');
      expect(res.status).toBe(HTTP_STATUS_NOT_FOUND, 'should have correct status code when 404 for non-existent session');
      expect(res.body.success).toBe(false, 'should have correct success flag when 404 for non-existent session');
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
      expect(res.status).toBe(HTTP_STATUS_OK, 'should have correct status code when status for existing session');
      expect(res.body.success).toBe(true, 'should have correct success flag when status for existing session');
      expect(res.body.sessionId).toBe(sessionId, 'should have correct sessionId when status for existing session');
      expect(res.body.platform).toBe('zhihu', 'should have correct platform when status for existing session');
      expect(res.body.loggedIn).toBe(true, 'should have correct loggedIn when status for existing session');
      expect(res.body.cookieCount).toBeGreaterThan(0, 'should be greater than expected for status for existing session');
    });
  });

  describe('GET /api/session/:id/cookies', () => {
    it('returns 404 for non-existent session', async () => {
      const res = await request(app).get('/api/session/nonexistent/cookies');
      expect(res.status).toBe(HTTP_STATUS_NOT_FOUND, 'should have correct status code when 404 for non-existent session');
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
      expect(res.status).toBe(HTTP_STATUS_OK);
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
      expect(res.status).toBe(HTTP_STATUS_OK);
      expect(res.body.success).toBe(true);
      expect(res.body.sessionId).toBe(sessionId);
      expect(sessions.size).toBe(0);
    });

    it('returns 404 for non-existent session', async () => {
      const res = await request(app).post('/api/session/nonexistent/close');
      expect(res.status).toBe(HTTP_STATUS_NOT_FOUND);
      expect(res.body.success).toBe(false);
    });
  });
});
