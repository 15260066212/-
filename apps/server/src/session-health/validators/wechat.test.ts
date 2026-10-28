import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WechatValidator } from './wechat.js';

describe('WechatValidator', () => {
  let validator: WechatValidator;

  beforeEach(() => {
    validator = new WechatValidator();
  });

  describe('platform 属性', () => {
    it('platform 为 weixin', () => {
      expect(validator.platform).toBe('weixin', 'should have correct platform when platform 为 weixin');
    });
  });

  describe('validate — 缺少凭证', () => {
    it('缺少 appId 和 appSecret 时返回 invalid', async () => {
      const result = await validator.validate({
        platform: 'weixin',
        accountId: 'test',
        data: {},
      } as any);

      expect(result.valid).toBe(false, 'should have correct valid flag when 缺少 appId 和 appSecret 时返回 invalid');
      expect(result.error).toBe('Missing appId or appSecret', 'should have correct error field when 缺少 appId 和 appSecret 时返回 invalid');
    });

    it('缺少 appSecret 时返回 invalid', async () => {
      const result = await validator.validate({
        platform: 'weixin',
        accountId: 'test',
        data: { appId: 'wx123' },
      } as any);

      expect(result.valid).toBe(false, 'should have correct valid flag when 缺少 appSecret 时返回 invalid');
      expect(result.error).toBe('Missing appId or appSecret', 'should have correct error field when 缺少 appSecret 时返回 invalid');
    });

    it('缺少 appId 时返回 invalid', async () => {
      const result = await validator.validate({
        platform: 'weixin',
        accountId: 'test',
        data: { appSecret: 'secret123' },
      } as any);

      expect(result.valid).toBe(false, 'should have correct valid flag when 缺少 appId 时返回 invalid');
      expect(result.error).toBe('Missing appId or appSecret', 'should have correct error field when 缺少 appId 时返回 invalid');
    });

    it('支持 app_id 和 app_secret 命名（snake_case）', async () => {
      const result = await validator.validate({
        platform: 'weixin',
        accountId: 'test',
        data: { app_id: 'wx123', app_secret: 'secret123' },
      } as any);

      // 有凭证但 fetch 会失败，不会返回 "Missing" 错误
      expect(result.error).not.toBe('Missing appId or appSecret');
    });

    it('支持 appId 和 appSecret 命名（camelCase）', async () => {
      const result = await validator.validate({
        platform: 'weixin',
        accountId: 'test',
        data: { appId: 'wx123', appSecret: 'secret123' },
      } as any);

      expect(result.error).not.toBe('Missing appId or appSecret');
    });
  });

  describe('validate — 成功场景', () => {
    it('返回 access_token 时标记为 valid', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ access_token: 'token_123' }),
      }));

      const result = await validator.validate({
        platform: 'weixin',
        accountId: 'test',
        data: { appId: 'wx123', appSecret: 'secret123' },
      } as any);

      expect(result.valid).toBe(true, 'should have correct valid flag when 返回 access_token 时标记为 valid');
      expect(result.error).toBeUndefined('should be undefined when 返回 access_token 时标记为 valid');
      expect(result.evidence?.pageTitle).toBe('WeChat API token', 'should have correct pageTitle when 返回 access_token 时标记为 valid');
      expect(result.durationMs).toBeGreaterThanOrEqual(0, 'should be greater than or equal for 返回 access_token 时标记为 valid');
    });
  });

  describe('validate — 错误码映射', () => {
    it('errcode 40013 映射为无效 AppID', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ errcode: 40013, errmsg: 'invalid appid' }),
      }));

      const result = await validator.validate({
        platform: 'weixin',
        accountId: 'test',
        data: { appId: 'bad', appSecret: 'secret' },
      } as any);

      expect(result.valid).toBe(false, 'should have correct valid flag when errcode 40013 映射为无效 AppID');
      expect(result.error).toContain('40013', 'should contain expected value in error field for errcode 40013 映射为无效 AppID');
      expect(result.error).toContain('AppID', 'should contain expected value in error field for errcode 40013 映射为无效 AppID');
    });

    it('errcode 40125 映射为无效 AppSecret', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ errcode: 40125, errmsg: 'invalid appsecret' }),
      }));

      const result = await validator.validate({
        platform: 'weixin',
        accountId: 'test',
        data: { appId: 'wx123', appSecret: 'bad' },
      } as any);

      expect(result.valid).toBe(false, 'should have correct valid flag when errcode 40125 映射为无效 AppSecret');
      expect(result.error).toContain('40125');
      expect(result.error).toContain('AppSecret');
    });

    it('errcode 40164 映射为 IP 不在白名单', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ errcode: 40164, errmsg: 'invalid ip' }),
      }));

      const result = await validator.validate({
        platform: 'weixin',
        accountId: 'test',
        data: { appId: 'wx123', appSecret: 'secret' },
      } as any);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('40164');
      expect(result.error).toContain('白名单');
    });

    it('未知 errcode 使用 errmsg', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ errcode: 99999, errmsg: 'custom error' }),
      }));

      const result = await validator.validate({
        platform: 'weixin',
        accountId: 'test',
        data: { appId: 'wx123', appSecret: 'secret' },
      } as any);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('custom error');
    });

    it('无 errmsg 时使用 Unknown error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ errcode: 88888 }),
      }));

      const result = await validator.validate({
        platform: 'weixin',
        accountId: 'test',
        data: { appId: 'wx123', appSecret: 'secret' },
      } as any);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Unknown error');
    });
  });

  describe('validate — 网络错误', () => {
    it('fetch 抛出异常时返回 Network error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection refused')));

      const result = await validator.validate({
        platform: 'weixin',
        accountId: 'test',
        data: { appId: 'wx123', appSecret: 'secret' },
      } as any);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Network error');
      expect(result.error).toContain('Connection refused');
    });

    it('非 Error 对象的异常也能处理', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue('string error'));

      const result = await validator.validate({
        platform: 'weixin',
        accountId: 'test',
        data: { appId: 'wx123', appSecret: 'secret' },
      } as any);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Network error');
      expect(result.error).toContain('string error');
    });
  });

  describe('validate — URL 构造', () => {
    it('fetch URL 包含 appId 和 appSecret', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ access_token: 'token' }),
      });
      vi.stubGlobal('fetch', fetchSpy);

      await validator.validate({
        platform: 'weixin',
        accountId: 'test',
        data: { appId: 'wx_test_id', appSecret: 'secret_test' },
      } as any);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain('appid=wx_test_id');
      expect(url).toContain('secret=secret_test');
      expect(url).toContain('api.weixin.qq.com');
    });

    it('特殊字符的 appId 被 URL 编码', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ access_token: 'token' }),
      });
      vi.stubGlobal('fetch', fetchSpy);

      await validator.validate({
        platform: 'weixin',
        accountId: 'test',
        data: { appId: 'wx&special', appSecret: 'secret' },
      } as any);

      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain('appid=wx');
      // & should be encoded in the appid value
      expect(url).not.toMatch(/appid=wx&special/);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});
