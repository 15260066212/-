// 验证节点隔离同步
const http = require('http');

function post(url) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'POST' }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { reject(new Error(data.slice(0, 200))); }
      });
    }).on('error', reject);
  });
}

(async () => {
  console.log('=== 1. 触发全量同步 ===');
  const syncResult = await post('http://localhost:3003/api/credentials/sync');
  console.log('同步:', syncResult.synced, '/', syncResult.total);
  syncResult.results.filter(r => r.success).forEach(r => console.log('  ✓', r.platform));
  syncResult.results.filter(r => !r.success).forEach(r => console.log('  ✗', r.platform, '-', r.error));

  console.log('\n=== 2. 检查凭证 API ===');
  try {
    const creds = await get('http://localhost:3000/api/credentials/');
    console.log('总凭证数:', creds.data?.length ?? 'N/A');
    if (creds.data) {
      creds.data.forEach(c => {
        console.log(`  - ${c.platform} | accountId: ${c.accountId} | ${c.accountName || '(无)'} | ${c.status}`);
      });
    }
  } catch(e) {
    console.log('API 错误:', e.message);
  }

  console.log('\n=== 3. 检查默认账号（无账号名）是否用了节点 ID ===');
  // 检查是否有 accountId 包含 node-dc91b9a42895 的凭证
  try {
    const creds2 = await get('http://localhost:3000/api/credentials/');
    const nodeIsolated = creds2.data?.filter(c => c.accountId === 'node-dc91b9a42895');
    if (nodeIsolated && nodeIsolated.length > 0) {
      console.log('✅ 节点隔离生效！以下凭证使用节点 ID 作为 accountId:');
      nodeIsolated.forEach(c => console.log(`   - ${c.platform} (${c.accountName})`));
    } else {
      console.log('⚠️  未找到节点 ID 作为 accountId 的凭证');
      console.log('   （这台机器的默认账号可能还没有 cookie 数据）');
    }
  } catch(e) {
    // 忽略
  }
})();
