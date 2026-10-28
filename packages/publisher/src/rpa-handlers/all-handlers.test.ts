import { describe, it, expect } from 'vitest';
import type { PlatformId } from '@zemingengine/shared';
import {
  CsdnRpaHandler,
  ZhihuRpaHandler,
  JuejinRpaHandler,
  ToutiaoRpaHandler,
  SohuRpaHandler,
  NeteaseRpaHandler,
} from './index.js';
import { RPAEngine } from '../rpa-engine.js';
import { Publisher } from '../publisher.js';
import { RpaHandler } from './base.js';

/**
 * Test fixture: all 6 RPA handler classes and their expected platform IDs.
 */
const HANDLER_SPECS: Array<{
  name: string;
  HandlerClass: new () => RpaHandler;
  expectedPlatform: PlatformId;
}> = [
  { name: 'CsdnRpaHandler', HandlerClass: CsdnRpaHandler, expectedPlatform: 'csdn' },
  { name: 'ZhihuRpaHandler', HandlerClass: ZhihuRpaHandler, expectedPlatform: 'zhihu' },
  { name: 'JuejinRpaHandler', HandlerClass: JuejinRpaHandler, expectedPlatform: 'juejin' },
  { name: 'ToutiaoRpaHandler', HandlerClass: ToutiaoRpaHandler, expectedPlatform: 'toutiao' },
  { name: 'SohuRpaHandler', HandlerClass: SohuRpaHandler, expectedPlatform: 'sohu' },
  { name: 'NeteaseRpaHandler', HandlerClass: NeteaseRpaHandler, expectedPlatform: 'netease' },
];

describe('RPA Handlers - Export and Platform Property', () => {
  it('should export exactly 6 handler classes', () => {
    expect(HANDLER_SPECS).toHaveLength(6);
  });

  for (const spec of HANDLER_SPECS) {
    it(`${spec.name} should be a class (constructor function)`, () => {
      expect(typeof spec.HandlerClass).toBe('function');
    });

    it(`${spec.name} should be constructable and extend RpaHandler`, () => {
      const handler = new spec.HandlerClass();
      expect(handler).toBeInstanceOf(RpaHandler);
    });

    it(`${spec.name}.platform should be "${spec.expectedPlatform}"`, () => {
      const handler = new spec.HandlerClass();
      expect(handler.platform).toBe(spec.expectedPlatform);
    });
  }

  it('all 6 handler platform IDs should be unique', () => {
    const platforms = HANDLER_SPECS.map((s) => s.expectedPlatform);
    const unique = new Set(platforms);
    expect(unique.size).toBe(6);
  });
});

describe('RPAEngine - Handler Registration', () => {
  it('new RPAEngine() starts with zero handlers (no auto-registration)', () => {
    const engine = new RPAEngine();
    expect(engine.handlerCount).toBe(0);
  });

  it('can register all 6 handlers manually', () => {
    const engine = new RPAEngine();
    for (const spec of HANDLER_SPECS) {
      engine.registerHandler(new spec.HandlerClass());
    }
    expect(engine.handlerCount).toBe(6);
    for (const spec of HANDLER_SPECS) {
      expect(engine.hasHandler(spec.expectedPlatform)).toBe(true);
    }
  });

  it('should return false for unregistered platforms (weixin)', () => {
    const engine = new RPAEngine();
    // weixin uses API adapter, not RPA handler
    expect(engine.hasHandler('weixin')).toBe(false);
  });

  it('getHandlerPlatforms returns all registered platform IDs', () => {
    const engine = new RPAEngine();
    engine.registerHandler(new CsdnRpaHandler());
    engine.registerHandler(new ZhihuRpaHandler());
    const platforms = engine.getHandlerPlatforms();
    expect(platforms).toContain('csdn');
    expect(platforms).toContain('zhihu');
    expect(platforms.length).toBe(2);
  });
});

describe('Publisher.createDefault - Unified Platform Registration', () => {
  it('should register weixin as the only API adapter', () => {
    const publisher = Publisher.createDefault();
    expect(publisher.hasAdapter('weixin')).toBe(true);
  });

  it('should have exactly 1 API adapter registered (weixin)', () => {
    const publisher = Publisher.createDefault();
    const allPlatforms: PlatformId[] = [
      'weixin', 'csdn', 'zhihu', 'toutiao',
      'juejin', 'sohu', 'netease',
    ];

    let registeredCount = 0;
    for (const platform of allPlatforms) {
      if (publisher.hasAdapter(platform)) registeredCount++;
    }
    expect(registeredCount).toBe(1);
  });

  it('supportsPlatform returns true for all 7 platforms (API + RPA)', () => {
    const publisher = Publisher.createDefault();
    const allPlatforms: PlatformId[] = [
      'weixin', 'csdn', 'zhihu', 'toutiao',
      'juejin', 'sohu', 'netease',
    ];
    for (const p of allPlatforms) {
      expect(publisher.supportsPlatform(p)).toBe(true);
    }
  });

  it('listSupportedPlatforms returns all 7 platforms', () => {
    const publisher = Publisher.createDefault();
    const platforms = publisher.listSupportedPlatforms();
    expect(platforms.length).toBe(7);
    expect(platforms).toContain('weixin');
    expect(platforms).toContain('zhihu');
    expect(platforms).toContain('toutiao');
  });

  it('weixin adapter should use api method', () => {
    const publisher = Publisher.createDefault();
    expect(publisher.getMethodForPlatform('weixin')).toBe('api');
  });

  it('all RPA platforms should use rpa method (default when no adapter)', () => {
    const publisher = Publisher.createDefault();
    const rpaPlatforms: PlatformId[] = [
      'csdn', 'zhihu', 'toutiao',
      'juejin', 'sohu', 'netease',
    ];

    for (const platform of rpaPlatforms) {
      expect(publisher.getMethodForPlatform(platform)).toBe('rpa');
    }
  });

  it('RPA platforms should not have adapters (handled by RPAEngine)', () => {
    const publisher = Publisher.createDefault();
    const rpaPlatforms: PlatformId[] = [
      'csdn', 'zhihu', 'toutiao',
      'juejin', 'sohu', 'netease',
    ];

    for (const platform of rpaPlatforms) {
      expect(publisher.hasAdapter(platform)).toBe(false);
    }
  });
});
