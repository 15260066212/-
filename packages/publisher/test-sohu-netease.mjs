/**
 * 搜狐 + 网易 适配器集成测试
 *
 * 测试策略：
 *   - 搜狐：完整 checkAuth + publish（存草稿）
 *   - 网易：checkAuth + publish（publish 应返回明确的"未实现"错误，但 checkAuth 应通过）
 */
import { WechatSyncCoreAdapter } from './dist/adapters/wechatsync-core.js';
import { NeteaseApiAdapter } from './dist/adapters/netease-api.js';
import { exportCookiesFromChrome } from './dist/cookie-exporter.js';

// 测试用 Article
const testArticle = {
  id: 'test-sohu-netease-' + Date.now(),
  title: '【测试】搜狐网易适配器验证 - ' + new Date().toISOString().slice(0, 16),
  contentMarkdown: '# 测试标题\n\n这是测试正文。\n\n- 列表项 1\n- 列表项 2',
  contentHtml: '<h1>测试标题</h1><p>这是测试正文。</p><ul><li>列表项 1</li><li>列表项 2</li></ul>',
  summary: '测试摘要',
  tags: ['测试'],
  platform: 'sohu', // 会被 adapter 覆盖
  status: 'draft',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const testCredentials = {
  accountId: 'default',
  platform: 'sohu',
  data: {},
};

async function testSohu() {
  console.log('\n========== 测试搜狐 (WechatSyncCoreAdapter) ==========');
  const adapter = new WechatSyncCoreAdapter('sohu', {
    cookiesProvider: exportCookiesFromChrome,
    debug: true,
  });

  try {
    const result = await adapter.publish({
      article: { ...testArticle, platform: 'sohu' },
      credentials: { ...testCredentials, platform: 'sohu' },
    });

    if (result.success) {
      console.log('✅ 搜狐发布成功');
      console.log('   postId:', result.postId);
      console.log('   postUrl:', result.postUrl);
      console.log('   draftSaved:', result.draftSaved);
      console.log('   verification:', result.verificationStatus);
      return true;
    } else {
      console.log('❌ 搜狐发布失败:', result.error);
      return false;
    }
  } catch (err) {
    console.error('❌ 搜狐异常:', err.message);
    return false;
  }
}

async function testNetease() {
  console.log('\n========== 测试网易 (NeteaseApiAdapter 骨架) ==========');
  const adapter = new NeteaseApiAdapter({
    cookiesProvider: exportCookiesFromChrome,
    debug: true,
  });

  const credentials = { ...testCredentials, platform: 'netease' };

  // 1. 先测 checkAuth
  console.log('--- checkAuth ---');
  try {
    const auth = await adapter.checkAuth(credentials);
    if (auth.isAuthenticated) {
      console.log('✅ 网易 checkAuth 通过:', auth.username);
    } else {
      console.log('⚠️ 网易 checkAuth 未通过:', auth.error);
    }
  } catch (err) {
    console.error('❌ 网易 checkAuth 异常:', err.message);
  }

  // 2. 再测 publish（应返回明确的未实现错误）
  console.log('--- publish (预期返回未实现) ---');
  try {
    const result = await adapter.publish({
      article: { ...testArticle, platform: 'netease' },
      credentials,
    });
    if (result.success) {
      console.log('⚠️ 网易 publish 意外成功（不应该）:', result.postId);
      return true;
    } else {
      const isExpected = result.error?.includes('尚未实现') || result.error?.includes('抓包');
      if (isExpected) {
        console.log('✅ 网易 publish 按预期返回未实现错误');
        console.log('   错误信息:', result.error?.slice(0, 120) + '...');
        return true;
      } else {
        console.log('❌ 网易 publish 返回意外错误:', result.error);
        return false;
      }
    }
  } catch (err) {
    console.error('❌ 网易 publish 异常:', err.message);
    return false;
  }
}

async function main() {
  const sohuOk = await testSohu();
  const neteaseOk = await testNetease();

  console.log('\n========== 测试总结 ==========');
  console.log(`搜狐: ${sohuOk ? '✅ 通过' : '❌ 失败'}`);
  console.log(`网易: ${neteaseOk ? '✅ 骨架验证通过' : '❌ 失败'}`);
  console.log('\n说明：网易 publish 是占位实现，需要抓包 mp.163.com 编辑器自动保存 XHR 后补全。');

  process.exit(sohuOk && neteaseOk ? 0 : 1);
}

main().catch(err => {
  console.error('测试异常:', err);
  process.exit(1);
});
