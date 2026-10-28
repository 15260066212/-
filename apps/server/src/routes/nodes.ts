/**
 * Node Management Routes — 节点管理 & 云端部署 API
 *
 * 节点（harvester 单机）通过这些 API 注册、心跳、拉取部署任务。
 * 管理员通过这些 API 查看节点状态、发起批量部署。
 *
 * Mounted at: /api/nodes
 */

import { Hono } from 'hono';
import type { AppEnv } from '../db.js';
import { NodeRegistry, type HarvesterNode } from '../node-registry.js';

export function createNodeRoutes(registry: NodeRegistry): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Helper: check if the current user is an admin
  function requireAdmin(c: { get: (key: 'user') => any }): boolean {
    const user = c.get('user');
    return !!user && user.role === 'admin';
  }

  // === Node-facing endpoints (节点调用，无需登录) ===

  /**
   * POST /api/nodes/register
   * 节点注册
   */
  app.post('/register', async (c) => {
    const body = await c.req.json();
    const { nodeId, name, endpoint, version, tags, platformCount, activeSessions, os, cpuCores, memoryMB } = body;

    if (!nodeId || !name) {
      return c.json({ success: false, error: 'nodeId and name are required' }, 400);
    }

    // 获取客户端 IP
    const ipAddress = c.req.header('x-forwarded-for')?.split(',')[0].trim() || c.req.header('x-real-ip');

    const node = registry.registerNode({
      nodeId,
      name,
      endpoint,
      version: version || 'unknown',
      tags: tags || [],
      platformCount,
      activeSessions,
      os,
      cpuCores,
      memoryMB,
      ipAddress,
    });

    return c.json({
      success: true,
      node,
      serverTime: new Date().toISOString(),
    });
  });

  /**
   * POST /api/nodes/:nodeId/heartbeat
   * 节点心跳
   */
  app.post('/:nodeId/heartbeat', async (c) => {
    const { nodeId } = c.req.param();
    const body = await c.req.json().catch(() => ({}));

    const node = registry.heartbeat(nodeId, {
      activeSessions: body.activeSessions,
      platformCount: body.platformCount,
      version: body.version,
    });

    if (!node) {
      return c.json({ success: false, error: 'Node not found, please register first' }, 404);
    }

    // 检查是否有待部署任务
    const pending = (registry as any).pendingTasksByNode?.get(nodeId)?.length || 0;

    return c.json({
      success: true,
      serverTime: new Date().toISOString(),
      nextHeartbeatMs: 30000,
      pendingDeployTasks: pending,
    });
  });

  /**
   * GET /api/nodes/:nodeId/deploy/next
   * 节点拉取下一个待执行的部署任务（长轮询）
   */
  app.get('/:nodeId/deploy/next', async (c) => {
    const { nodeId } = c.req.param();

    const node = registry.getNode(nodeId);
    if (!node) {
      return c.json({ success: false, error: 'Node not found' }, 404);
    }

    const task = registry.claimNextTask(nodeId);
    if (!task) {
      return c.json({ success: true, task: null });
    }

    // 移除 batch 标记的 log 条目，只返回业务日志
    const cleanTask = { ...task };
    cleanTask.log = task.log.filter((l) => !l.startsWith('[batch]'));

    return c.json({ success: true, task: cleanTask });
  });

  /**
   * POST /api/nodes/:nodeId/deploy/:taskId/progress
   * 节点上报部署进度
   */
  app.post('/:nodeId/deploy/:taskId/progress', async (c) => {
    const { taskId } = c.req.param();
    const body = await c.req.json().catch(() => ({}));
    const { log } = body;

    if (!log) {
      return c.json({ success: false, error: 'log is required' }, 400);
    }

    const task = registry.updateTaskProgress(taskId, log);
    if (!task) {
      return c.json({ success: false, error: 'Task not found' }, 404);
    }

    return c.json({ success: true });
  });

  /**
   * POST /api/nodes/:nodeId/deploy/:taskId/complete
   * 节点上报部署完成
   */
  app.post('/:nodeId/deploy/:taskId/complete', async (c) => {
    const { taskId } = c.req.param();
    const body = await c.req.json().catch(() => ({}));
    const { success, error } = body;

    if (success === undefined) {
      return c.json({ success: false, error: 'success field is required' }, 400);
    }

    const task = registry.completeTask(taskId, !!success, error);
    if (!task) {
      return c.json({ success: false, error: 'Task not found' }, 404);
    }

    return c.json({ success: true });
  });

  // === Admin-facing endpoints (管理端调用) ===

  /**
   * GET /api/nodes
   * 列出所有节点
   */
  app.get('/', (c) => {
    if (!requireAdmin(c)) {
      return c.json({ success: false, error: 'Forbidden: admin access required' }, 403);
    }
    const tag = c.req.query('tag');
    const status = c.req.query('status') as HarvesterNode['status'] | undefined;

    const nodes = registry.listNodes({ tag, status });
    return c.json({
      success: true,
      total: nodes.length,
      nodes,
    });
  });

  /**
   * GET /api/nodes/summary
   * 节点汇总统计
   */
  app.get('/summary', (c) => {
    if (!requireAdmin(c)) {
      return c.json({ success: false, error: 'Forbidden: admin access required' }, 403);
    }
    const all = registry.listNodes();
    const online = all.filter((n) => n.status === 'online').length;
    const offline = all.filter((n) => n.status === 'offline').length;
    const deploying = all.filter((n) => n.status === 'deploying').length;
    const totalPlatforms = all.reduce((sum, n) => sum + n.platformCount, 0);

    return c.json({
      success: true,
      total: all.length,
      online,
      offline,
      deploying,
      totalPlatforms,
    });
  });

  /**
   * GET /api/nodes/:nodeId
   * 获取单个节点详情
   */
  app.get('/:nodeId', (c) => {
    if (!requireAdmin(c)) {
      return c.json({ success: false, error: 'Forbidden: admin access required' }, 403);
    }
    const { nodeId } = c.req.param();
    const node = registry.getNode(nodeId);
    if (!node) {
      return c.json({ success: false, error: 'Node not found' }, 404);
    }

    const tasks = registry.getTasksForNode(nodeId, 10);

    return c.json({
      success: true,
      node,
      recentTasks: tasks,
    });
  });

  /**
   * DELETE /api/nodes/:nodeId
   * 移除节点
   */
  app.delete('/:nodeId', (c) => {
    if (!requireAdmin(c)) {
      return c.json({ success: false, error: 'Forbidden: admin access required' }, 403);
    }
    const { nodeId } = c.req.param();
    const removed = registry.removeNode(nodeId);
    return c.json({ success: removed, removed });
  });

  // === Deploy batch endpoints ===

  /**
   * POST /api/nodes/deploy/batch
   * 创建批量部署任务
   * Body: { nodeIds: string[], name?: string, targetVersion?: string }
   */
  app.post('/deploy/batch', async (c) => {
    if (!requireAdmin(c)) {
      return c.json({ success: false, error: 'Forbidden: admin access required' }, 403);
    }
    const body = await c.req.json();
    const { nodeIds, name, targetVersion } = body;

    if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
      return c.json({ success: false, error: 'nodeIds array is required' }, 400);
    }

    const batch = registry.createDeployBatch({
      nodeIds,
      name,
      targetVersion,
    });

    return c.json({
      success: true,
      batch,
    });
  });

  /**
   * GET /api/nodes/deploy/batches
   * 列出部署批次
   */
  app.get('/deploy/batches', (c) => {
    if (!requireAdmin(c)) {
      return c.json({ success: false, error: 'Forbidden: admin access required' }, 403);
    }
    const limit = parseInt(c.req.query('limit') || '20', 10);
    const batches = registry.listBatches(limit);
    return c.json({ success: true, batches });
  });

  /**
   * GET /api/nodes/deploy/batches/:batchId
   * 获取部署批次详情（含各节点任务状态）
   */
  app.get('/deploy/batches/:batchId', (c) => {
    if (!requireAdmin(c)) {
      return c.json({ success: false, error: 'Forbidden: admin access required' }, 403);
    }
    const { batchId } = c.req.param();
    const batch = registry.getBatch(batchId);
    if (!batch) {
      return c.json({ success: false, error: 'Batch not found' }, 404);
    }

    const tasks = registry.getBatchTasks(batchId).map((t) => ({
      taskId: t.taskId,
      nodeId: t.nodeId,
      status: t.status,
      startedAt: t.startedAt,
      finishedAt: t.finishedAt,
      durationMs: t.durationMs,
      error: t.error,
    }));

    return c.json({
      success: true,
      batch,
      tasks,
    });
  });

  /**
   * POST /api/nodes/deploy/batches/:batchId/cancel
   * 取消部署批次
   */
  app.post('/deploy/batches/:batchId/cancel', (c) => {
    if (!requireAdmin(c)) {
      return c.json({ success: false, error: 'Forbidden: admin access required' }, 403);
    }
    const { batchId } = c.req.param();
    const cancelled = registry.cancelBatch(batchId);
    if (!cancelled) {
      return c.json({ success: false, error: 'Batch not found' }, 404);
    }
    return c.json({ success: true });
  });

  /**
   * GET /api/nodes/:nodeId/deploy/tasks
   * 获取节点的部署历史
   */
  app.get('/:nodeId/deploy/tasks', (c) => {
    if (!requireAdmin(c)) {
      return c.json({ success: false, error: 'Forbidden: admin access required' }, 403);
    }
    const { nodeId } = c.req.param();
    const limit = parseInt(c.req.query('limit') || '20', 10);
    const tasks = registry.getTasksForNode(nodeId, limit);
    return c.json({ success: true, tasks });
  });

  /**
   * GET /api/nodes/deploy/tasks/:taskId/log
   * 获取部署任务日志
   */
  app.get('/deploy/tasks/:taskId/log', (c) => {
    if (!requireAdmin(c)) {
      return c.json({ success: false, error: 'Forbidden: admin access required' }, 403);
    }
    const { taskId } = c.req.param();
    const task = registry.getTask(taskId);
    if (!task) {
      return c.json({ success: false, error: 'Task not found' }, 404);
    }

    // 过滤掉内部 batch 标记
    const cleanLog = task.log.filter((l) => !l.startsWith('[batch]'));

    return c.json({
      success: true,
      taskId,
      status: task.status,
      log: cleanLog,
    });
  });

  return app;
}
