/**
 * NodeAgent — 节点代理（云端部署的客户端）
 *
 * 功能：
 * 1. 启动时自动注册到主服务器
 * 2. 定期发送心跳，维持在线状态
 * 3. 拉取部署任务，交给 LocalDeployer 执行
 * 4. 实时上报部署进度和结果
 *
 * 与主服务器的通信遵循 HTTP 长轮询模式：
 * - 心跳间隔 30s（主服务器可动态调整）
 * - 有部署任务时立即拉取执行
 */

import os from 'node:os';
import { MainServerClient } from './main-server-client.js';
import { LocalDeployer } from './local-deployer.js';

export interface NodeAgentOptions {
  mainServerUrl: string;
  nodeId: string;
  nodeName: string;
  endpoint: string;
  version: string;
  tags?: string[];
  deployScript?: string; // 本地部署脚本路径
  projectDir?: string;   // 项目根目录
}

export class NodeAgent {
  private mainServerUrl: string;
  private nodeId: string;
  private nodeName: string;
  private endpoint: string;
  private version: string;
  private tags: string[];
  private deployer: LocalDeployer;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private deployLoopTimer: ReturnType<typeof setTimeout> | null = null;
  private registered = false;
  private isDeploying = false;
  private nextHeartbeatMs = 30000;

  constructor(options: NodeAgentOptions) {
    this.mainServerUrl = options.mainServerUrl;
    this.nodeId = options.nodeId;
    this.nodeName = options.nodeName;
    this.endpoint = options.endpoint;
    this.version = options.version;
    this.tags = options.tags || [];
    this.deployer = new LocalDeployer({
      scriptPath: options.deployScript,
      projectDir: options.projectDir,
    });
  }

  // === Lifecycle ===

  async start(): Promise<void> {
    console.log(`[NodeAgent] 启动节点代理: ${this.nodeName} (${this.nodeId})`);
    console.log(`[NodeAgent] 主服务器: ${this.mainServerUrl}`);

    // 1. 注册
    await this.register();

    // 2. 启动心跳
    this.startHeartbeat();

    // 3. 启动部署任务循环
    this.startDeployLoop();

    console.log('[NodeAgent] 节点代理已启动');
  }

  stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.deployLoopTimer) {
      clearTimeout(this.deployLoopTimer);
      this.deployLoopTimer = null;
    }
    console.log('[NodeAgent] 节点代理已停止');
  }

  // === Registration ===

  private async register(): Promise<boolean> {
    try {
      const cpus = os.cpus();
      const totalMem = Math.round(os.totalmem() / (1024 * 1024));

      const resp = await fetch(`${this.mainServerUrl}/api/nodes/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodeId: this.nodeId,
          name: this.nodeName,
          endpoint: this.endpoint,
          version: this.version,
          tags: this.tags,
          os: `${os.platform()} ${os.release()}`,
          cpuCores: cpus.length,
          memoryMB: totalMem,
          platformCount: this.getCurrentPlatformCount(),
        }),
      });

      if (resp.ok) {
        const data = await resp.json();
        this.registered = true;
        console.log(`[NodeAgent] 注册成功，服务器时间: ${data.serverTime}`);
        return true;
      } else {
        const text = await resp.text().catch(() => resp.statusText);
        console.error(`[NodeAgent] 注册失败: ${resp.status} ${text}`);
        return false;
      }
    } catch (e) {
      console.error(`[NodeAgent] 注册失败（网络错误）: ${e instanceof Error ? e.message : e}`);
      return false;
    }
  }

  // === Heartbeat ===

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat().catch(() => {
        // 心跳失败时尝试重新注册
        if (!this.registered) {
          console.log('[NodeAgent] 心跳失败，尝试重新注册...');
          this.register().catch(() => {});
        }
      });
    }, 15000); // 每15秒发送一次，超时阈值90秒
  }

  private async sendHeartbeat(): Promise<void> {
    try {
      const resp = await fetch(`${this.mainServerUrl}/api/nodes/${this.nodeId}/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activeSessions: this.getActiveSessionCount(),
          platformCount: this.getCurrentPlatformCount(),
          version: this.version,
        }),
      });

      if (resp.status === 404) {
        this.registered = false;
        return;
      }

      if (resp.ok) {
        const data = await resp.json();
        this.registered = true;
        if (data.nextHeartbeatMs) {
          this.nextHeartbeatMs = data.nextHeartbeatMs;
        }
        // 如果有待部署任务，立即触发拉取
        if (data.pendingDeployTasks && data.pendingDeployTasks > 0 && !this.isDeploying) {
          this.checkForDeployTask();
        }
      }
    } catch {
      this.registered = false;
    }
  }

  // === Deploy loop ===

  private startDeployLoop(): void {
    // 启动后延迟 5 秒开始检查部署任务
    this.deployLoopTimer = setTimeout(() => {
      this.checkForDeployTask();
    }, 5000);
  }

  private async checkForDeployTask(): Promise<void> {
    if (this.isDeploying) return;

    try {
      const resp = await fetch(`${this.mainServerUrl}/api/nodes/${this.nodeId}/deploy/next`);
      if (!resp.ok) return;

      const data = await resp.json();
      if (!data.task) {
        // 没有任务，10 秒后再检查
        this.scheduleNextCheck(10000);
        return;
      }

      // 有部署任务，执行
      this.isDeploying = true;
      console.log(`[NodeAgent] 收到部署任务: ${data.task.taskId}`);

      await this.executeDeploy(data.task);
    } catch (e) {
      console.error(`[NodeAgent] 拉取部署任务失败: ${e instanceof Error ? e.message : e}`);
      this.scheduleNextCheck(15000);
    } finally {
      this.isDeploying = false;
    }
  }

  private scheduleNextCheck(delayMs: number): void {
    if (this.deployLoopTimer) {
      clearTimeout(this.deployLoopTimer);
    }
    this.deployLoopTimer = setTimeout(() => {
      this.checkForDeployTask();
    }, delayMs);
  }

  private async executeDeploy(task: { taskId: string; targetVersion?: string }): Promise<void> {
    const reportProgress = (log: string) => {
      this.reportProgress(task.taskId, log).catch(() => {});
    };

    try {
      reportProgress('开始部署...');

      // 执行本地部署
      const result = await this.deployer.deploy({
        targetVersion: task.targetVersion,
        onLog: reportProgress,
      });

      // 上报完成
      await this.reportComplete(task.taskId, result.success, result.error);

      if (result.success) {
        console.log(`[NodeAgent] 部署任务 ${task.taskId} 成功`);
        // 部署成功后重新启动心跳（如果进程被重启了则不会到这里）
      } else {
        console.error(`[NodeAgent] 部署任务 ${task.taskId} 失败: ${result.error}`);
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.error(`[NodeAgent] 部署任务异常: ${error}`);
      await this.reportComplete(task.taskId, false, error).catch(() => {});
    }

    // 继续检查下一个任务
    this.isDeploying = false;
    this.scheduleNextCheck(2000);
  }

  private async reportProgress(taskId: string, log: string): Promise<void> {
    try {
      await fetch(`${this.mainServerUrl}/api/nodes/${this.nodeId}/deploy/${taskId}/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ log }),
      });
    } catch {
      // 进度上报失败不影响部署
    }
  }

  private async reportComplete(taskId: string, success: boolean, error?: string): Promise<void> {
    try {
      await fetch(`${this.mainServerUrl}/api/nodes/${this.nodeId}/deploy/${taskId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success, error }),
      });
    } catch (e) {
      console.error(`[NodeAgent] 上报部署结果失败: ${e instanceof Error ? e.message : e}`);
    }
  }

  // === Helpers (override for testing) ===

  protected getCurrentPlatformCount(): number {
    try {
      // 尝试从 credentials 文件获取
      const { loadCredentials } = require('../lib/credentials-store.js');
      const creds = loadCredentials();
      return Object.keys(creds).length;
    } catch {
      return 0;
    }
  }

  protected getActiveSessionCount(): number {
    try {
      const { sessions } = require('../remote-browser.js');
      return sessions?.size || 0;
    } catch {
      return 0;
    }
  }
}
