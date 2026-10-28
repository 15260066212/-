import { describe, it, expect } from 'vitest';
import { classifyLoginError } from '../../lib/error-classifier.js';

describe('error-classifier', () => {
  describe('classifyLoginError', () => {
    it('classifies password error text as invalid_credentials', () => {
      expect(classifyLoginError('密码错误，请重新输入')).toBe('invalid_credentials');
      expect(classifyLoginError('账号或密码不正确')).toBe('invalid_credentials');
      expect(classifyLoginError('The password is incorrect')).toBe('invalid_credentials');
    });

    it('classifies account not found as invalid_credentials', () => {
      expect(classifyLoginError('账号不存在')).toBe('invalid_credentials');
      expect(classifyLoginError('用户不存在，请先注册')).toBe('invalid_credentials');
    });

    it('classifies captcha error as captcha type', () => {
      expect(classifyLoginError('请输入验证码')).toBe('captcha');
      expect(classifyLoginError('captcha verification failed')).toBe('captcha');
      expect(classifyLoginError('geetest 验证失败')).toBe('captcha');
    });

    it('classifies rate limiting errors as rate_limited', () => {
      expect(classifyLoginError('操作频率过高，请稍后再试')).toBe('rate_limited');
      expect(classifyLoginError('Too many attempts, please try later')).toBe('rate_limited');
    });

    it('classifies network errors as network type', () => {
      expect(classifyLoginError('网络错误，请检查连接')).toBe('network');
      expect(classifyLoginError('net::ERR_CONNECTION_REFUSED')).toBe('network');
      expect(classifyLoginError('Timeout waiting for response')).toBe('network');
    });

    it('returns unknown for unrecognized error text', () => {
      expect(classifyLoginError('Something went wrong')).toBe('unknown');
      expect(classifyLoginError('登录失败')).toBe('unknown');
    });

    it('returns unknown for empty/null input', () => {
      expect(classifyLoginError('')).toBe('unknown');
      expect(classifyLoginError(null)).toBe('unknown');
      expect(classifyLoginError(undefined)).toBe('unknown');
    });

    it('first matching pattern wins (password before captcha)', () => {
      const text = '密码错误，请输入验证码';
      expect(classifyLoginError(text)).toBe('invalid_credentials');
    });
  });
});
