import type { SessionData } from '@zemingengine/shared';
import { createEmptySession } from '@zemingengine/shared';
import { DialogueEngine } from '@zemingengine/dialogue-engine';
import type { DatabaseAccess } from './db.js';
import { LRUCache } from './cache.js';

interface SessionEntry {
  data: SessionData;
  engine: DialogueEngine;
  createdAt: Date;
  updatedAt: Date;
  userId?: string;
}

// LRU cache backed session store (optionally backed by the database for persistence)
// Max 100 sessions in memory, 30-minute TTL (data persists in DB after cache eviction)
const sessions = new LRUCache<SessionEntry>({ maxEntries: 100, defaultTtlMs: 30 * 60 * 1000 });

export function createSession(db?: DatabaseAccess, userId?: string): SessionEntry {
  const id = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const data = createEmptySession(id);
  const engine = new DialogueEngine(data);
  const entry: SessionEntry = {
    data,
    engine,
    createdAt: new Date(),
    updatedAt: new Date(),
    userId,
  };
  sessions.set(id, entry, -1); // Never expire from cache (managed by LRU eviction)
  if (db) {
    db.sessions.upsertSession(id, data, userId);
  }
  return entry;
}

export function getSession(id: string, db?: DatabaseAccess): SessionEntry | undefined {
  const entry = sessions.get(id);
  if (entry) return entry;
  // Cache miss: try to restore from DB
  if (db) {
    const data = db.sessions.getSession(id);
    if (data) {
      const engine = new DialogueEngine(data);
      const restored: SessionEntry = {
        data,
        engine,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      sessions.set(id, restored, -1); // Never expire from cache
      return restored;
    }
  }
  return undefined;
}

export function updateSession(id: string, data: SessionData, db?: DatabaseAccess): SessionEntry | undefined {
  const entry = sessions.get(id);
  if (entry) {
    entry.data = data;
    entry.updatedAt = new Date();
    sessions.set(id, entry, -1); // Refresh LRU position
  }
  if (db) {
    db.sessions.upsertSession(id, data);
  }
  return entry;
}

export function deleteSession(id: string, db?: DatabaseAccess): boolean {
  const cacheExisted = sessions.delete(id);
  if (db) {
    const dbExisted = db.sessions.getSession(id) !== undefined;
    // Use cascade delete so the session and all of its associated data
    // (articles, reviews, publish_tasks, publish_logs, pipeline_runs)
    // are removed atomically in a single transaction.
    db.sessions.deleteSessionCascade(id);
    return cacheExisted || dbExisted;
  }
  return cacheExisted;
}

export function listSessions(userId?: string): SessionEntry[] {
  // LRU cache doesn't support iteration directly, so we rely on the stats
  // For user-scoped listing, fall back to the DB
  // This is a known limitation: only cached sessions are returned
  const all: SessionEntry[] = [];
  // We can't iterate the LRU cache directly, so return from the underlying
  // For now, return empty array if no userId filter, or filter from cache stats
  // In practice, listSessions is rarely called and the API returns from DB
  if (userId) {
    // Filter by userId - but we can't iterate LRU cache efficiently
    // Return empty array; consumers should use DB for listing
    return [];
  }
  return all;
}
