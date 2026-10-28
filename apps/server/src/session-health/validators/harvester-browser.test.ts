import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HarvesterBrowserValidator } from './harvester-browser.js';

describe('HarvesterBrowserValidator', () => {
  describe('构造与属性', () => {
    it('platform 属性正确设置', () => {
      const v = new HarvesterBrowserValidator('zhihu');
      expect(v.platform).toBe('zhihu', 'should have correct platform when platform 属性正确设置');
    });

    it('csdn platform 属性正确', () => {
      const v = new HarvesterBrowserValidator('csdn');
      expect(v.platform).toBe('csdn', 'should have correct platform when csdn platform 属性正确');
    });

    it('harvesterPlatform 默认等于 platform', () => {
      const v = new HarvesterBrowserValidator('zhihu');
      expect((v as any).harvesterPlatform).toBe('zhihu', 'should have correct harvesterPlatform when harvesterPlatform 默认等于 platform');
    });

    it('harvesterPlatform 使用自定义值', () => {
      const v = new HarvesterBrowserValidator('baijia', 'baijiahao');
      expect((v as any).harvesterPlatform).toBe('baijiahao', 'should have correct harvesterPlatform when harvesterPlatform 使用自定义值');
    });

    it('harvesterPlatform 与 platform 不同', () => {
      const v = new HarvesterBrowserValidator('toutiao', 'toutiaohao');
      expect((v as any).harvesterPlatform).not.toBe(v.platform);
    });
  });

  describe('validate — 缺少 Harvester URL', () => {
    it('未配置 RPA_REMOTE_URL 时默认 valid（降级不阻断）', async () => {
      delete process.env.RPA_REMOTE_URL;
      const v = new HarvesterBrowserValidator('zhihu');
      const result = await v.validate({
        platform: 'zhihu',
        accountId: 'test',
        data: { cookie: 'session=abc' },
      } as any);
      expect(result.valid).toBe(true, 'should have correct valid flag when 未配置 RPA_REMOTE_URL 时默认 valid（降级不阻断）');
      expect(result.error).toBeUndefined('should be undefined when 未配置 RPA_REMOTE_URL 时默认 valid（降级不阻断）');
    });
  });

  describe('validate — 缺少 Cookie', () => {
    beforeEach(() => {
      process.env.RPA_REMOTE_URL = 'http://harvester:3000';
    });

    it('无 cookie 字段时返回 invalid', async () => {
      const v = new HarvesterBrowserValidator('zhihu');
      const result = await v.validate({
        platform: 'zhihu',
        accountId: 'test',
        data: {},
      } as any);
      expect(result.valid).toBe(false, 'should have correct valid flag when 无 cookie 字段时返回 invalid');
      expect(result.error).toContain('cookie', 'should contain expected value in error field for 无 cookie 字段时返回 invalid');
    });

    it('cookie 为空字符串时返回 invalid', async () => {
      const v = new HarvesterBrowserValidator('zhihu');
      const result = await v.validate({
        platform: 'zhihu',
        accountId: 'test',
        data: { cookie: '' },
      } as any);
      expect(result.valid).toBe(false, 'should have correct valid flag when cookie 为空字符串时返回 invalid');
    });

    it('支持 cookies 字段（复数形式）', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          valid: true,
          pageTitle: 'Test',
          finalUrl: 'https://zhihu.com',
        }),
      });
      vi.stubGlobal('fetch', fetchSpy);

      const v = new HarvesterBrowserValidator('zhihu');
      const result = await v.validate({
        platform: 'zhihu',
        accountId: 'test',
        data: { cookies: 'session=abc' },
      } as any);

      expect(result.valid).toBe(true, 'should have correct valid flag when 支持 cookies 字段（复数形式）');
      vi.unstubAllGlobals();
    });
  });

  describe('validate — 成功场景', () => {
    beforeEach(() => {
      process.env.RPA_REMOTE_URL = 'http://harvester:3000';
    });

    it('Harvester 返回 valid 时标记成功', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          valid: true,
          pageTitle: '知乎首页',
          finalUrl: 'https://www.zhihu.com',
          screenshot: 'data:image/png;base64,abc',
        }),
      });
      vi.stubGlobal('fetch', fetchSpy);

      const v = new HarvesterBrowserValidator('zhihu');
      const result = await v.validate({
        platform: 'zhihu',
        accountId: 'test',
        data: { cookie: 'session=abc' },
      } as any);

      expect(result.valid).toBe(true, 'should have correct valid flag when Harvester 返回 valid 时标记成功');
      expect(result.evidence?.pageTitle).toBe('知乎首页', 'should have correct pageTitle when Harvester 返回 valid 时标记成功');
      expect(result.evidence?.finalUrl).toBe('https://www.zhihu.com', 'should have correct finalUrl when Harvester 返回 valid 时标记成功');
      expect(result.evidence?.screenshot).toBeTruthy('should be truthy when Harvester 返回 valid 时标记成功');
      expect(result.durationMs).toBeGreaterThanOrEqual(0, 'should be greater than or equal for Harvester 返回 valid 时标记成功');
      vi.unstubAllGlobals();
    });

    it('调用 check-session 端点', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, valid: true }),
      });
      vi.stubGlobal('fetch', fetchSpy);

      const v = new HarvesterBrowserValidator('zhihu');
      await v.validate({
        platform: 'zhihu',
        accountId: 'test',
        data: { cookie: 'session=abc' },
      } as any);

      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain('/api/rpa/check-session');
      expect(url).toContain('harvester:3000');
      vi.unstubAllGlobals();
    });

    it('请求 body 包含 platform 和 cookies', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, valid: true }),
      });
      vi.stubGlobal('fetch', fetchSpy);

      const v = new HarvesterBrowserValidator('zhihu');
      await v.validate({
        platform: 'zhihu',
        accountId: 'test',
        data: { cookie: 'session=abc' },
      } as any);

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.platform).toBe('zhihu');
      expect(body.cookies).toBe('session=abc');
      vi.unstubAllGlobals();
    });
  });

  describe('validate — 失败场景', () => {
    beforeEach(() => {
      process.env.RPA_REMOTE_URL = 'http://harvester:3000';
    });

    it('Harvester 返回 valid=false 时标记失败', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          valid: false,
          pageTitle: '登录页',
        }),
      });
      vi.stubGlobal('fetch', fetchSpy);

      const v = new HarvesterBrowserValidator('zhihu');
      const result = await v.validate({
        platform: 'zhihu',
        accountId: 'test',
        data: { cookie: 'session=expired' },
      } as any);

      expect(result.valid).toBe(false);
      vi.unstubAllGlobals();
    });

    it('Harvester 返回 success=false 时标记失败', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: false,
          error: 'Navigation timeout',
        }),
      });
      vi.stubGlobal('fetch', fetchSpy);

      const v = new HarvesterBrowserValidator('zhihu');
      const result = await v.validate({
        platform: 'zhihu',
        accountId: 'test',
        data: { cookie: 'session=abc' },
      } as any);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Navigation timeout');
      vi.unstubAllGlobals();
    });

    it('HTTP 非 200 时返回 HTTP 错误', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });
      vi.stubGlobal('fetch', fetchSpy);

      const v = new HarvesterBrowserValidator('zhihu');
      const result = await v.validate({
        platform: 'zhihu',
        accountId: 'test',
        data: { cookie: 'session=abc' },
      } as any);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('500');
      vi.unstubAllGlobals();
    });

    it('网络异常时返回错误', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

      const v = new HarvesterBrowserValidator('zhihu');
      const result = await v.validate({
        platform: 'zhihu',
        accountId: 'test',
        data: { cookie: 'session=abc' },
      } as any);

      expect(result.valid).toBe(false);
      expect(result.error).toBeTruthy();
      vi.unstubAllGlobals();
    });
  });

  describe('Harvester URL 尾部斜杠处理', () => {
    it('URL 尾部有斜杠时仍能正确拼接端点', async () => {
      process.env.RPA_REMOTE_URL = 'http://harvester:3000/';

      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, valid: true }),
      });
      vi.stubGlobal('fetch', fetchSpy);

      const v = new HarvesterBrowserValidator('zhihu');
      await v.validate({
        platform: 'zhihu',
        accountId: 'test',
        data: { cookie: 'session=abc' },
      } as any);

      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).not.toContain('//api');
      expect(url).toContain('http://harvester:3000/api/rpa/check-session');
      vi.unstubAllGlobals();
    });

    it('URL 尾部有多个斜杠时仍能正确拼接', async () => {
      process.env.RPA_REMOTE_URL = 'http://harvester:3000///';

      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, valid: true }),
      });
      vi.stubGlobal('fetch', fetchSpy);

      const v = new HarvesterBrowserValidator('zhihu');
      await v.validate({
        platform: 'zhihu',
        accountId: 'test',
        data: { cookie: 'session=abc' },
      } as any);

      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain('http://harvester:3000/api/rpa/check-session');
      vi.unstubAllGlobals();
    });
  });

  afterEach(() => {
    delete process.env.RPA_REMOTE_URL;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});
