/**
 * LocalDeployer — 本地部署执行器
 *
 * 负责在本机执行部署操作：
 * 1. 执行指定的部署脚本（最灵活，支持 git pull / npm install / build / restart）
 * 2. 或者执行简单的源码替换 + 构建
 * 3. 实时输出部署日志
 *
 * 设计原则：
 * - 部署脚本由运维人员编写和维护，部署器只负责执行和上报
 * - 脚本执行有超时保护
 * - 部署成功后可自动重启（如果配置了）
 */

import { exec, type ExecOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface DeployOptions {
  targetVersion?: string;
  onLog?: (log: string) => void;
}

export interface DeployResult {
  success: boolean;
  error?: string;
  durationMs: number;
}

export interface LocalDeployerConfig {
  /** 部署脚本路径（绝对路径或相对于 projectDir） */
  scriptPath?: string;
  /** 项目根目录 */
  projectDir?: string;
  /** 部署超时时间（秒），默认 600 */
  timeoutSec?: number;
  /** 部署成功后是否重启当前进程（谨慎使用） */
  autoRestart?: boolean;
}

export class LocalDeployer {
  private scriptPath?: string;
  private projectDir: string;
  private timeoutSec: number;
  private autoRestart: boolean;

  constructor(config: LocalDeployerConfig = {}) {
    this.projectDir = config.projectDir || process.cwd();
    this.scriptPath = config.scriptPath
      ? resolve(this.projectDir, config.scriptPath)
      : undefined;
    this.timeoutSec = config.timeoutSec || 600;
    this.autoRestart = config.autoRestart || false;
  }

  async deploy(options: DeployOptions = {}): Promise<DeployResult> {
    const startTime = Date.now();
    const { onLog, targetVersion } = options;

    const log = (msg: string) => {
      console.log(`[Deploy] ${msg}`);
      onLog?.(msg);
    };

    log(`部署开始 (目标版本: ${targetVersion || 'latest'})`);
    log(`项目目录: ${this.projectDir}`);

    try {
      // 优先使用部署脚本
      if (this.scriptPath && existsSync(this.scriptPath)) {
        log(`执行部署脚本: ${this.scriptPath}`);
        await this.runScript(this.scriptPath, targetVersion, log);
      } else {
        // 简单模式：执行 npm install + build
        log('未找到部署脚本，执行简化部署（install + build）');
        await this.simpleDeploy(log);
      }

      const durationMs = Date.now() - startTime;
      log(`✅ 部署成功 (耗时 ${(durationMs / 1000).toFixed(1)}s)`);

      // 自动重启（如果配置了）
      if (this.autoRestart) {
        log('配置了自动重启，准备重启服务...');
        this.scheduleRestart();
      }

      return { success: true, durationMs };
    } catch (e) {
      const durationMs = Date.now() - startTime;
      const error = e instanceof Error ? e.message : String(e);
      log(`❌ 部署失败: ${error}`);
      return { success: false, error, durationMs };
    }
  }

  private async runScript(
    scriptPath: string,
    targetVersion: string | undefined,
    onLog: (msg: string) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const env = {
        ...process.env,
        TARGET_VERSION: targetVersion || '',
        DEPLOY_MODE: 'auto',
      };

      const options: ExecOptions = {
        cwd: this.projectDir,
        timeout: this.timeoutSec * 1000,
        env,
        shell: '/bin/bash',
      };

      const child = exec(`bash "${scriptPath}" ${targetVersion || ''}`, options);

      child.stdout?.on('data', (data) => {
        const lines = data.toString().trim().split('\n');
        for (const line of lines) {
          if (line.trim()) onLog(line.trim());
        }
      });

      child.stderr?.on('data', (data) => {
        const lines = data.toString().trim().split('\n');
        for (const line of lines) {
          if (line.trim()) onLog(`[stderr] ${line.trim()}`);
        }
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`部署脚本退出码: ${code}`));
        }
      });

      child.on('error', (err) => {
        reject(err);
      });
    });
  }

  private async simpleDeploy(onLog: (msg: string) => void): Promise<void> {
    // 简化部署：只做 install + build
    // 注意：这不会拉取最新代码，仅用于验证构建流程
    const steps = [
      { name: '安装依赖', cmd: 'npm install --no-audit --no-fund --prefer-offline' },
      { name: '构建项目', cmd: 'npm run build' },
    ];

    for (const step of steps) {
      onLog(`→ ${step.name}...`);
      await this.runCommand(step.cmd, onLog);
    }
  }

  private runCommand(cmd: string, onLog: (msg: string) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = exec(cmd, {
        cwd: this.projectDir,
        timeout: this.timeoutSec * 1000,
      });

      child.stdout?.on('data', (data) => {
        const lines = data.toString().trim().split('\n');
        for (const line of lines) {
          if (line.trim()) onLog(line.trim());
        }
      });

      child.stderr?.on('data', (data) => {
        const lines = data.toString().trim().split('\n');
        for (const line of lines) {
          if (line.trim()) onLog(`[stderr] ${line.trim()}`);
        }
      });

      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`命令失败 (${cmd}): exit code ${code}`));
      });

      child.on('error', reject);
    });
  }

  private scheduleRestart(): void {
    // 延迟 2 秒后重启，给上报完成留时间
    setTimeout(() => {
      console.log('[Deploy] 正在重启服务...');
      // 使用 PM2 重启（如果可用）
      if (process.env.PM2_USAGE) {
        exec('pm2 restart all', () => {});
      } else {
        // 直接退出，由外部进程管理器（systemd/docker）重启
        process.exit(0);
      }
    }, 2000);
  }
}
