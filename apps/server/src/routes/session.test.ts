import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DB } from '../db.js';
import { DatabaseAccess } from '../db.js';
import { createTestDatabase } from '../test-helpers.js';
import { createEmptySession } from '@zemingengine/shared';
import { createSessionRoutes } from './session.js';

let db: DB;
let dbAccess: DatabaseAccess;

beforeEach(() => {
  ({ db, dbAccess } = createTestDatabase());
});

afterEach(() => {
  db.close();
});

describe('Session Routes', () => {
  let app: ReturnType<typeof createSessionRoutes>;

  beforeEach(() => {
    app = createSessionRoutes(dbAccess);
  });

  it('POST / - should create a new session and return sessionId, sessionData, introMessage', async () => {
    const res = await app.request('/', { method: 'POST' });
    const json = await res.json();

    expect(res.status).toBe(200, 'should have correct status code when POST / - should create a new session and return sessionId...');
    expect(json.success).toBe(true, 'should have correct success flag when POST / - should create a new session and return sessionId...');
    expect(json.data.sessionId).toEqual(expect.any(String), 'should match expected sessionId for POST / - should create a new session and return sessionId...');
    expect(json.data.sessionData).toBeDefined('should be defined for POST / - should create a new session and return sessionId...');
    expect(json.data.sessionData.id).toBe(json.data.sessionId, 'should have correct id when POST / - should create a new session and return sessionId...');
    expect(json.data.introMessage).toBeDefined('should be defined for POST / - should create a new session and return sessionId...');
    expect(json.data.introMessage.role).toEqual(expect.any(String), 'should match expected role for POST / - should create a new session and return sessionId...');
    expect(json.data.introMessage.content).toEqual(expect.any(String), 'introMessage should contain text content');
  });

  it('GET /:id - should return 200 for an existing session', async () => {
    // Insert a session directly into the DB (tests the db-restore path of getSession)
    const id = `test-session-get-${Date.now()}`;
    dbAccess.sessions.upsertSession(id, createEmptySession(id));

    const res = await app.request('/' + id);
    const json = await res.json();

    expect(res.status).toBe(200, 'should have correct status code when GET /:id - should return 200 for an existing session');
    expect(json.success).toBe(true, 'should have correct success flag when GET /:id - should return 200 for an existing session');
    expect(json.data.sessionData).toBeDefined('should be defined for GET /:id - should return 200 for an existing session');
    expect(json.data.sessionData.id).toBe(id, 'should have correct id when GET /:id - should return 200 for an existing session');
    expect(json.data.progress).toBeDefined('progress data should be included in session response');
  });

  it('GET /:id - should return 404 for a non-existent session', async () => {
    const res = await app.request('/definitely-nonexistent-session-' + Date.now());
    const json = await res.json();

    expect(res.status).toBe(404, 'should have correct status code when GET /:id - should return 404 for a non-existent session');
    expect(json.success).toBe(false, 'should have correct success flag when GET /:id - should return 404 for a non-existent session');
    expect(json.error).toBeDefined('error message should be provided for 404 responses');
  });

  it('GET / - should list all sessions', async () => {
    // Create a session via the endpoint so it lands in the in-memory store
    const createRes = await app.request('/', { method: 'POST' });
    const createJson = await createRes.json();
    const sessionId = createJson.data.sessionId;

    const res = await app.request('/');
    const json = await res.json();

    expect(res.status).toBe(200, 'should have correct status code when GET / - should list all sessions');
    expect(json.success).toBe(true, 'should have correct success flag when GET / - should list all sessions');
    expect(Array.isArray(json.data)).toBe(true);
    const found = json.data.find((s: { id: string }) => s.id === sessionId);
    expect(found).toBeDefined();
    expect(found.id).toBe(sessionId);
    expect(found.stage).toBeDefined();
    expect(found.createdAt).toBeDefined();
    expect(found.updatedAt).toBeDefined('createdAt and updatedAt timestamps should be present');
  });

  it('DELETE /:id - should return 200 and make session unretrievable', async () => {
    const createRes = await app.request('/', { method: 'POST' });
    const createJson = await createRes.json();
    const sessionId = createJson.data.sessionId;

    const res = await app.request('/' + sessionId, { method: 'DELETE' });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);

    // Session should no longer be retrievable
    const getRes = await app.request('/' + sessionId);
    expect(getRes.status).toBe(404, 'deleted session should return 404 on subsequent GET');
  });

  it('DELETE /:id - should return 404 for a non-existent session', async () => {
    const res = await app.request('/definitely-nonexistent-session-' + Date.now(), { method: 'DELETE' });
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.success).toBe(false, 'deleting a non-existent session should fail');
  });
});
