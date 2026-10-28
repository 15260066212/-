#!/usr/bin/env node
/**
 * NodeAgent — 节点代理（云端部署的客户端）
 * 纯 JS 版本，可直接在任何 Node.js 环境运行
 *
 * 环境变量：
 *   MAIN_SERVER_URL    - 主服务器地址 (必填)
 *   NODE_ID            - 节点 ID (可选，默认自动生成)
 *   NODE_NAME          - 节点名称 (可选，默认 hostname)
 *   NODE_TAGS          - 节点标签，逗号分隔 (可选)
 *   NODE_ENDPOINT      - 节点对外访问地址 (可选)
 *   DEPLOY_SCRIPT_PATH - 部署脚本路径 (可选)
 *   PROJECT_DIR        - 项目根目录 (可选)
 *   HEARTBEAT_INTERVAL - 心跳间隔秒数 (默认 15)
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execSync, spawn } = require('node:child_process');
const crypto = require('node:crypto');

// === 配置 ===
const config = {
  mainServerUrl: process.env.MAIN_SERVER_URL || '',
  nodeId: process.env.NODE_ID || generateNodeId(),
  nodeName: process.env.NODE_NAME || os.hostname(),
  endpoint: process.env.NODE_ENDPOINT || '',
  version: process.env.NODE_VERSION || '1.0.0',
  tags: (process.env.NODE_TAGS || '').split(',').map(t => t.trim()).filter(Boolean),
  deployScript: process.env.DEPLOY_SCRIPT_PATH || '',
  projectDir: process.env.PROJECT_DIR || process.cwd(),
  heartbeatInterval: parseInt(process.env.HEARTBEAT_INTERVAL || '15', 10) * 1000,
  harvesterUrl: process.env.HARVESTER_URL || 'http://localhost:3003',
};

let registered = false;
let isDeploying = false;
let heartbeatTimer = null;
let deployLoopTimer = null;

// === 工具函数 ===

function generateNodeId() {
  const hash = crypto.createHash('md5').update(os.hostname() + os.platform() + os.totalmem()).digest('hex').slice(0, 12);
  return `node-${hash}`;
}

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}] [NodeAgent] ${msg}`);
}

function error(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.error(`[${ts}] [NodeAgent] ${msg}`);
}

// === 注册 ===


// === Harvester 状态查询 ===

async function getHarvesterStats() {
  try {
    const [platformsResp, sessionsResp] = await Promise.all([
      fetch(config.harvesterUrl + '/api/platforms').catch(() => null),
      fetch(config.harvesterUrl + '/api/sessions').catch(() => null),
    ]);

    let platformCount = 0;
    let activeSessions = 0;

    if (platformsResp && platformsResp.ok) {
      const data = await platformsResp.json().catch(() => ({ platforms: [] }));
      platformCount = (data.platforms || []).filter(p => p.hasCredentials).length;
    }

    if (sessionsResp && sessionsResp.ok) {
      const data = await sessionsResp.json().catch(() => ({ count: 0 }));
      activeSessions = data.count || 0;
    }

    return { platformCount, activeSessions };
  } catch {
    return { platformCount: 0, activeSessions: 0 };
  }
}

async function register() {
  try {
    const cpus = os.cpus();
    const totalMem = Math.round(os.totalmem() / (1024 * 1024));

    const resp = await fetch(`${config.mainServerUrl}/api/nodes/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeId: config.nodeId,
        name: config.nodeName,
        endpoint: config.endpoint,
        version: config.version,
        tags: config.tags,
        os: `${os.platform()} ${os.release()}`,
        cpuCores: cpus.length,
        memoryMB: totalMem,
        platformCount: (await getHarvesterStats()).platformCount,
      }),
    });

    if (resp.ok) {
      const data = await resp.json();
      registered = true;
      log(`注册成功，节点ID: ${config.nodeId}, 服务器时间: ${data.serverTime}`);
      return true;
    } else {
      const text = await resp.text().catch(() => resp.statusText);
      error(`注册失败: ${resp.status} ${text}`);
      return false;
    }
  } catch (e) {
    error(`注册失败（网络错误）: ${e.message}`);
    return false;
  }
}

// === 心跳 ===

function startHeartbeat() {
  heartbeatTimer = setInterval(() => {
    sendHeartbeat().catch(() => {
      if (!registered) {
        log('心跳失败，尝试重新注册...');
        register().catch(() => {});
      }
    });
  }, config.heartbeatInterval);
}

async function sendHeartbeat() {
  try {
    const stats = await getHarvesterStats();
    const resp = await fetch(`${config.mainServerUrl}/api/nodes/${config.nodeId}/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        activeSessions: stats.activeSessions,
        platformCount: stats.platformCount,
        version: config.version,
      }),
    });

    if (resp.status === 404) {
      registered = false;
      return;
    }

    if (resp.ok) {
      const data = await resp.json();
      registered = true;
      // 如果有待部署任务，立即触发拉取
      if (data.pendingDeployTasks && data.pendingDeployTasks > 0 && !isDeploying) {
        checkForDeployTask();
      }
    }
  } catch {
    registered = false;
  }
}

// === 部署任务 ===

function startDeployLoop() {
  // 启动后 5 秒开始检查
  deployLoopTimer = setTimeout(() => {
    checkForDeployTask();
  }, 5000);
}

async function checkForDeployTask() {
  if (isDeploying) return;

  try {
    const resp = await fetch(`${config.mainServerUrl}/api/nodes/${config.nodeId}/deploy/next`);
    if (!resp.ok) {
      scheduleNextCheck(15000);
      return;
    }

    const data = await resp.json();
    if (!data.task) {
      scheduleNextCheck(10000);
      return;
    }

    isDeploying = true;
    log(`收到部署任务: ${data.task.taskId}`);
    await executeDeploy(data.task);
  } catch (e) {
    error(`拉取部署任务失败: ${e.message}`);
    scheduleNextCheck(15000);
  } finally {
    isDeploying = false;
  }
}

function scheduleNextCheck(delayMs) {
  if (deployLoopTimer) {
    clearTimeout(deployLoopTimer);
  }
  deployLoopTimer = setTimeout(() => {
    checkForDeployTask();
  }, delayMs);
}

async function executeDeploy(task) {
  const reportProgress = (logLine) => {
    reportDeployProgress(task.taskId, logLine).catch(() => {});
  };

  try {
    reportProgress('开始部署...');

    const result = await runDeployment(task, reportProgress);

    await reportDeployComplete(task.taskId, result.success, result.error);

    if (result.success) {
      log(`部署任务 ${task.taskId} 成功`);
    } else {
      error(`部署任务 ${task.taskId} 失败: ${result.error}`);
    }
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    error(`部署任务异常: ${errMsg}`);
    await reportDeployComplete(task.taskId, false, errMsg).catch(() => {});
  }

  isDeploying = false;
  scheduleNextCheck(2000);
}

async function runDeployment(task, onLog) {
  // 优先使用自定义部署脚本
  if (config.deployScript && fs.existsSync(config.deployScript)) {
    return runDeployScript(config.deployScript, task, onLog);
  }

  // 简化模式：git pull + npm run build + pm2 restart
  return runGitDeploy(task, onLog);
}

function runDeployScript(scriptPath, task, onLog) {
  return new Promise((resolve) => {
    const child = spawn('bash', [scriptPath, task.targetVersion || 'latest'], {
      cwd: config.projectDir,
      env: { ...process.env, TARGET_VERSION: task.targetVersion || 'latest' },
    });

    let output = '';

    child.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean);
      lines.forEach(line => {
        onLog(line);
        output += line + '\n';
      });
    });

    child.stderr.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean);
      lines.forEach(line => {
        onLog('[stderr] ' + line);
        output += line + '\n';
      });
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true });
      } else {
        resolve({ success: false, error: `部署脚本退出码: ${code}\n${output.slice(-500)}` });
      }
    });

    child.on('error', (err) => {
      resolve({ success: false, error: `启动部署脚本失败: ${err.message}` });
    });
  });
}

function runGitDeploy(task, onLog) {
  return new Promise((resolve) => {
    const steps = [
      { cmd: 'git pull', desc: '拉取最新代码' },
      { cmd: 'npm install', desc: '安装依赖' },
      { cmd: 'npm run build', desc: '构建项目' },
      { cmd: 'pm2 restart all', desc: '重启服务' },
    ];

    let output = '';
    let stepIndex = 0;

    function runNextStep() {
      if (stepIndex >= steps.length) {
        resolve({ success: true });
        return;
      }

      const step = steps[stepIndex];
      onLog(`[${stepIndex + 1}/${steps.length}] ${step.desc}: ${step.cmd}`);

      try {
        const result = execSync(step.cmd, {
          cwd: config.projectDir,
          encoding: 'utf-8',
          maxBuffer: 10 * 1024 * 1024,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        output += result;
        if (result.trim()) {
          result.split('\n').slice(-3).forEach(line => {
            if (line.trim()) onLog('  ' + line.trim());
          });
        }
        stepIndex++;
        setTimeout(runNextStep, 500);
      } catch (err) {
        const errMsg = err.stderr || err.message;
        onLog(`失败: ${errMsg}`);
        resolve({ success: false, error: `${step.desc}失败: ${errMsg}` });
      }
    }

    runNextStep();
  });
}

async function reportDeployProgress(taskId, logLine) {
  try {
    await fetch(`${config.mainServerUrl}/api/nodes/${config.nodeId}/deploy/${taskId}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ log: logLine }),
    });
  } catch {
    // 进度上报失败不影响部署
  }
}

async function reportDeployComplete(taskId, success, errorMsg) {
  try {
    await fetch(`${config.mainServerUrl}/api/nodes/${config.nodeId}/deploy/${taskId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success, error: errorMsg }),
    });
  } catch (e) {
    error(`上报部署结果失败: ${e.message}`);
  }
}

// === 启动 ===

async function main() {
  log('========================================');
  log('  芯图引擎 GEO — 节点代理启动');
  log('========================================');
  log(`节点ID:     ${config.nodeId}`);
  log(`节点名称:   ${config.nodeName}`);
  log(`主服务器:   ${config.mainServerUrl}`);
  log(`标签:       ${config.tags.length ? config.tags.join(', ') : '(无)'}`);
  log(`项目目录:   ${config.projectDir}`);
  log(`部署脚本:   ${config.deployScript || '(使用默认 git pull + build + restart)'}`);
  log('========================================');

  if (!config.mainServerUrl) {
    error('错误：MAIN_SERVER_URL 环境变量未设置');
    error('请设置 MAIN_SERVER_URL=http://主服务器地址');
    process.exit(1);
  }

  // 注册
  await register();

  // 如果首次注册失败，继续尝试（后台心跳会自动重试）
  if (!registered) {
    log('首次注册失败，将在心跳中继续尝试...');
  }

  // 启动心跳
  startHeartbeat();

  // 启动部署任务循环
  startDeployLoop();

  log('节点代理已启动，等待任务...');
}

// === 优雅关闭 ===

function gracefulShutdown(signal) {
  log(`收到 ${signal} 信号，正在关闭...`);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (deployLoopTimer) clearTimeout(deployLoopTimer);
  log('节点代理已停止');
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// 启动
main().catch(err => {
  error(`启动失败: ${err.message}`);
  process.exit(1);
});
