import { describe, it, expect } from 'vitest';
import {
  parseCookieString,
  filterCookiesByDomain,
  cookiesToString,
  isLoginRedirectUrl,
  getAuthCookieNames,
} from '../../lib/cookie-utils.js';

describe('cookie-utils', () => {
  describe('parseCookieString', () => {
    it('parses a normal cookie string', () => {
      const result = parseCookieString('sessionid=abc123; user=john', 'csdn');
      expect(result).toHaveLength(2, 'should parse 2 cookies from the string');
      expect(result[0]).toMatchObject({ name: 'sessionid', value: 'abc123' }, 'first cookie should be sessionid=abc123');
      expect(result[1]).toMatchObject({ name: 'user', value: 'john' }, 'second cookie should be user=john');
      expect(result[0].domain).toBe('.csdn.net', 'domain should be .csdn.net for csdn platform');
      expect(result[0].path).toBe('/', 'path should default to /');
    });

    it('returns empty array for null/undefined input', () => {
      expect(parseCookieString(null, 'csdn')).toEqual([], 'null input should return empty array');
      expect(parseCookieString(undefined, 'csdn')).toEqual([], 'undefined input should return empty array');
    });

    it('returns empty array for empty string', () => {
      expect(parseCookieString('', 'csdn')).toEqual([], 'empty string should return empty array');
    });

    it('handles cookie value containing = sign', () => {
      const result = parseCookieString('token=a=b=c; name=test', 'zhihu');
      expect(result).toHaveLength(2, 'should parse 2 cookies even with = in values');
      expect(result[0].name).toBe('token', 'first cookie name should be token');
      expect(result[0].value).toBe('a=b=c');
      expect(result[1].name).toBe('name');
      expect(result[1].value).toBe('test');
    });

    it('handles multiple cookies with spaces', () => {
      const result = parseCookieString('  a=1  ;  b=2  ;  c=3  ', 'juejin');
      expect(result).toHaveLength(3);
      expect(result.map((c) => c.name)).toEqual(['a', 'b', 'c']);
    });

    it('skips cookies without value (no = sign)', () => {
      const result = parseCookieString('valid=1; invalid; another=2', 'bilibili');
      expect(result).toHaveLength(2);
      expect(result.map((c) => c.name)).toEqual(['valid', 'another']);
    });

    it('skips cookies with empty name', () => {
      const result = parseCookieString('=value; valid=1', 'xiaohongshu');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('valid');
    });

    it('sets correct domain from platform', () => {
      const result = parseCookieString('x=1', 'wechat');
      expect(result[0].domain).toBe('.qq.com');
    });

    it('sets empty domain for unknown platform', () => {
      const result = parseCookieString('x=1', 'unknown-platform');
      expect(result[0].domain).toBe('');
    });

    it('returns empty array for non-string input', () => {
      expect(parseCookieString(123, 'csdn')).toEqual([]);
      expect(parseCookieString({}, 'csdn')).toEqual([]);
    });
  });

  describe('filterCookiesByDomain', () => {
    it('filters cookies by exact domain match', () => {
      const cookies = [
        { name: 'a', domain: '.example.com' },
        { name: 'b', domain: '.other.com' },
      ];
      const result = filterCookiesByDomain(cookies, ['example.com']);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('a');
    });

    it('filters cookies by subdomain match (substring)', () => {
      const cookies = [
        { name: 'a', domain: 'sub.example.com' },
        { name: 'b', domain: '.example.com' },
        { name: 'c', domain: 'other.com' },
      ];
      const result = filterCookiesByDomain(cookies, ['example.com']);
      expect(result).toHaveLength(2);
    });

    it('returns empty array for empty cookie list', () => {
      expect(filterCookiesByDomain([], ['example.com'])).toEqual([]);
    });

    it('returns empty array for empty domain list', () => {
      const cookies = [{ name: 'a', domain: '.example.com' }];
      expect(filterCookiesByDomain(cookies, [])).toEqual([]);
    });

    it('filters with multiple domains', () => {
      const cookies = [
        { name: 'a', domain: '.baidu.com' },
        { name: 'b', domain: '.qq.com' },
        { name: 'c', domain: '.other.com' },
      ];
      const result = filterCookiesByDomain(cookies, ['baidu.com', 'qq.com']);
      expect(result).toHaveLength(2);
      expect(result.map((c) => c.name)).toEqual(['a', 'b']);
    });

    it('handles cookies without domain field', () => {
      const cookies = [
        { name: 'a', domain: undefined },
        { name: 'b', domain: '' },
      ];
      const result = filterCookiesByDomain(cookies, ['example.com']);
      expect(result).toEqual([]);
    });

    it('handles null/undefined inputs gracefully', () => {
      expect(filterCookiesByDomain(null, ['x'])).toEqual([]);
      expect(filterCookiesByDomain([], null)).toEqual([]);
    });
  });

  describe('cookiesToString', () => {
    it('converts cookie array to header string', () => {
      const cookies = [
        { name: 'a', value: '1' },
        { name: 'b', value: '2' },
      ];
      expect(cookiesToString(cookies)).toBe('a=1; b=2');
    });

    it('returns empty string for empty array', () => {
      expect(cookiesToString([])).toBe('');
    });

    it('handles single cookie', () => {
      const cookies = [{ name: 'session', value: 'abc' }];
      expect(cookiesToString(cookies)).toBe('session=abc');
    });

    it('returns empty string for non-array input', () => {
      expect(cookiesToString(null)).toBe('');
      expect(cookiesToString(undefined)).toBe('');
    });
  });

  describe('isLoginRedirectUrl', () => {
    it('matches a login pattern', () => {
      expect(isLoginRedirectUrl('https://example.com/login', ['login'])).toBe(true);
    });

    it('does not match when no pattern applies', () => {
      expect(isLoginRedirectUrl('https://example.com/home', ['login'])).toBe(false);
    });

    it('is case insensitive', () => {
      expect(isLoginRedirectUrl('https://example.com/LOGIN', ['login'])).toBe(true);
      expect(isLoginRedirectUrl('https://example.com/Login', ['LOGIN'])).toBe(true);
    });

    it('matches any of multiple patterns', () => {
      const patterns = ['login', 'passport', 'signin'];
      expect(isLoginRedirectUrl('https://example.com/passport/xxx', patterns)).toBe(true);
      expect(isLoginRedirectUrl('https://example.com/signin', patterns)).toBe(true);
      expect(isLoginRedirectUrl('https://example.com/dashboard', patterns)).toBe(false);
    });

    it('returns false for empty/null URL', () => {
      expect(isLoginRedirectUrl('', ['login'])).toBe(false);
      expect(isLoginRedirectUrl(null, ['login'])).toBe(false);
    });

    it('returns false for empty patterns', () => {
      expect(isLoginRedirectUrl('https://example.com/login', [])).toBe(false);
    });

    it('handles URL with full path and query', () => {
      const url = 'https://passport.csdn.net/login?code=public&redirect=https%3A%2F%2Fwww.csdn.net';
      expect(isLoginRedirectUrl(url, ['passport.csdn.net', 'login'])).toBe(true);
    });
  });

  describe('getAuthCookieNames', () => {
    it('returns correct cookies for zhihu', () => {
      expect(getAuthCookieNames('zhihu')).toEqual(['z_c0']);
    });

    it('returns empty array for removed platforms (baijiahao/zhidao)', () => {
      expect(getAuthCookieNames('baijiahao')).toEqual([]);
      expect(getAuthCookieNames('zhidao')).toEqual([]);
    });

    it('returns correct cookies for csdn', () => {
      expect(getAuthCookieNames('csdn')).toEqual(['UserName', 'UserToken', 'C_SESSION']);
    });

    it('returns correct cookies for wechat', () => {
      expect(getAuthCookieNames('wechat')).toEqual(['slave_user', 'slave_sid']);
    });

    it('returns empty array for unknown platform', () => {
      expect(getAuthCookieNames('unknown')).toEqual([]);
      expect(getAuthCookieNames('')).toEqual([]);
    });

    it('returns empty array for null/undefined', () => {
      expect(getAuthCookieNames(null)).toEqual([]);
      expect(getAuthCookieNames(undefined)).toEqual([]);
    });
  });
});
