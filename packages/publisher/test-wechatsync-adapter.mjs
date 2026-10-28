/**
 * WechatSyncCoreAdapter 集成测试（多平台）
 * 用法: node test-wechatsync-adapter.mjs [platform]
 */
const platform = process.argv[2] || 'csdn';
const { WechatSyncCoreAdapter } = await import('./dist/adapters/wechatsync-core.js');
const { exportCookiesFromChrome } = await import('./dist/cookie-exporter.js');

const article = {
  id: 'test_' + Date.now(),
  sessionId: 'test-session',
  platform,
  contentType: 'tutorial',
  title: `WechatSyncCoreAdapter 集成测试(${platform}) - ` + new Date().toISOString().slice(0, 19),
  contentMarkdown: `# WechatSyncCoreAdapter 测试 (${platform})

这是一篇由 **geo-assistant-clean WechatSyncCoreAdapter（纯 Node.js fetch）** 发布的测试草稿。

## 技术栈
- @zemingengine/publisher WechatSyncCoreAdapter
- @zemingengine/wechatsync-core vendored dist
- NodeRuntime (fetch + cookies + headerRules + dom)
- CookieExporter (Playwright 从 Chrome profile 导明文 Cookie)

## 对比旧方案
- ❌ 旧：Playwright RPA → headed Chromium + Xvfb + noVNC（慢 10x）
- ✅ 新：WechatSyncCoreAdapter → 纯 Node.js fetch（快 10x）`,
  contentHtml: `<h1>WechatSyncCoreAdapter 测试 (${platform})</h1><p>纯 Node.js fetch + Cookie 发布。</p><h2>技术栈</h2><ul><li>@zemingengine/publisher</li><li>@zemingengine/wechatsync-core</li><li>NodeRuntime fetch</li></ul><p>✅ 完整链路打通！</p>`,
  tags: ['WechatSync', 'Node.js', platform, '自动化'],
  summary: `WechatSyncCoreAdapter ${platform} 集成测试 - 纯 Node.js 发布`,
  wordCount: 100,
  status: 'draft',
  generationRound: 1,
  reviewRound: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const credentials = {
  platform,
  accountId: 'test-account',
  accountName: 'Test',
  type: 'cookie',
  data: {},
  status: 'active',
};

console.log(`\n=== WechatSyncCoreAdapter 集成测试 (${platform}) ===`);
console.log('Cookie 来源: exportCookiesFromChrome (harvester browser-profiles)');

const adapter = new WechatSyncCoreAdapter(platform, {
  cookiesProvider: exportCookiesFromChrome,
  debug: true,
});

console.log('\n📤 开始 publish...');
try {
  const result = await adapter.publish({ article, credentials });
  console.log('\n🎯 结果:');
  console.log(JSON.stringify(result, null, 2));

  if (result.success) {
    console.log(`\n🎉🎉🎉🎉 WechatSyncCoreAdapter(${platform}) 集成测试通过！`);
    if (result.postUrl) console.log('🔗 链接:', result.postUrl);
    if (result.postId) console.log('📌 ID:', result.postId);
  } else {
    console.log(`\n❌ 发布失败(${platform}):`, result.error);
  }
} catch (err) {
  console.error(`\n❌ 异常(${platform}):`, err.message);
  console.error(err.stack?.slice(0, 500));
}
