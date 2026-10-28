/**
 * NodeRegistry — 节点注册中心
 *
 * 管理所有连接到主服务器的 harvester 节点（单机）。
 * 节点通过心跳维持在线状态，支持部署任务下发。
 *
 * 存储方式：内存 + JSON 文件持久化（避免改动数据库 schema）
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

// === Types ===

export type NodeStatus = 'online' | 'offline' | 'deploying';

export interface HarvesterNode {
  nodeId: string;
  name: string;
  endpoint?: string;
  version: string;
  status: NodeStatus;
  tags: string[];
  platformCount: number;
  activeSessions: number;
  os: string;
  cpuCores: number;
  memoryMB: number;
  registeredAt: string;
  lastHeartbeatAt: string;
  lastDeployAt?: string;
  lastDeployStatus?: 'success' | 'failed';
  ipAddress?: string;
}

export type DeployTaskStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled';

export interface DeployTask {
  taskId: string;
  nodeId: string;
  targetVersion?: string;
  status: DeployTaskStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  log: string[];
  error?: string;
  durationMs?: number;
}

export interface DeployBatch {
  batchId: string;
  name: string;
  targetVersion?: string;
  nodeIds: string[];
  status: DeployTaskStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  createdBy?: string;
}

// === Constants ===

const HEARTBEAT_TIMEOUT_MS = 90_000; // 90秒无心跳视为离线
const MAX_LOG_LINES = 200;

// === NodeRegistry ===

export class NodeRegistry {
  private nodes = new Map<string, HarvesterNode>();
  private tasks = new Map<string, DeployTask>(); // taskId -> task
  private batches = new Map<string, DeployBatch>(); // batchId -> batch
  private pendingTasksByNode = new Map<string, string[]>(); // nodeId -> [taskId, ...]
  private dataDir: string;
  private nodesFile: string;

  constructor(dataDir?: string) {
    this.dataDir = dataDir || join(process.cwd(), 'data');
    this.nodesFile = join(this.dataDir, 'nodes-registry.json');
    this.loadFromDisk();
  }

  // --- Node registration ---

  registerNode(info: {
    nodeId: string;
    name: string;
    endpoint?: string;
    version: string;
    tags?: string[];
    platformCount?: number;
    activeSessions?: number;
    os?: string;
    cpuCores?: number;
    memoryMB?: number;
    ipAddress?: string;
  }): HarvesterNode {
    const now = new Date().toISOString();
    const existing = this.nodes.get(info.nodeId);

    const node: HarvesterNode = {
      nodeId: info.nodeId,
      name: info.name,
      endpoint: info.endpoint || '',
      version: info.version,
      status: 'online',
      tags: info.tags || [],
      platformCount: info.platformCount || 0,
      activeSessions: info.activeSessions || 0,
      os: info.os || 'unknown',
      cpuCores: info.cpuCores || 0,
      memoryMB: info.memoryMB || 0,
      registeredAt: existing?.registeredAt || now,
      lastHeartbeatAt: now,
      lastDeployAt: existing?.lastDeployAt,
      lastDeployStatus: existing?.lastDeployStatus,
      ipAddress: info.ipAddress,
    };

    this.nodes.set(info.nodeId, node);
    this.saveToDisk();
    return node;
  }

  heartbeat(nodeId: string, info?: {
    activeSessions?: number;
    platformCount?: number;
    version?: string;
  }): HarvesterNode | null {
    const node = this.nodes.get(nodeId);
    if (!node) return null;

    node.lastHeartbeatAt = new Date().toISOString();
    node.status = 'online';
    if (info?.activeSessions !== undefined) node.activeSessions = info.activeSessions;
    if (info?.platformCount !== undefined) node.platformCount = info.platformCount;
    if (info?.version) node.version = info.version;

    return node;
  }

  getNode(nodeId: string): HarvesterNode | undefined {
    return this.nodes.get(nodeId);
  }

  listNodes(filter?: { tag?: string; status?: NodeStatus }): HarvesterNode[] {
    this.checkOfflineNodes();
    let list = Array.from(this.nodes.values());
    if (filter?.tag) {
      list = list.filter((n) => n.tags.includes(filter.tag!));
    }
    if (filter?.status) {
      list = list.filter((n) => n.status === filter.status);
    }
    return list.sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }

  removeNode(nodeId: string): boolean {
    const removed = this.nodes.delete(nodeId);
    if (removed) this.saveToDisk();
    return removed;
  }

  // --- Deploy tasks ---

  createDeployBatch(params: {
    nodeIds: string[];
    name?: string;
    targetVersion?: string;
    createdBy?: string;
  }): DeployBatch {
    const batchId = 'batch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    const now = new Date().toISOString();

    const validNodeIds = params.nodeIds.filter((id) => this.nodes.has(id));

    const batch: DeployBatch = {
      batchId,
      name: params.name || `部署 ${validNodeIds.length} 台节点`,
      targetVersion: params.targetVersion,
      nodeIds: validNodeIds,
      status: 'pending',
      createdAt: now,
      createdBy: params.createdBy,
    };
    this.batches.set(batchId, batch);

    // 为每个节点创建任务
    for (const nodeId of validNodeIds) {
      const task = this.createTask(nodeId, batchId, params.targetVersion);
      const pending = this.pendingTasksByNode.get(nodeId) || [];
      pending.push(task.taskId);
      this.pendingTasksByNode.set(nodeId, pending);
    }

    return batch;
  }

  private createTask(nodeId: string, batchId: string, targetVersion?: string): DeployTask {
    const taskId = 'task-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    const task: DeployTask = {
      taskId,
      nodeId,
      targetVersion,
      status: 'pending',
      createdAt: new Date().toISOString(),
      log: [],
    };
    this.tasks.set(taskId, task);
    // 用 batchId 作为任务的关联（存到 log 第一条）
    task.log.unshift(`[batch] ${batchId}`);
    return task;
  }

  /** 节点拉取待执行的部署任务 */
  claimNextTask(nodeId: string): DeployTask | null {
    const pending = this.pendingTasksByNode.get(nodeId) || [];
    if (pending.length === 0) return null;

    const taskId = pending.shift()!;
    this.pendingTasksByNode.set(nodeId, pending);

    const task = this.tasks.get(taskId);
    if (!task) return null;

    task.status = 'running';
    task.startedAt = new Date().toISOString();
    task.log.push(`[${this.timestamp()}] 节点开始执行部署`);

    // 更新节点状态
    const node = this.nodes.get(nodeId);
    if (node) node.status = 'deploying';

    // 更新 batch 状态
    this.updateBatchStatusForTask(task);

    return task;
  }

  /** 节点上报部署进度 */
  updateTaskProgress(taskId: string, log: string): DeployTask | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    task.log.push(`[${this.timestamp()}] ${log}`);
    if (task.log.length > MAX_LOG_LINES) {
      task.log = task.log.slice(-MAX_LOG_LINES);
    }
    return task;
  }

  /** 节点上报部署完成 */
  completeTask(taskId: string, success: boolean, error?: string): DeployTask | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    task.status = success ? 'success' : 'failed';
    task.finishedAt = new Date().toISOString();
    if (task.startedAt) {
      task.durationMs = new Date(task.finishedAt).getTime() - new Date(task.startedAt).getTime();
    }
    if (error) task.error = error;

    task.log.push(`[${this.timestamp()}] 部署${success ? '成功' : '失败'}${error ? `: ${error}` : ''}`);

    // 更新节点状态
    const node = this.nodes.get(task.nodeId);
    if (node) {
      node.status = 'online';
      node.lastDeployAt = task.finishedAt;
      node.lastDeployStatus = success ? 'success' : 'failed';
    }

    // 更新 batch 状态
    this.updateBatchStatusForTask(task);

    return task;
  }

  getTask(taskId: string): DeployTask | undefined {
    return this.tasks.get(taskId);
  }

  getTasksForNode(nodeId: string, limit = 20): DeployTask[] {
    return Array.from(this.tasks.values())
      .filter((t) => t.nodeId === nodeId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  getBatch(batchId: string): DeployBatch | undefined {
    return this.batches.get(batchId);
  }

  listBatches(limit = 20): DeployBatch[] {
    return Array.from(this.batches.values())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  getBatchTasks(batchId: string): DeployTask[] {
    return Array.from(this.tasks.values())
      .filter((t) => t.log[0] === `[batch] ${batchId}`)
      .sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  }

  cancelBatch(batchId: string): boolean {
    const batch = this.batches.get(batchId);
    if (!batch) return false;
    if (batch.status === 'running') {
      // 只取消 pending 的任务
      for (const taskId of this.tasks.keys()) {
        const task = this.tasks.get(taskId)!;
        if (task.log[0] === `[batch] ${batchId}` && task.status === 'pending') {
          task.status = 'cancelled';
        }
      }
    }
    batch.status = 'cancelled';
    return true;
  }

  // --- Internal helpers ---

  private checkOfflineNodes(): void {
    const now = Date.now();
    for (const node of this.nodes.values()) {
      if (node.status === 'online' || node.status === 'deploying') {
        const lastBeat = new Date(node.lastHeartbeatAt).getTime();
        if (now - lastBeat > HEARTBEAT_TIMEOUT_MS) {
          node.status = 'offline';
        }
      }
    }
  }

  private updateBatchStatusForTask(task: DeployTask): void {
    const batchMatch = task.log[0]?.match(/^\[batch\] (.+)$/);
    if (!batchMatch) return;

    const batchId = batchMatch[1];
    const batch = this.batches.get(batchId);
    if (!batch) return;

    const tasks = this.getBatchTasks(batchId);
    const allFinished = tasks.every((t) =>
      t.status === 'success' || t.status === 'failed' || t.status === 'cancelled',
    );
    const anyRunning = tasks.some((t) => t.status === 'running');
    const anyFailed = tasks.some((t) => t.status === 'failed');

    if (anyRunning) {
      batch.status = 'running';
      if (!batch.startedAt) batch.startedAt = new Date().toISOString();
    }
    if (allFinished) {
      batch.status = anyFailed ? 'failed' : 'success';
      batch.finishedAt = new Date().toISOString();
    }
  }

  private timestamp(): string {
    return new Date().toLocaleTimeString('zh-CN', { hour12: false });
  }

  // --- Persistence ---

  private loadFromDisk(): void {
    try {
      if (!existsSync(this.nodesFile)) return;
      const data = JSON.parse(readFileSync(this.nodesFile, 'utf-8'));
      if (data.nodes) {
        for (const n of data.nodes) {
          this.nodes.set(n.nodeId, n);
        }
      }
      this.checkOfflineNodes();
    } catch {
      // ignore corrupt file
    }
  }

  private saveToDisk(): void {
    try {
      mkdirSync(dirname(this.nodesFile), { recursive: true });
      const data = {
        nodes: Array.from(this.nodes.values()),
        savedAt: new Date().toISOString(),
      };
      writeFileSync(this.nodesFile, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      // ignore write errors
    }
  }
}
