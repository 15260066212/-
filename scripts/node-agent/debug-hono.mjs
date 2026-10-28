// 直接用 Hono app 的 fetch 方法测试，获取详细错误
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

async function main() {
  process.chdir(path.resolve(__dirname, '..'));
  
  const { createApp } = await import(path.resolve(__dirname, '../service-container.js'));
  
  try {
    const { app } = await createApp();
    
    console.log('=== Testing GET /api/credentials/ ===');
    try {
      const res = await app.fetch(new Request('http://localhost:3000/api/credentials/'));
      console.log('Status:', res.status);
      const text = await res.text();
      console.log('Body (first 300):', text.slice(0, 300));
    } catch(e) {
      console.error('Error:', e.message);
      console.error(e.stack);
    }
    
    console.log('\n=== Testing GET /api/credentials/toutiaohao ===');
    try {
      const res = await app.fetch(new Request('http://localhost:3000/api/credentials/toutiaohao'));
      console.log('Status:', res.status);
      const text = await res.text();
      console.log('Body (first 300):', text.slice(0, 300));
    } catch(e) {
      console.error('Error:', e.message);
      console.error(e.stack);
    }
  } catch(e) {
    console.error('Setup error:', e.message);
    console.error(e.stack);
  }
}

main();
