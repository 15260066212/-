/**
 * Platform configuration constants.
 * All platform-specific URLs, names, selectors, and login patterns.
 */

const PLATFORM_URLS = {
  zhihu: 'https://www.zhihu.com/signin',
  baijiahao: 'https://baijiahao.baidu.com',
  toutiaohao: 'https://mp.toutiao.com',
  csdn: 'https://passport.csdn.net/login',
  juejin: 'https://juejin.cn/login',
  xiaohongshu: 'https://www.xiaohongshu.com',
  bilibili: 'https://passport.bilibili.com/login',
  sohuhao: 'https://mp.sohu.com',
  wangyihao: 'https://mp.163.com',
  zhidao: 'https://passport.baidu.com/v2/?login',
  wechat: 'https://mp.weixin.qq.com',
};

const PLATFORM_NAMES = {
  zhihu: '知乎',
  baijiahao: '百家号',
  toutiaohao: '头条号',
  csdn: 'CSDN',
  juejin: '掘金',
  xiaohongshu: '小红书',
  bilibili: '哔哩哔哩',
  sohuhao: '搜狐号',
  wangyihao: '网易号',
  zhidao: '百度知道',
  wechat: '微信公众号',
};

const CHECK_URLS = {
  zhihu: 'https://www.zhihu.com/people/me',
  baijiahao: 'https://baijiahao.baidu.com/builder/rc/home',
  toutiaohao: 'https://mp.toutiao.com/profile_v4/index',
  csdn: 'https://mp.csdn.net/mp_blog/manage/article',
  juejin: 'https://juejin.cn/editor/drafts',
  xiaohongshu: 'https://creator.xiaohongshu.com/',
  bilibili: 'https://member.bilibili.com/',
  sohuhao: 'https://mp.sohu.com/',
  wangyihao: 'https://mp.163.com/',
  zhidao: 'https://zhidao.baidu.com/',
  wechat: 'https://mp.weixin.qq.com/',
};

const PLATFORM_LOGIN_REDIRECTS = {
  zhihu: ['login', 'signin', 'sso.zhihu.com'],
  baijiahao: ['login', 'passport.baidu.com', 'wappass.baidu.com'],
  toutiaohao: ['login', 'sso.toutiao.com', 'passport.toutiao.com'],
  csdn: ['login', 'passport.csdn.net'],
  juejin: ['login', 'passport.juejin.cn'],
  xiaohongshu: ['login', 'gaia.xiaohongshu.com'],
  bilibili: ['login', 'passport.bilibili.com', 'passport.bilibili.tv'],
  sohuhao: ['login', 'passport.sohu.com'],
  wangyihao: ['login', 'passport.163.com', 'reg.163.com'],
  zhidao: ['login', 'passport.baidu.com', 'wappass.baidu.com'],
  wechat: ['login', 'mp.weixin.qq.com/cgi-bin/login'],
};

const PLATFORM_LOGIN_TEXTS = {
  zhihu: ['请登录', '登录知乎', '登录 / 注册', '扫码登录'],
  baijiahao: ['请登录', '登录百度', '扫码登录', '百度登录'],
  toutiaohao: ['请登录', '登录今日', '扫码登录'],
  csdn: ['登录 CSDN', '登录CSDN', '请登录', '扫码登录'],
  juejin: ['登录掘金', '请登录', '扫码登录'],
  xiaohongshu: ['登录小红书', '请登录', '扫码登录'],
  bilibili: ['登录哔哩', '扫码登录', '请登录'],
  sohuhao: ['登录搜狐', '请登录'],
  wangyihao: ['登录网易', '请登录', '网易邮箱登录'],
  zhidao: ['登录百度', '请登录', '扫码登录'],
  wechat: ['请登录', '扫码登录', '微信公众号登录'],
};

const PLATFORM_LOGGED_IN_SELECTORS = {
  zhihu: ['img.Avatar', '.AppHeader-userInfo', '.ProfileHeader-name', 'button[data-za-detail-view-element-name]'],
  baijiahao: ['.builder-home', '.home-index', '.u-wrap-header'],
  toutiaohao: ['.profile-v4', '.index-module', '.user-info'],
  csdn: ['.toolbar-search', '.blog-content', '#csdn-toolbar', '.user-login'],
  juejin: ['.drafts', '.publish-panel', '.entry-publish-form'],
  xiaohongshu: ['.creator-home', '.user-info', '.spectrum'],
  bilibili: ['.home-container', '.user-avatar', '.h-body'],
  sohuhao: ['.mp-sohu', '.home-container'],
  wangyihao: ['.mp-163', '.home-container'],
  zhidao: ['.user-bar', '.user-name'],
  wechat: ['.account_info', '.weui-desktop-card', '.card_content'],
};

const LOGIN_CONFIG = {
  csdn: {
    loginUrl: 'https://passport.csdn.net/login',
    usernameSelector: 'input[type="text"], input[name="username"], input[placeholder*="手机"], input[placeholder*="邮箱"]',
    passwordSelector: 'input[type="password"], input[name="password"]',
    submitSelector: 'button[type="submit"], button:has-text("登录"), .btn-login, .btn-primary',
    switchToPasswordSelector: '.btn-group a:has-text("账号登录"), .tab-group a:has-text("账号登录"), a:has-text("账号登录")',
    successUrl: 'csdn.net',
    successSelectors: ['#csdn-toolbar', '.toolbar-search', '.blog-content'],
    captchaSelectors: ['.geetest', '.captcha', '#captcha', '.verify-wrap'],
    maxWaitMs: 20000,
  },
  juejin: {
    loginUrl: 'https://juejin.cn/login',
    usernameSelector: 'input[placeholder*="手机"], input[type="tel"], input[name="phone"]',
    passwordSelector: 'input[type="password"]',
    submitSelector: 'button:has-text("登录"), button.btn-login, .login-btn',
    switchToPasswordSelector: '.switch-account, a:has-text("密码登录"), .login-type:has-text("密码登录")',
    successUrl: 'juejin.cn',
    successSelectors: ['.drafts', '.publish-panel', '.entry-publish-form', '.user-avatar'],
    captchaSelectors: ['.geetest', '.captcha', '#captcha'],
    maxWaitMs: 20000,
  },
  bilibili: {
    loginUrl: 'https://passport.bilibili.com/login',
    usernameSelector: 'input[type="text"], input[placeholder*="手机"], input[placeholder*="邮箱"]',
    passwordSelector: 'input[type="password"]',
    submitSelector: 'button:has-text("登录"), .btn-login, .btn-primary',
    switchToPasswordSelector: '.login-tab:has-text("密码登录"), a:has-text("密码登录")',
    successUrl: 'bilibili.com',
    successSelectors: ['.home-container', '.user-avatar', '.h-body'],
    captchaSelectors: ['.geetest', '.captcha', '#captcha'],
    maxWaitMs: 20000,
  },
};

module.exports = {
  PLATFORM_URLS,
  PLATFORM_NAMES,
  CHECK_URLS,
  PLATFORM_LOGIN_REDIRECTS,
  PLATFORM_LOGIN_TEXTS,
  PLATFORM_LOGGED_IN_SELECTORS,
  LOGIN_CONFIG,
};
