import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DB } from '../db.js';
import { DatabaseAccess } from '../db.js';
import { createTestDatabase, resetMockCounters } from '../test-helpers.js';
import { createEmptySession } from '@zemingengine/shared';

describe('DatabaseAccess - Sessions', () => {
  let db: DB;
  let dbAccess: DatabaseAccess;

  beforeEach(() => {
    ({ db, dbAccess } = createTestDatabase());
    resetMockCounters();
  });

  afterEach(() => {
    db.close();
  });

  it('should upsert and retrieve a session with correct data', () => {
    const session = createEmptySession('test-session-1');
    session.enterprise.fullName = '测试公司';
    dbAccess.sessions.upsertSession('test-session-1', session);

    const retrieved = dbAccess.sessions.getSession('test-session-1');
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe('test-session-1');
    expect(retrieved!.enterprise.fullName).toBe('测试公司', 'session enterprise data should be persisted correctly');
  });

  it('should update existing session on upsert', () => {
    const session = createEmptySession('test-session-2');
    dbAccess.sessions.upsertSession('test-session-2', session);

    session.enterprise.fullName = '更新后的公司';
    dbAccess.sessions.upsertSession('test-session-2', session);

    const retrieved = dbAccess.sessions.getSession('test-session-2');
    expect(retrieved!.enterprise.fullName).toBe('更新后的公司', 'upsert should overwrite existing session data');
  });

  it('should return undefined for non-existent session', () => {
    const result = dbAccess.sessions.getSession('non-existent');
    expect(result).toBeUndefined('non-existent session should return undefined');
  });

  it('should delete session and make it unretrievable', () => {
    const session = createEmptySession('test-session-3');
    dbAccess.sessions.upsertSession('test-session-3', session);
    dbAccess.sessions.deleteSession('test-session-3');
    expect(dbAccess.sessions.getSession('test-session-3')).toBeUndefined('deleted session should no longer be retrievable');
  });
});
