// 修复：给 Hono 添加 strict: false 选项
const fs = require('fs');
const path = '/home/ubuntu/geo-assistant-clean/apps/server/dist/service-container.js';
let content = fs.readFileSync(path, 'utf8');

// 找到 new Hono() 的位置
const oldCode = "const app = new Hono();";
const newCode = "const app = new Hono({ strict: false });";

if (!content.includes(oldCode)) {
  console.error('Cannot find Hono constructor');
  console.log('Looking for:', JSON.stringify(oldCode));
  // 显示第 30-40 行
  const lines = content.split('\n');
  console.log('Lines 33-38:');
  for (let i = 32; i < 38 && i < lines.length; i++) {
    console.log(`  ${i+1}: ${lines[i]}`);
  }
  process.exit(1);
}

content = content.replace(oldCode, newCode);
fs.writeFileSync(path, content);
console.log('✅ Fixed service-container.js: added strict: false');

// 同时恢复 credentials.js 备份
const credPath = '/home/ubuntu/geo-assistant-clean/apps/server/dist/routes/credentials.js';
const backupPath = credPath + '.bak';
if (fs.existsSync(backupPath)) {
  fs.copyFileSync(backupPath, credPath);
  console.log('✅ Restored credentials.js from backup');
} else {
  console.log('⚠️  No backup found for credentials.js');
}
