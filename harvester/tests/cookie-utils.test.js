'use strict';

const assert = require('assert');
const {
  parseCookieString,
  filterCookiesByDomain,
  cookiesToString,
  isLoginRedirectUrl,
  getAuthCookieNames,
  PLATFORM_DOMAINS,
} = require('../lib/cookie-utils');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL: ${name} - ${e.message}`);
  }
}

console.log('=== cookie-utils tests ===');

test('parseCookieString: parses standard cookie header', () => {
  const result = parseCookieString('z_c0=abc123; _ga=GA1.2.xxx', 'zhihu');
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].name, 'z_c0');
  assert.strictEqual(result[0].value, 'abc123');
  assert.strictEqual(result[0].domain, '.zhihu.com');
  assert.strictEqual(result[0].path, '/');
});

test('parseCookieString: handles empty string', () => {
  assert.strictEqual(parseCookieString('', 'zhihu').length, 0);
  assert.strictEqual(parseCookieString(null, 'zhihu').length, 0);
  assert.strictEqual(parseCookieString(undefined, 'zhihu').length, 0);
});

test('parseCookieString: skips pairs without =', () => {
  const result = parseCookieString('z_c0=abc; invalidpair; _ga=xxx', 'zhihu');
  assert.strictEqual(result.length, 2);
});

test('parseCookieString: uses correct domain per platform', () => {
  const zhihuCookies = parseCookieString('a=1', 'zhihu');
  assert.strictEqual(zhihuCookies[0].domain, '.zhihu.com');

  const baiduCookies = parseCookieString('a=1', 'baijiahao');
  assert.strictEqual(baiduCookies[0].domain, '.baidu.com');

  const unknownCookies = parseCookieString('a=1', 'unknown');
  assert.strictEqual(unknownCookies[0].domain, '');
});

test('filterCookiesByDomain: filters by domain match', () => {
  const cookies = [
    { name: 'a', value: '1', domain: '.zhihu.com' },
    { name: 'b', value: '2', domain: '.baidu.com' },
    { name: 'c', value: '3', domain: '.google.com' },
  ];
  const filtered = filterCookiesByDomain(cookies, ['zhihu.com']);
  assert.strictEqual(filtered.length, 1);
  assert.strictEqual(filtered[0].name, 'a');
});

test('filterCookiesByDomain: handles empty inputs', () => {
  assert.strictEqual(filterCookiesByDomain([], ['zhihu.com']).length, 0);
  assert.strictEqual(filterCookiesByDomain(null, ['zhihu.com']).length, 0);
  assert.strictEqual(filterCookiesByDomain([{name:'a'}], null).length, 0);
});

test('filterCookiesByDomain: matches multiple domains', () => {
  const cookies = [
    { name: 'a', domain: '.baidu.com' },
    { name: 'b', domain: '.zhihu.com' },
  ];
  const filtered = filterCookiesByDomain(cookies, ['baidu.com', 'zhihu.com']);
  assert.strictEqual(filtered.length, 2);
});

test('cookiesToString: converts cookie array to header string', () => {
  const cookies = [
    { name: 'z_c0', value: 'abc' },
    { name: '_ga', value: 'GA1.2.xxx' },
  ];
  assert.strictEqual(cookiesToString(cookies), 'z_c0=abc; _ga=GA1.2.xxx');
});

test('cookiesToString: handles empty input', () => {
  assert.strictEqual(cookiesToString([]), '');
  assert.strictEqual(cookiesToString(null), '');
});

test('isLoginRedirectUrl: detects login URLs', () => {
  assert.strictEqual(isLoginRedirectUrl('https://zhihu.com/signin', ['signin']), true);
  assert.strictEqual(isLoginRedirectUrl('https://login.zhihu.com/x', ['login']), true);
});

test('isLoginRedirectUrl: rejects non-login URLs', () => {
  assert.strictEqual(isLoginRedirectUrl('https://zhihu.com/people/me', ['login', 'signin']), false);
});

test('isLoginRedirectUrl: handles empty inputs', () => {
  assert.strictEqual(isLoginRedirectUrl('', ['login']), false);
  assert.strictEqual(isLoginRedirectUrl('https://example.com', []), false);
  assert.strictEqual(isLoginRedirectUrl(null, ['login']), false);
});

test('isLoginRedirectUrl: case insensitive', () => {
  assert.strictEqual(isLoginRedirectUrl('https://example.com/LOGIN', ['login']), true);
});

test('getAuthCookieNames: returns correct cookies per platform', () => {
  assert.deepStrictEqual(getAuthCookieNames('zhihu'), ['z_c0']);
  assert.deepStrictEqual(getAuthCookieNames('baijiahao'), ['BDUSS', 'STOKEN']);
  assert.deepStrictEqual(getAuthCookieNames('juejin'), ['sessionid', 'sessionid_ss']);
});

test('getAuthCookieNames: returns empty for unknown platform', () => {
  assert.deepStrictEqual(getAuthCookieNames('unknown'), []);
});

test('PLATFORM_DOMAINS: all 11 platforms have domains', () => {
  const platforms = Object.keys(PLATFORM_DOMAINS);
  assert.strictEqual(platforms.length, 11);
  for (const p of platforms) {
    assert.ok(PLATFORM_DOMAINS[p].length > 0, `${p} has no domains`);
  }
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
