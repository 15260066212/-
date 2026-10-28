// 给 node-agent.js 添加 harvester 状态查询功能
const fs = require('fs');
const path = '/home/ubuntu/node-agent/node-agent.js';
let content = fs.readFileSync(path, 'utf8');

// 1. 在 config 后面添加 harvesterUrl 配置
const configBlock = `const config = {
  mainServerUrl: process.env.MAIN_SERVER_URL || '',
  nodeId: process.env.NODE_ID || generateNodeId(),
  nodeName: process.env.NODE_NAME || os.hostname(),
  endpoint: process.env.NODE_ENDPOINT || '',
  version: process.env.NODE_VERSION || '1.0.0',
  tags: (process.env.NODE_TAGS || '').split(',').map(t => t.trim()).filter(Boolean),
  deployScript: process.env.DEPLOY_SCRIPT_PATH || '',
  projectDir: process.env.PROJECT_DIR || process.cwd(),
  heartbeatInterval: parseInt(process.env.HEARTBEAT_INTERVAL || '15', 10) * 1000,
};`;

const newConfigBlock = `const config = {
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
};`;

if (!content.includes(configBlock)) {
  console.error('Cannot find config block');
  // 试试找近似的
  const idx = content.indexOf('const config = {');
  if (idx > -1) {
    console.log('Found config at index:', idx);
    console.log(content.slice(idx, idx + 500));
  }
  process.exit(1);
}

content = content.replace(configBlock, newConfigBlock);
console.log('✅ Added harvesterUrl config');

// 2. 在 register 函数前添加 getHarvesterStats 函数
const registerMarker = 'async function register() {';
const getHarvesterStatsFunc = `
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

`;

content = content.replace(registerMarker, getHarvesterStatsFunc + registerMarker);
console.log('✅ Added getHarvesterStats function');

// 3. 修改 register 函数中的 platformCount
const oldRegisterPlatform = `        platformCount: 0,`;
const newRegisterPlatform = `        platformCount: (await getHarvesterStats()).platformCount,`;

if (!content.includes(oldRegisterPlatform)) {
  console.error('Cannot find register platformCount');
  process.exit(1);
}
content = content.replace(oldRegisterPlatform, newRegisterPlatform);
console.log('✅ Updated register to use harvester stats');

// 4. 修改 sendHeartbeat 函数
const oldHeartbeatBody = `    const resp = await fetch(\`\${config.mainServerUrl}/api/nodes/\${config.nodeId}/heartbeat\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        activeSessions: 0,
        platformCount: 0,
        version: config.version,
      }),
    });`;

const newHeartbeatBody = `    const stats = await getHarvesterStats();
    const resp = await fetch(\`\${config.mainServerUrl}/api/nodes/\${config.nodeId}/heartbeat\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        activeSessions: stats.activeSessions,
        platformCount: stats.platformCount,
        version: config.version,
      }),
    });`;

if (!content.includes(oldHeartbeatBody)) {
  console.error('Cannot find heartbeat body');
  console.log('Looking for pattern...');
  const hbIdx = content.indexOf('sendHeartbeat');
  console.log(content.slice(hbIdx, hbIdx + 500));
  process.exit(1);
}

content = content.replace(oldHeartbeatBody, newHeartbeatBody);
console.log('✅ Updated heartbeat to use harvester stats');

fs.writeFileSync(path, content);
console.log('\n✅ node-agent.js updated successfully!');
console.log('   - Added HARVESTER_URL config (default: http://localhost:3003)');
console.log('   - Added getHarvesterStats() function');
console.log('   - Register and heartbeat now report real platform count and active sessions');
