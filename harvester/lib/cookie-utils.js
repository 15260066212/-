'use strict';

/**
 * Platform cookie domains for filtering
 */
const PLATFORM_DOMAINS = {
  zhihu: ['zhihu.com'],
  baijiahao: ['baidu.com'],
  toutiaohao: ['toutiao.com'],
  toutiao: ['toutiao.com'],
  csdn: ['csdn.net'],
  juejin: ['juejin.cn'],
  xiaohongshu: ['xiaohongshu.com'],
  bilibili: ['bilibili.com'],
  sohuhao: ['sohu.com'],
  wangyihao: ['163.com'],
  zhidao: ['baidu.com'],
  wechat: ['qq.com'],
};

/**
 * Get auth cookie names for a platform
 * @param {string} platform
 * @returns {string[]}
 */
function getAuthCookieNames(platform) {
  const authCookies = {
    zhihu: ['z_c0'],
    baijiahao: ['BDUSS', 'STOKEN'],
    toutiaohao: ['sessionid', 'sessionid_ss', 'sid_tt', 'uid_tt'],
    toutiao: ['sessionid', 'sessionid_ss', 'sid_tt', 'uid_tt'],
    csdn: ['UserName', 'UserToken', 'C_SESSION'],
    juejin: ['sessionid', 'sessionid_ss'],
    xiaohongshu: ['web_session', 'a1'],
    bilibili: ['SESSDATA', 'bili_jct'],
    sohuhao: ['SUV', 'IPLOC'],
    wangyihao: ['NTES_CMT_USER_INFO', 'P_INFO'],
    zhidao: ['BDUSS', 'STOKEN'],
    wechat: ['slave_user', 'slave_sid'],
  };
  return authCookies[platform] || [];
}

/**
 * Parse cookie header string into Playwright-style cookie objects
 * @param {string} cookieStr - Cookie header string like "name1=value1; name2=value2"
 * @param {string} platform - Platform name (used to derive domain)
 * @returns {Array<{name:string, value:string, domain:string, path:string}>}
 */
function parseCookieString(cookieStr, platform) {
  const domains = PLATFORM_DOMAINS[platform] || [];
  const primaryDomain = domains[0] ? `.${domains[0]}` : '';
  const cookies = [];

  if (!cookieStr || typeof cookieStr !== 'string') {
    return cookies;
  }

  const pairs = cookieStr.split(';').filter((p) => p.trim());
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const name = pair.substring(0, idx).trim();
    const value = pair.substring(idx + 1).trim();
    if (!name) continue;
    cookies.push({
      name,
      value,
      domain: primaryDomain,
      path: '/',
    });
  }

  return cookies;
}

/**
 * Filter cookies by domain list (substring match on domain field)
 * @param {Array<{domain?: string}>} cookies
 * @param {string[]} domains
 * @returns {Array}
 */
function filterCookiesByDomain(cookies, domains) {
  if (!Array.isArray(cookies) || !Array.isArray(domains)) {
    return [];
  }
  return cookies.filter((c) =>
    domains.some((d) => (c.domain || '').includes(d))
  );
}

/**
 * Convert cookie objects to cookie header string
 * @param {Array<{name:string, value:string}>} cookies
 * @returns {string}
 */
function cookiesToString(cookies) {
  if (!Array.isArray(cookies) || cookies.length === 0) {
    return '';
  }
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

/**
 * Check whether a URL matches any login redirect pattern
 * @param {string} url - URL to check
 * @param {string[]} redirectPatterns - Array of patterns to match (case-insensitive substring)
 * @returns {boolean}
 */
function isLoginRedirectUrl(url, redirectPatterns) {
  if (!url || typeof url !== 'string') {
    return false;
  }
  if (!Array.isArray(redirectPatterns) || redirectPatterns.length === 0) {
    return false;
  }
  const lowerUrl = url.toLowerCase();
  return redirectPatterns.some((p) => lowerUrl.includes(p.toLowerCase()));
}

module.exports = {
  PLATFORM_DOMAINS,
  parseCookieString,
  filterCookiesByDomain,
  cookiesToString,
  isLoginRedirectUrl,
  getAuthCookieNames,
};
