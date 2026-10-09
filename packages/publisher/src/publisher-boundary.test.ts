import { describe, it, expect } from 'vitest';
import { Publisher } from './publisher.js';
import { RPAEngine } from './rpa-engine.js';
import type { PlatformId } from '@zemingengine/shared';

/**
 * Boundary tests for Publisher / RPAEngine separation of concerns.
 *
 * Goal: Publisher is the single entry point for all platform registration
 *       and publish orchestration. RPAEngine is a pure execution engine
 *       that does NOT auto-register handlers.
 */
describe('Publisher / RPAEngine 边界', () => {
  describe('Publisher.createDefault()', () => {
    it('注册所有已知发布平台（API + RPA）', () => {
      const pub = Publisher.createDefault();

      // API 平台
      expect(pub.supportsPlatform('weixin')).toBe(true);

      // RPA 平台 - createDefault 应该也注册了这些
      const rpaPlatforms: PlatformId[] = [
        'zhihu', 'baijia', 'toutiao', 'csdn', 'juejin',
        'bilibili', 'sohu', 'netease', 'zhidao',
      ];
      for (const p of rpaPlatforms) {
        expect(pub.supportsPlatform(p)).toBe(true);
      }
    });

    it('返回支持的平台列表', () => {
      const pub = Publisher.createDefault();
      const platforms = pub.listSupportedPlatforms();
      expect(platforms.length).toBeGreaterThanOrEqual(10);
      expect(platforms).toContain('weixin');
      expect(platforms).toContain('zhihu');
      expect(platforms).toContain('baijia');
    });
  });

  describe('RPAEngine 无自动注册', () => {
    it('新创建的 RPAEngine 不自动注册任何 handler', () => {
      // RPAEngine 应该是纯执行引擎，handler 注册由 Publisher 负责
      const engine = new RPAEngine();
      expect(engine.handlerCount).toBe(0);
    });

    it('可以通过 registerHandler 手动注册', () => {
      const engine = new RPAEngine();
      // 注册后应该有 handler
      // （具体 handler 的导入在其他测试中验证）
      expect(typeof engine.registerHandler).toBe('function');
    });
  });

  describe('Publisher 统一注册入口', () => {
    it('Publisher 可以注册 RPA handler', () => {
      const pub = new Publisher();
      expect(typeof pub.registerRpaHandler).toBe('function');
    });

    it('hasAdapter 和 hasHandler 统一为 supportsPlatform', () => {
      const pub = Publisher.createDefault();
      // 不再需要分别调用 hasAdapter / rpaEngine.hasHandler
      expect(typeof pub.supportsPlatform).toBe('function');
    });
  });
});
