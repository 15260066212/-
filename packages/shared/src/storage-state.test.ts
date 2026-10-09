import { describe, it, expect } from 'vitest';
import {
  cookieStringToStorageState,
  storageStateToCookieString,
  resolveStorageState,
  mergeRefreshedCookies,
  hasFullStorageState,
} from './storage-state.js';

describe('cookieStringToStorageState', () => {
  it('解析单个 cookie', () => {
    const state = cookieStringToStorageState('session=abc123');
    expect(state.cookies.length).toBe(1);
    expect(state.cookies[0].name).toBe('session');
    expect(state.cookies[0].value).toBe('abc123');
    expect(state.cookies[0].path).toBe('/');
    expect(state.origins.length).toBe(0);
  });

  it('解析多个 cookie', () => {
    const state = cookieStringToStorageState('a=1; b=2; c=3');
    expect(state.cookies.length).toBe(3);
    expect(state.cookies[0].name).toBe('a');
    expect(state.cookies[1].name).toBe('b');
    expect(state.cookies[2].name).toBe('c');
  });

  it('跳过空值和空 cookie', () => {
    const state = cookieStringToStorageState('a=1; ; b=2; =3');
    expect(state.cookies.length).toBe(2);
    expect(state.cookies[0].name).toBe('a');
    expect(state.cookies[1].name).toBe('b');
  });

  it('处理带等号的值', () => {
    const state = cookieStringToStorageState('token=abc=def=ghi');
    expect(state.cookies.length).toBe(1);
    expect(state.cookies[0].name).toBe('token');
    expect(state.cookies[0].value).toBe('abc=def=ghi');
  });

  it('空字符串返回空 cookies', () => {
    const state = cookieStringToStorageState('');
    expect(state.cookies.length).toBe(0);
  });

  it('每个 cookie 默认属性正确', () => {
    const state = cookieStringToStorageState('a=1');
    const cookie = state.cookies[0];
    expect(cookie.httpOnly).toBe(false);
    expect(cookie.secure).toBe(false);
    expect(cookie.sameSite).toBe('Lax');
    expect(cookie.expires).toBe(-1);
    expect(cookie.domain).toBe('');
  });
});

describe('storageStateToCookieString', () => {
  it('转换为 cookie 字符串', () => {
    const str = storageStateToCookieString({
      cookies: [
        { name: 'a', value: '1', domain: '', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' },
        { name: 'b', value: '2', domain: '', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' },
      ],
      origins: [],
    });
    expect(str).toBe('a=1; b=2');
  });

  it('空 cookies 返回空字符串', () => {
    const str = storageStateToCookieString({ cookies: [], origins: [] });
    expect(str).toBe('');
  });
});

describe('resolveStorageState', () => {
  it('优先使用 storageState JSON 字符串', () => {
    const state = resolveStorageState({
      storageState: JSON.stringify({
        cookies: [{ name: 'a', value: '1', domain: '', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' }],
        origins: [{ origin: 'https://example.com', localStorage: [{ name: 'k', value: 'v' }] }],
      }),
      cookie: 'legacy=value',
    });
    expect(state).not.toBeNull();
    expect(state!.cookies.length).toBe(1);
    expect(state!.cookies[0].name).toBe('a');
    expect(state!.origins.length).toBe(1);
  });

  it('storageState 为对象时直接使用', () => {
    const state = resolveStorageState({
      storageState: {
        cookies: [{ name: 'a', value: '1', domain: '', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' }],
        origins: [],
      },
      cookie: 'legacy=value',
    });
    expect(state).not.toBeNull();
    expect(state!.cookies[0].name).toBe('a');
  });

  it('无效 JSON 回退到 cookie 字符串', () => {
    const state = resolveStorageState({
      storageState: 'not-json',
      cookie: 'fallback=value',
    });
    expect(state).not.toBeNull();
    expect(state!.cookies[0].name).toBe('fallback');
  });

  it('无 storageState 时使用 cookie 字段', () => {
    const state = resolveStorageState({ cookie: 'session=abc' });
    expect(state).not.toBeNull();
    expect(state!.cookies[0].name).toBe('session');
  });

  it('支持 cookies 字段（复数）', () => {
    const state = resolveStorageState({ cookies: 'session=abc' });
    expect(state).not.toBeNull();
    expect(state!.cookies[0].name).toBe('session');
  });

  it('都没有时返回 null', () => {
    const state = resolveStorageState({});
    expect(state).toBeNull();
  });

  it('空 cookie 字符串返回 null', () => {
    const state = resolveStorageState({ cookie: '' });
    expect(state).toBeNull();
  });
});

describe('mergeRefreshedCookies', () => {
  it('合并新 cookies 到现有 state，保留 origins', () => {
    const existing = {
      cookies: [{ name: 'old', value: 'x', domain: '', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' as const }],
      origins: [{ origin: 'https://ex.com', localStorage: [{ name: 'k', value: 'v' }] }],
    };
    const fresh = [
      { name: 'new', value: 'y', domain: '', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' as const },
    ];
    const merged = mergeRefreshedCookies(existing, fresh);
    expect(merged.cookies.length).toBe(1);
    expect(merged.cookies[0].name).toBe('new');
    expect(merged.origins.length).toBe(1);
    expect(merged.origins[0].origin).toBe('https://ex.com');
  });

  it('existing 为 null 时只返回新 cookies', () => {
    const fresh = [
      { name: 'a', value: '1', domain: '', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' as const },
    ];
    const merged = mergeRefreshedCookies(null, fresh);
    expect(merged.cookies.length).toBe(1);
    expect(merged.origins.length).toBe(0);
  });
});

describe('hasFullStorageState', () => {
  it('有 origins 的 storageState 返回 true', () => {
    const result = hasFullStorageState({
      storageState: JSON.stringify({
        cookies: [],
        origins: [{ origin: 'https://ex.com', localStorage: [{ name: 'k', value: 'v' }] }],
      }),
    });
    expect(result).toBe(true);
  });

  it('只有 cookies 的返回 false', () => {
    const result = hasFullStorageState({
      storageState: JSON.stringify({
        cookies: [{ name: 'a', value: '1', domain: '', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' }],
        origins: [],
      }),
    });
    expect(result).toBe(false);
  });

  it('非字符串返回 false', () => {
    const result = hasFullStorageState({ storageState: 123 });
    expect(result).toBe(false);
  });

  it('无效 JSON 返回 false', () => {
    const result = hasFullStorageState({ storageState: 'not json' });
    expect(result).toBe(false);
  });
});
