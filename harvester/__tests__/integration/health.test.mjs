import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('GET /health', () => {
  let app;
  let tempDir;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harvester-test-'));
    process.env.CREDENTIALS_DIR = tempDir;
    // Use dynamic import after setting env var
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

  it('returns 200 with health status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('healthy');
    expect(res.body.activeSessions).toBeDefined();
    expect(res.body.savedCredentials).toBe(0);
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
  });
});
