import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('GET /api/platforms', () => {
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

  it('returns list of all supported platforms', async () => {
    const res = await request(app).get('/api/platforms');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBeGreaterThan(0);
    expect(Array.isArray(res.body.platforms)).toBe(true);
  });

  it('includes expected platform names', async () => {
    const res = await request(app).get('/api/platforms');
    const platformIds = res.body.platforms.map((p) => p.id);

    expect(platformIds).toContain('zhihu');
    expect(platformIds).toContain('csdn');
    expect(platformIds).toContain('juejin');
    expect(platformIds).toContain('bilibili');
    expect(platformIds).toContain('wechat');
  });

  it('each platform has required fields', async () => {
    const res = await request(app).get('/api/platforms');
    for (const p of res.body.platforms) {
      expect(p).toHaveProperty('id');
      expect(p).toHaveProperty('name');
      expect(p).toHaveProperty('loginUrl');
      expect(p).toHaveProperty('hasCredentials');
    }
  });

  it('reports no credentials when store is empty', async () => {
    const res = await request(app).get('/api/platforms');
    const allNoCreds = res.body.platforms.every((p) => p.hasCredentials === false);
    expect(allNoCreds).toBe(true);
  });

  it('count matches platform array length', async () => {
    const res = await request(app).get('/api/platforms');
    expect(res.body.count).toBe(res.body.platforms.length);
  });
});
