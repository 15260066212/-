import type { PlatformCredentials } from '@zemingengine/shared';
import { BaseValidator } from './base.js';
import type { ValidationResult } from '../types.js';

export class WechatValidator extends BaseValidator {
  readonly platform = 'weixin' as const;

  async validate(credentials: PlatformCredentials): Promise<ValidationResult> {
    const { result, durationMs } = await this.measure(async () => {
      const appId = credentials.data.appId || credentials.data.app_id || '';
      const appSecret = credentials.data.appSecret || credentials.data.app_secret || '';

      if (!appId || !appSecret) {
        return { valid: false, error: 'Missing appId or appSecret' };
      }

      try {
        const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        const data = (await res.json()) as { access_token?: string; errcode?: number; errmsg?: string };

        if (data.access_token) {
          return { valid: true };
        }

        // Map common error codes
        const errCode = data.errcode ?? -1;
        let errorMsg = data.errmsg || 'Unknown error';

        if (errCode === 40013) {
          errorMsg = '无效的 AppID (40013)';
        } else if (errCode === 40125) {
          errorMsg = '无效的 AppSecret (40125)';
        } else if (errCode === 40164) {
          errorMsg = 'IP 不在白名单 (40164)';
        }

        return { valid: false, error: errorMsg };
      } catch (err) {
        return {
          valid: false,
          error: `Network error: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    });

    return {
      ...result,
      durationMs,
      evidence: result.error ? undefined : { pageTitle: 'WeChat API token' },
    } as ValidationResult;
  }
}
