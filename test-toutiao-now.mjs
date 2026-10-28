// 头条 API 适配器即时测试: 直接 POST 草稿保存, 看 method=api 且 err_no
// 用法: node test-toutiao-now.cjs <cookie-json-file>  (cookie JSON 数组)
import fs from 'node:fs';
import { ToutiaoApiAdapter } from './packages/publisher/dist/adapters/toutiao-api.js';

const cookieFile = process.argv[2];
if (!cookieFile) { console.log('用法: node test-toutiao-now.cjs <cookie-json-file>'); process.exit(1); }

const cookies = JSON.parse(fs.readFileSync(cookieFile, 'utf8'));
const creds = { platform: 'toutiao', accountId: 'test', data: { cookies } };

const adapter = new ToutiaoApiAdapter({ debug: true });

console.log('--- checkAuth ---');
const auth = await adapter.checkAuth(creds);
console.log(JSON.stringify(auth, null, 2));

if (!auth.isAuthenticated) { console.log('Auth 失败, 终止'); process.exit(1); }

console.log('--- saveDraft ---');
const result = await adapter.saveDraft({
  article: {
    id: 'debug-test',
    platform: 'toutiao',
    title: `GEO 诊断测试帖 ${new Date().toISOString().slice(0,19)}`,
    content: '<p>这是一条 GEO 诊断测试帖，用于验证 API 适配器是否生效。请忽略。</p><h2>标题二</h2><p>正文段落。</p>',
  },
  credentials: creds,
});
console.log(JSON.stringify(result, null, 2));
