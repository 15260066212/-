import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('POST /api/credentials/sync', () => {
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

  beforeEach(() => {
    vi.clearAllMocks();
    // Clear credentials file by overwriting with empty object
    const credFile = path.join(tempDir, 'credentials.json');
    fs.writeFileSync(credFile, JSON.stringify({}), 'utf-8');
  });

  it('syncs all credentials successfully', async () => {
    await request(app)
      .put('/api/credentials/zhihu')
      .send({ type: 'cookie', data: { cookie: 'z_c0=abc' }, status: 'active' });

    await request(app)
      .put('/api/credentials/csdn')
      .send({ type: 'cookie', data: { cookie: 'session=xyz' }, status: 'active' });

    mockFetch.mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('OK'),
    });

    const res = await request(app).post('/api/credentials/sync');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(res.body.results.length).toBe(2);
    expect(res.body.results.every((r) => r.success)).toBe(true);

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('returns failure when a sync fails', async () => {
    await request(app)
      .put('/api/credentials/zhihu')
      .send({ type: 'cookie', data: { cookie: 'z_c0=abc' }, status: 'active' });

    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue('Internal Server Error'),
    });

    const res = await request(app).post('/api/credentials/sync');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.results.length).toBe(1);
    expect(res.body.results[0].success).toBe(false);
    expect(res.body.results[0].error).toContain('500');
  });

  it('skips credentials without cookie data', async () => {
    await request(app)
      .put('/api/credentials/juejin')
      .send({ type: 'password', data: { username: 'test' }, status: 'active' });

    const res = await request(app).post('/api/credentials/sync');
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBe(1);
    expect(res.body.results[0].success).toBe(false);
    expect(res.body.results[0].error).toBe('No cookie data');

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns success: true when no credentials exist', async () => {
    const res = await request(app).post('/api/credentials/sync');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.results).toEqual([]);
  });

  it('handles network errors gracefully', async () => {
    await request(app)
      .put('/api/credentials/toutiaohao')
      .send({ type: 'cookie', data: { cookie: 'sess=123' }, status: 'active' });

    mockFetch.mockRejectedValue(new Error('Network error'));

    const res = await request(app).post('/api/credentials/sync');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.results[0].success).toBe(false);
    expect(res.body.results[0].error).toContain('Network error');
  });

  it('sends correct payload structure to main server', async () => {
    await request(app)
      .put('/api/credentials/zhihu')
      .send({ type: 'cookie', data: { cookie: 'z_c0=test123' }, status: 'active' });

    mockFetch.mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('OK'),
    });

    await request(app).post('/api/credentials/sync');

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/credentials/zhihu');
    expect(options.method).toBe('PUT');
    expect(options.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(options.body);
    expect(body.platform).toBe('zhihu');
    expect(body.type).toBe('cookie');
    expect(body.data.cookie).toBe('z_c0=test123');
  });
});
