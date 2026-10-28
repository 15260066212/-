const Database = require('better-sqlite3');
const db = new Database('./data/geo-assistant.db');

const users = db.prepare('SELECT id, username, display_name, role, api_key FROM users').all();
console.log('现有用户:');
users.forEach(u => {
  console.log(`  ${u.username}: role=${u.role}, apiKey=${u.api_key.slice(0, 15)}...`);
});

const normalUser = users.find(u => u.role === 'user');
const adminUser = users.find(u => u.role === 'admin');

const http = require('http');

function testWithKey(apiKey, label) {
  return new Promise((resolve) => {
    const req = http.get('http://localhost:3000/api/nodes', {
      headers: { 'x-api-key': apiKey }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const body = JSON.parse(data);
        console.log(`\n[${label}] HTTP ${res.statusCode}: ${body.success ? 'success' : body.error}`);
        if (body.success) {
          console.log(`  节点数: ${body.total}`);
        }
        resolve(res.statusCode);
      });
    });
    req.on('error', (e) => {
      console.log(`[${label}] 错误:`, e.message);
      resolve(0);
    });
  });
}

(async () => {
  if (normalUser) {
    await testWithKey(normalUser.api_key, `普通用户 ${normalUser.username}`);
  } else {
    console.log('\n(没有普通用户，跳过普通用户测试)');
  }
  if (adminUser) {
    await testWithKey(adminUser.api_key, `管理员 ${adminUser.username}`);
  }
})();
