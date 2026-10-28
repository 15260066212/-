// 测试：把 GET / 改成 GET /test 看看是不是路径问题
const fs = require('fs');
const path = '/home/ubuntu/geo-assistant-clean/apps/server/dist/routes/credentials.js';
let content = fs.readFileSync(path, 'utf8');

// 找到简单 handler 的 GET /
const oldRoute = `    // GET / - 获取所有凭据
    app.get('/', withErrorHandler((c) => {
        return c.json({ success: true, data: [] });
    }));
`;

const newRoute = `    // GET / - 获取所有凭据
    app.get('/test-route', withErrorHandler((c) => {
        return c.json({ success: true, data: [{ test: 'ok' }] });
    }));
    app.get('/', withErrorHandler((c) => {
        return c.json({ success: true, data: [] });
    }));
`;

if (!content.includes(oldRoute)) {
  console.error('Cannot find old route');
  process.exit(1);
}

content = content.replace(oldRoute, newRoute);
fs.writeFileSync(path, content);
console.log('✅ Added /test-route');
