import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DB } from '../db.js';
import { DatabaseAccess } from '../db.js';
import { createTestDatabase, resetMockCounters } from '../test-helpers.js';
import type { PipelineRun } from '@zemingengine/shared';

describe('DatabaseAccess - Pipeline Runs', () => {
  let db: DB;
  let dbAccess: DatabaseAccess;

  beforeEach(() => {
    ({ db, dbAccess } = createTestDatabase());
    resetMockCounters();
  });

  afterEach(() => {
    db.close();
  });

  it('should insert and retrieve a pipeline run by id', () => {
    const run: PipelineRun = {
      id: 'run-1',
      sessionId: 'session-1',
      status: 'running',
      totalArticles: 5,
      completedArticles: 0,
      startedAt: new Date().toISOString(),
    };
    dbAccess.pipeline.insertPipelineRun(run);

    const retrieved = dbAccess.pipeline.getPipelineRun('run-1');
    expect(retrieved).toBeDefined();
    expect(retrieved!.status).toBe('running');
    expect(retrieved!.totalArticles).toBe(5, 'pipeline run totalArticles should be preserved');
  });

  it('should update pipeline run progress fields', () => {
    const run: PipelineRun = {
      id: 'run-2',
      sessionId: 'session-2',
      status: 'running',
      totalArticles: 3,
      completedArticles: 0,
      startedAt: new Date().toISOString(),
    };
    dbAccess.pipeline.insertPipelineRun(run);
    dbAccess.pipeline.updatePipelineRun('run-2', {
      completedArticles: 2,
      currentPlatform: 'zhihu',
      currentRound: 1,
    });

    const updated = dbAccess.pipeline.getPipelineRun('run-2');
    expect(updated!.completedArticles).toBe(2);
    expect(updated!.currentPlatform).toBe('zhihu', 'currentPlatform should be updated during progress');
  });

  it('should mark pipeline run as completed with finished timestamp', () => {
    const run: PipelineRun = {
      id: 'run-3',
      sessionId: 'session-3',
      status: 'running',
      totalArticles: 2,
      completedArticles: 0,
      startedAt: new Date().toISOString(),
    };
    dbAccess.pipeline.insertPipelineRun(run);
    dbAccess.pipeline.updatePipelineRun('run-3', {
      status: 'completed',
      completedArticles: 2,
      completedAt: new Date().toISOString(),
    });

    const updated = dbAccess.pipeline.getPipelineRun('run-3');
    expect(updated!.status).toBe('completed');
    expect(updated!.completedAt).toBeDefined('completedAt should be set when pipeline finishes');
  });

  it('should get the latest pipeline run by session id', () => {
    dbAccess.pipeline.insertPipelineRun({
      id: 'run-old', sessionId: 'session-4', status: 'completed', totalArticles: 1, completedArticles: 1,
      startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T01:00:00Z',
    });
    dbAccess.pipeline.insertPipelineRun({
      id: 'run-new', sessionId: 'session-4', status: 'running', totalArticles: 3, completedArticles: 0,
      startedAt: '2026-08-03T00:00:00Z',
    });

    const latest = dbAccess.pipeline.getLatestPipelineRunBySession('session-4');
    expect(latest).toBeDefined();
    expect(latest!.id).toBe('run-new', 'the most recently started run should be returned');
  });
});
