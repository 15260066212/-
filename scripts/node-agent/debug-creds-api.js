// 调试 credentials API 500 错误
const http = require('http');

function makeRequest(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:3000${path}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ status: res.statusCode, headers: res.headers, body: data });
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

(async () => {
  console.log('=== GET /api/credentials/ ===');
  try {
    const r = await makeRequest('/api/credentials/');
    console.log('Status:', r.status);
    console.log('Body:', r.body.slice(0, 300));
  } catch(e) {
    console.error('Error:', e.message);
  }

  console.log('\n=== GET /api/credentials/?platform=toutiaohao ===');
  try {
    const r = await makeRequest('/api/credentials/?platform=toutiaohao');
    console.log('Status:', r.status);
    console.log('Body:', r.body.slice(0, 300));
  } catch(e) {
    console.error('Error:', e.message);
  }
})();
