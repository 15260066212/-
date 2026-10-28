const { chromium } = require('playwright');
const path = require('path');

const profileDir = path.join(__dirname, '..', 'data', 'chrome-toutiao-main');
console.log('Profile:', profileDir);

(async () => {
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
    ],
    viewport: { width: 1366, height: 900 },
  });

  const page = context.pages()[0] || await context.newPage();
  
  console.log('正在打开头条号后台...');
  await page.goto('https://mp.toutiao.com/profile_v4/index', { waitUntil: 'domcontentloaded', timeout: 30000 });
  
  await page.waitForTimeout(3000);
  
  const url = page.url();
  console.log('当前URL:', url);
  
  // 检查是否已登录
  const isLogin = url.includes('profile_v4') || url.includes('mp.toutiao.com/profile');
  console.log('登录状态:', isLogin ? '已登录' : '未登录（可能跳转到登录页）');
  
  // 截图
  await page.screenshot({ path: path.join(__dirname, '..', 'toutiao_login_check.png'), fullPage: true });
  console.log('截图已保存: toutiao_login_check.png');
  
  // 获取页面标题
  const title = await page.title();
  console.log('页面标题:', title);
  
  console.log('\n浏览器将保持打开状态，请手动确认登录状态。');
  console.log('如果已登录，可以直接进行发布操作。');
  console.log('按 Ctrl+C 关闭浏览器...');
  
  // 保持浏览器打开30秒供检查
  await page.waitForTimeout(30000);
  await context.close();
})();
