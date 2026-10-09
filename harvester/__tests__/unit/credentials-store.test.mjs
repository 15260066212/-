import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  loadCredentials,
  saveCredentials,
  getCredential,
  getAllCredentials,
  upsertCredential,
  deleteCredential,
} from '../../lib/credentials-store.js';

describe('credentials-store', () => {
  let tempDir;
  let testFile;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'creds-test-'));
    testFile = path.join(tempDir, 'credentials.json');
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
  });

  describe('loadCredentials', () => {
    it('returns empty object for non-existent file', () => {
      const result = loadCredentials(path.join(tempDir, 'nonexistent.json'));
      expect(result).toEqual({});
    });

    it('returns empty object for invalid JSON', () => {
      fs.writeFileSync(testFile, 'not valid json', 'utf-8');
      const result = loadCredentials(testFile);
      expect(result).toEqual({});
    });

    it('loads valid credentials from file', () => {
      const data = { zhihu: { platform: 'zhihu', type: 'cookie' } };
      fs.writeFileSync(testFile, JSON.stringify(data), 'utf-8');
      const result = loadCredentials(testFile);
      expect(result).toEqual(data);
    });
  });

  describe('saveCredentials', () => {
    it('saves credentials to a new file and creates directory', () => {
      const nestedFile = path.join(tempDir, 'sub', 'dir', 'creds.json');
      const data = { csdn: { platform: 'csdn', status: 'active' } };
      const result = saveCredentials(nestedFile, data);
      expect(result).toBe(true);
      expect(fs.existsSync(nestedFile)).toBe(true);

      const loaded = JSON.parse(fs.readFileSync(nestedFile, 'utf-8'));
      expect(loaded).toEqual(data);
    });

    it('overwrites existing file', () => {
      fs.writeFileSync(testFile, JSON.stringify({ old: true }), 'utf-8');
      const data = { new: true };
      saveCredentials(testFile, data);
      const loaded = JSON.parse(fs.readFileSync(testFile, 'utf-8'));
      expect(loaded).toEqual(data);
    });
  });

  describe('getCredential', () => {
    it('returns null for non-existent platform', () => {
      saveCredentials(testFile, {});
      expect(getCredential(testFile, 'unknown')).toBe(null);
    });

    it('returns credential data for existing platform', () => {
      const data = { zhihu: { platform: 'zhihu', cookie: 'abc' } };
      saveCredentials(testFile, data);
      const result = getCredential(testFile, 'zhihu');
      expect(result).toEqual({ platform: 'zhihu', cookie: 'abc' });
    });
  });

  describe('getAllCredentials', () => {
    it('returns all credentials', () => {
      const data = {
        zhihu: { platform: 'zhihu' },
        csdn: { platform: 'csdn' },
      };
      saveCredentials(testFile, data);
      const result = getAllCredentials(testFile);
      expect(result).toEqual(data);
    });

    it('returns empty object for empty file', () => {
      saveCredentials(testFile, {});
      expect(getAllCredentials(testFile)).toEqual({});
    });
  });

  describe('upsertCredential', () => {
    it('inserts a new credential', () => {
      saveCredentials(testFile, {});
      const result = upsertCredential(testFile, 'zhihu', { type: 'cookie', status: 'active' });
      expect(result).toBe(true);

      const cred = getCredential(testFile, 'zhihu');
      expect(cred.platform).toBe('zhihu');
      expect(cred.type).toBe('cookie');
      expect(cred.status).toBe('active');
      expect(cred.updatedAt).toBeDefined();
      expect(() => new Date(cred.updatedAt)).not.toThrow();
    });

    it('updates an existing credential', () => {
      saveCredentials(testFile, {
        zhihu: { platform: 'zhihu', type: 'old', updatedAt: '2020-01-01T00:00:00.000Z' },
      });
      const before = getCredential(testFile, 'zhihu');
      upsertCredential(testFile, 'zhihu', { type: 'new', status: 'active' });
      const after = getCredential(testFile, 'zhihu');

      expect(after.type).toBe('new');
      expect(after.status).toBe('active');
      expect(after.updatedAt).not.toBe(before.updatedAt);
    });

    it('always sets platform key', () => {
      upsertCredential(testFile, 'csdn', {});
      const cred = getCredential(testFile, 'csdn');
      expect(cred.platform).toBe('csdn');
    });
  });

  describe('deleteCredential', () => {
    it('deletes an existing credential and returns true', () => {
      saveCredentials(testFile, { zhihu: { platform: 'zhihu' } });
      const result = deleteCredential(testFile, 'zhihu');
      expect(result).toBe(true);
      expect(getCredential(testFile, 'zhihu')).toBe(null);
    });

    it('returns false for non-existent credential', () => {
      saveCredentials(testFile, {});
      const result = deleteCredential(testFile, 'unknown');
      expect(result).toBe(false);
    });

    it('does not affect other credentials', () => {
      saveCredentials(testFile, {
        zhihu: { platform: 'zhihu' },
        csdn: { platform: 'csdn' },
      });
      deleteCredential(testFile, 'zhihu');
      expect(getCredential(testFile, 'csdn')).not.toBe(null);
      expect(getCredential(testFile, 'zhihu')).toBe(null);
    });
  });
});
