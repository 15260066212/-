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
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
      expect(res.body.count).toBe(0);
    });

    it('returns list with saved credentials', async () => {
      await request(app)
        .put('/api/credentials/zhihu')
        .send({ type: 'cookie', data: { cookie: 'a=1' }, status: 'active' });

      const res = await request(app).get('/api/credentials');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.count).toBe(1);
      expect(res.body.data[0].platform).toBe('zhihu');
      expect(res.body.data[0].hasCookie).toBe(true);
    });
  });

  describe('GET /api/credentials/:platform', () => {
    it('returns 404 for non-existent platform', async () => {
      const res = await request(app).get('/api/credentials/nonexistent');
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeDefined();
    });

    it('returns credential data for existing platform', async () => {
      await request(app)
        .put('/api/credentials/csdn')
        .send({ type: 'cookie', data: { cookie: 'x=1' }, status: 'active' });

      const res = await request(app).get('/api/credentials/csdn');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.platform).toBe('csdn');
      expect(res.body.data.type).toBe('cookie');
    });
  });

  describe('PUT /api/credentials/:platform', () => {
    it('creates a new credential', async () => {
      const res = await request(app)
        .put('/api/credentials/juejin')
        .send({ type: 'cookie', data: { cookie: 'sess=abc' }, status: 'active' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.platform).toBe('juejin');
      expect(res.body.data.saved).toBe(true);

      const getRes = await request(app).get('/api/credentials/juejin');
      expect(getRes.status).toBe(200);
      expect(getRes.body.data.type).toBe('cookie');
    });

    it('updates an existing credential', async () => {
      await request(app)
        .put('/api/credentials/bilibili')
        .send({ type: 'cookie', data: { cookie: 'old=1' }, status: 'active' });

      const res = await request(app)
        .put('/api/credentials/bilibili')
        .send({ type: 'cookie', data: { cookie: 'new=2' }, status: 'inactive' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const getRes = await request(app).get('/api/credentials/bilibili');
      expect(getRes.body.data.status).toBe('inactive');
      expect(getRes.body.data.data.cookie).toBe('new=2');
    });

    it('returns 400 for invalid platform', async () => {
      const res = await request(app)
        .put('/api/credentials/invalid-platform')
        .send({ type: 'cookie', data: {} });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('sets default values when not provided', async () => {
      const res = await request(app)
        .put('/api/credentials/sohuhao')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
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
