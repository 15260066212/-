import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DB } from '../db.js';
import { DatabaseAccess } from '../db.js';
import {
  createTestDatabase,
  createMockArticle,
  createMockReview,
  createMockPublishTask,
  createMockPipelineRun,
} from '../test-helpers.js';
import type { PipelineRun, PublishTask } from '@zemingengine/shared';
import { createPipelineRoutes } from './pipeline.js';

let db: DB;
let dbAccess: DatabaseAccess;

beforeEach(() => {
  ({ db, dbAccess } = createTestDatabase());
});

afterEach(() => {
  db.close();
});

describe('Pipeline Routes', () => {
  let app: ReturnType<typeof createPipelineRoutes>;

  beforeEach(() => {
    app = createPipelineRoutes(dbAccess);
  });

  it('GET /status/:sessionId - should return article counts and summaries', async () => {
    const sessionId = 'pipe-session-status';

    // Insert mock articles with different statuses
    dbAccess.articles.insertArticle(createMockArticle({
      id: 'art_pipe_draft', sessionId, status: 'draft', platform: 'weixin',
    }));
    dbAccess.articles.insertArticle(createMockArticle({
      id: 'art_pipe_approved', sessionId, status: 'approved', platform: 'zhihu',
    }));

    // Insert a review and a published publish task for the approved article
    dbAccess.reviews.insertReview({ ...createMockReview('art_pipe_approved', 1), overallScore: 88 });
    const task: PublishTask = {
      id: 'task_pipe_1',
      articleId: 'art_pipe_approved',
      platform: 'zhihu',
      status: 'published',
      method: 'rpa',
      platformPostId: 'post-123',
      platformPostUrl: 'https://zhihu.com/post/123',
      retryCount: 0,
      maxRetries: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    dbAccess.publish.insertPublishTask(task);

    const res = await app.request('/status/' + sessionId);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.sessionId).toBe(sessionId);
    expect(json.data.totalArticles).toBe(2);
    expect(json.data.draft).toBe(1);
    expect(json.data.approved).toBe(1);
    expect(json.data.reviewing).toBe(0);
    expect(json.data.publishing).toBe(0);
    expect(json.data.published).toBe(0);
    expect(json.data.failed).toBe(0);
    expect(json.data.articles).toHaveLength(2);

    // Verify summaries include review score and publish url where applicable
    const approvedSummary = json.data.articles.find((a: { id: string }) => a.id === 'art_pipe_approved');
    expect(approvedSummary).toBeDefined();
    expect(approvedSummary.reviewScore).toBe(88);
    expect(approvedSummary.publishUrl).toBe('https://zhihu.com/post/123');

    const draftSummary = json.data.articles.find((a: { id: string }) => a.id === 'art_pipe_draft');
    expect(draftSummary).toBeDefined();
    expect(draftSummary.reviewScore).toBeUndefined();
    expect(draftSummary.publishUrl).toBeUndefined('draft articles should not have review or publish data');
  });

  it('GET /status/:sessionId - should include the latest pipeline run when one exists', async () => {
    const sessionId = 'pipe-session-run';

    const run: PipelineRun = {
      id: 'run_status_1',
      sessionId,
      status: 'completed',
      totalArticles: 2,
      completedArticles: 2,
      startedAt: '2026-08-01T00:00:00Z',
      completedAt: '2026-08-01T01:00:00Z',
    };
    dbAccess.pipeline.insertPipelineRun(run);

    const res = await app.request('/status/' + sessionId);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.run).toBeDefined();
    expect(json.data.run.id).toBe('run_status_1');
    expect(json.data.run.status).toBe('completed', 'latest pipeline run should be included in status response');
  });

  it('GET /status/:sessionId - should return zero counts for a session with no articles', async () => {
    const res = await app.request('/status/empty-session-' + Date.now());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.totalArticles).toBe(0);
    expect(json.data.draft).toBe(0);
    expect(json.data.articles).toHaveLength(0);
    expect(json.data.run).toBeUndefined('empty session should have no pipeline run data');
  });

  it('GET /run/:runId - should return 200 with full data for an existing pipeline run', async () => {
    const run: PipelineRun = {
      id: 'run_get_1',
      sessionId: 'session-run-get',
      status: 'running',
      totalArticles: 3,
      completedArticles: 1,
      currentPlatform: 'zhihu',
      currentRound: 1,
      startedAt: new Date().toISOString(),
    };
    dbAccess.pipeline.insertPipelineRun(run);

    const res = await app.request('/run/' + run.id);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.id).toBe('run_get_1');
    expect(json.data.sessionId).toBe('session-run-get');
    expect(json.data.status).toBe('running');
    expect(json.data.totalArticles).toBe(3);
    expect(json.data.completedArticles).toBe(1);
    expect(json.data.currentPlatform).toBe('zhihu', 'current platform should be included in run details');
  });

  it('GET /run/:runId - should return 404 for a non-existent pipeline run', async () => {
    const res = await app.request('/run/non-existent-run-' + Date.now());
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.success).toBe(false);
    expect(json.error).toBeDefined('error message should be provided for missing pipeline runs');
  });
});
