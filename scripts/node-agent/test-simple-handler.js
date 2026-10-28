// 简单替换测试：把 GET / 的 handler 体替换成最简单的返回
const fs = require('fs');
const path = '/home/ubuntu/geo-assistant-clean/apps/server/dist/routes/credentials.js';
let content = fs.readFileSync(path, 'utf8');

// 找到 "    // GET / - 获取所有凭据" 之后的 app.get
const marker = "    // GET / - 获取所有凭据\n    app.get('/', withErrorHandler((c) => {";
const endMarker = "    // GET /:platform - 获取指定平台的所有账号凭据";

const startIdx = content.indexOf(marker);
const endIdx = content.indexOf(endMarker);

if (startIdx === -1 || endIdx === -1) {
  console.error('Cannot find markers');
  console.log('startIdx:', startIdx);
  console.log('endIdx:', endIdx);
  process.exit(1);
}

console.log('Found GET / route from', startIdx, 'to', endIdx);
console.log('Current code:');
console.log(content.slice(startIdx, endIdx).slice(0, 300));
console.log('...');

// 测试1：先用最简单的 handler 替换，看看是不是 handler 内部的问题
const simpleHandler = `    // GET / - 获取所有凭据
    app.get('/', withErrorHandler((c) => {
        return c.json({ success: true, data: [] });
    }));
`;

const newContent = content.slice(0, startIdx) + simpleHandler + content.slice(endIdx);
fs.writeFileSync(path, newContent);

console.log('\n✅ Replaced with simple handler');
console.log('New code:');
console.log(simpleHandler);
