import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('Credentials API', () => {
  let app;
  let tempDir;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harvester-test-'));
    process.env.CREDENTIALS_DIR = tempDir;
    const server = await import('../../server.js');
    app = server.app;
  });

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
  });

  describe('GET /api/credentials', () => {
    it('returns empty list when no credentials saved', async () => {
      const res = await request(app).get('/api/credentials');
      expect(res.status).toBe(200, 'should set status to 200 for returns empty list when no credentials saved');
      expect(res.body.success).toBe(true, 'should return true when returns empty list when no credentials saved');
      expect(res.body.data).toEqual([], 'should return expected array for returns empty list when no credentials saved');
      expect(res.body.count).toBe(0, 'should set count to 0 for returns empty list when no credentials saved');
    });

    it('returns list with saved credentials', async () => {
      await request(app)
        .put('/api/credentials/zhihu')
        .send({ type: 'cookie', data: { cookie: 'a=1' }, status: 'active' });

      const res = await request(app).get('/api/credentials');
      expect(res.status).toBe(200, 'should set status to 200 for returns list with saved credentials');
      expect(res.body.success).toBe(true, 'should return true when returns list with saved credentials');
      expect(res.body.count).toBe(1, 'should set count to 1 for returns list with saved credentials');
      expect(res.body.data[0].platform).toBe('zhihu', 'should set data to zhihu for returns list with saved credentials');
      expect(res.body.data[0].hasCookie).toBe(true, 'should return true when returns list with saved credentials');
    });
  });

  describe('GET /api/credentials/:platform', () => {
    it('returns 404 for non-existent platform', async () => {
      const res = await request(app).get('/api/credentials/nonexistent');
      expect(res.status).toBe(404, 'should set status to 404 for returns 404 for non-existent platform');
      expect(res.body.success).toBe(false, 'should return false when returns 404 for non-existent platform');
      expect(res.body.error).toBeDefined('should be defined for 404 for non-existent platform');
    });

    it('returns credential data for existing platform', async () => {
      await request(app)
        .put('/api/credentials/csdn')
        .send({ type: 'cookie', data: { cookie: 'x=1' }, status: 'active' });

      const res = await request(app).get('/api/credentials/csdn');
      expect(res.status).toBe(200, 'should set status to 200 for returns credential data for existing platform');
      expect(res.body.success).toBe(true, 'should return true when returns credential data for existing platform');
      expect(res.body.data.platform).toBe('csdn', 'should set data to csdn for returns credential data for existing platform');
      expect(res.body.data.type).toBe('cookie', 'should set type to cookie for returns credential data for existing platform');
    });
  });

  describe('PUT /api/credentials/:platform', () => {
    it('creates a new credential', async () => {
      const res = await request(app)
        .put('/api/credentials/juejin')
        .send({ type: 'cookie', data: { cookie: 'sess=abc' }, status: 'active' });

      expect(res.status).toBe(200, 'should have correct status code when creates a new credential');
      expect(res.body.success).toBe(true, 'should have correct success flag when creates a new credential');
      expect(res.body.data.platform).toBe('juejin', 'should have correct platform when creates a new credential');
      expect(res.body.data.saved).toBe(true, 'should have correct saved when creates a new credential');

      const getRes = await request(app).get('/api/credentials/juejin');
      expect(getRes.status).toBe(200, 'should have correct status code when creates a new credential');
      expect(getRes.body.data.type).toBe('cookie', 'should have correct type when creates a new credential');
    });

    it('updates an existing credential', async () => {
      await request(app)
        .put('/api/credentials/toutiaohao')
        .send({ type: 'cookie', data: { cookie: 'old=1' }, status: 'active' });

      const res = await request(app)
        .put('/api/credentials/toutiaohao')
        .send({ type: 'cookie', data: { cookie: 'new=2' }, status: 'inactive' });

      expect(res.status).toBe(200, 'should have correct status code when updates an existing credential');
      expect(res.body.success).toBe(true, 'should have correct success flag when updates an existing credential');

      const getRes = await request(app).get('/api/credentials/toutiaohao');
      expect(getRes.body.data.status).toBe('inactive', 'should have correct status code when updates an existing credential');
      expect(getRes.body.data.data.cookie).toBe('new=2', 'should have correct cookie when updates an existing credential');
    });

    it('returns 400 for invalid platform', async () => {
      const res = await request(app)
        .put('/api/credentials/invalid-platform')
        .send({ type: 'cookie', data: {} });

      expect(res.status).toBe(400, 'should have correct status code when 400 for invalid platform');
      expect(res.body.success).toBe(false, 'should have correct success flag when 400 for invalid platform');
    });

    it('sets default values when not provided', async () => {
      const res = await request(app)
        .put('/api/credentials/sohuhao')
        .send({});

      expect(res.status).toBe(200, 'should have correct status code when sets default values when not provided');
      expect(res.body.success).toBe(true, 'should have correct success flag when sets default values when not provided');
      expect(res.body.data.status).toBe('active');
    });
  });

  describe('DELETE /api/credentials/:platform', () => {
    it('deletes an existing credential', async () => {
      await request(app)
        .put('/api/credentials/wangyihao')
        .send({ type: 'cookie', data: { cookie: 'x=1' } });

      const res = await request(app).delete('/api/credentials/wangyihao');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.deleted).toBe(true);

      const getRes = await request(app).get('/api/credentials/wangyihao');
      expect(getRes.status).toBe(404);
    });

    it('returns 404 for non-existent credential', async () => {
      const res = await request(app).delete('/api/credentials/nonexistent');
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });
});
