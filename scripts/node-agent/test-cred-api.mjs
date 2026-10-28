// 测试 credential API 是否正常工作
import { createServer } from 'node:http';

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/credentials/',
  method: 'GET',
};

const req = createServer((req, res) => {}).listen(0, () => {
  // 直接用 http.request
  const http = require('http');
  const request = http.get('http://localhost:3000/api/credentials/', (res) => {
    console.log('Status:', res.statusCode);
    console.log('Headers:', JSON.stringify(res.headers, null, 2));
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      console.log('Body (first 500 chars):', data.slice(0, 500));
      process.exit(0);
    });
  });
  request.on('error', (e) => {
    console.error('Request error:', e.message);
    process.exit(1);
  });
});
