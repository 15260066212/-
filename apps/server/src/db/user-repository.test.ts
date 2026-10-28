import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DB } from '../db.js';
import { DatabaseAccess } from '../db.js';
import { createTestDatabase, resetMockCounters } from '../test-helpers.js';

describe('DatabaseAccess - Users', () => {
  let db: DB;
  let dbAccess: DatabaseAccess;

  beforeEach(() => {
    ({ db, dbAccess } = createTestDatabase());
    resetMockCounters();
  });

  afterEach(() => {
    db.close();
  });

  it('should insert and find a user by username', () => {
    const user = {
      id: 'user-test-1',
      username: 'testuser',
      displayName: 'Test User',
      role: 'user' as const,
      apiKey: 'test-api-key-123',
      passwordHash: 'hash123',
      createdAt: new Date().toISOString(),
    };
    dbAccess.users.insertUser(user);

    const found = dbAccess.users.getUserByUsername('testuser');
    expect(found).toBeDefined();
    expect(found!.id).toBe('user-test-1');
    expect(found!.username).toBe('testuser');
    expect(found!.displayName).toBe('Test User', 'user displayName should be persisted');
  });

  it('should find a user by api key', () => {
    const user = {
      id: 'user-test-2',
      username: 'testuser2',
      displayName: 'Test User 2',
      role: 'admin' as const,
      apiKey: 'api-key-456',
      createdAt: new Date().toISOString(),
    };
    dbAccess.users.insertUser(user);

    const found = dbAccess.users.getUserByApiKey('api-key-456');
    expect(found).toBeDefined();
    expect(found!.username).toBe('testuser2');
    expect(found!.role).toBe('admin', 'user role should be preserved');
  });

  it('should find a user by id', () => {
    const user = {
      id: 'user-test-3',
      username: 'testuser3',
      displayName: 'Test User 3',
      role: 'user' as const,
      apiKey: 'api-key-789',
      createdAt: new Date().toISOString(),
    };
    dbAccess.users.insertUser(user);

    const found = dbAccess.users.getUserById('user-test-3');
    expect(found).toBeDefined();
    expect(found!.username).toBe('testuser3', 'user should be retrievable by id');
  });

  it('should return undefined for non-existent users', () => {
    expect(dbAccess.users.getUserByUsername('nonexistent')).toBeUndefined();
    expect(dbAccess.users.getUserByApiKey('no-such-key')).toBeUndefined();
    expect(dbAccess.users.getUserById('no-such-id')).toBeUndefined('non-existent user id should return undefined');
  });

  it('should list all users with correct count', () => {
    const initialCount = dbAccess.users.listUsers().length;
    dbAccess.users.insertUser({
      id: 'user-list-1',
      username: 'listuser1',
      displayName: 'List User 1',
      role: 'user',
      apiKey: 'list-key-1',
      createdAt: new Date().toISOString(),
    });
    dbAccess.users.insertUser({
      id: 'user-list-2',
      username: 'listuser2',
      displayName: 'List User 2',
      role: 'user',
      apiKey: 'list-key-2',
      createdAt: new Date().toISOString(),
    });

    const users = dbAccess.users.listUsers();
    expect(users.length).toBe(initialCount + 2, 'listUsers should return all users including newly inserted ones');
  });

  it('should delete a user and make them unretrievable', () => {
    dbAccess.users.insertUser({
      id: 'user-delete-1',
      username: 'deleteuser',
      displayName: 'Delete User',
      role: 'user',
      apiKey: 'delete-key',
      createdAt: new Date().toISOString(),
    });

    expect(dbAccess.users.getUserById('user-delete-1')).toBeDefined();
    dbAccess.users.deleteUser('user-delete-1');
    expect(dbAccess.users.getUserById('user-delete-1')).toBeUndefined('deleted user should no longer be retrievable');
  });

  it('should prevent deletion of the default user', () => {
    // Default user should be protected from deletion (throws error)
    expect(() => dbAccess.users.deleteUser('user_default')).toThrow();
    // Default user should still exist after the attempted deletion
    expect(dbAccess.users.getUserById('user_default')).toBeDefined('default user should survive attempted deletion');
  });

  it('should regenerate user api key with a new non-empty value', () => {
    dbAccess.users.insertUser({
      id: 'user-regen-1',
      username: 'regenuser',
      displayName: 'Regen User',
      role: 'user',
      apiKey: 'old-api-key',
      createdAt: new Date().toISOString(),
    });

    const updated = dbAccess.users.regenerateUserApiKey('user-regen-1');
    expect(updated).toBeDefined();
    expect(updated!.apiKey).not.toBe('old-api-key');
    expect(updated!.apiKey.length).toBeGreaterThan(0, 'regenerated api key should be non-empty');
  });
});
