/**
 * 头条 ToutiaoApiAdapter 集成测试
 * 在服务器上运行（需要 harvester Chrome profile 里的 toutiao Cookie）
 */
import { ToutiaoApiAdapter } from './dist/adapters/toutiao-api.js';
import { exportCookiesFromChrome } from './dist/cookie-exporter.js';

const testArticle = {
  id: 'test-toutiao-' + Date.now(),
  title: '【测试】头条 API 适配器验证 - ' + new Date().toISOString().slice(0, 16),
  contentMarkdown: '# 测试标题\n\n这是 API 适配器测试正文。\n\n- 项目 1\n- 项目 2',
  contentHtml: '',
  summary: '测试摘要',
  tags: [],
  platform: 'toutiao',
  status: 'draft',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const testCredentials = { accountId: 'default', platform: 'toutiao', data: {} };

async function main() {
  const adapter = new ToutiaoApiAdapter({
    cookiesProvider: exportCookiesFromChrome,
    debug: true,
    save: '1', // 存草稿
  });

  // 1. checkAuth
  console.log('--- checkAuth ---');
  const auth = await adapter.checkAuth(testCredentials);
  if (!auth.isAuthenticated) {
    console.error('❌ checkAuth 失败:', auth.error);
    process.exit(1);
  }
  console.log('✅ checkAuth 通过:', auth.username, '(uid:', auth.userId + ')');

  // 2. publish（存草稿）
  console.log('--- publish (save=1 存草稿) ---');
  const result = await adapter.publish({
    article: testArticle,
    credentials: testCredentials,
  });

  if (result.success) {
    console.log('✅ 发布成功');
    console.log('   postId:', result.postId);
    console.log('   postUrl:', result.postUrl);
    console.log('   draftSaved:', result.draftSaved);
    process.exit(0);
  } else {
    console.error('❌ 发布失败:', result.error);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('测试异常:', err);
  process.exit(1);
});
