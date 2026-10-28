import { describe, it, expect } from 'vitest';
import {
  HARVESTER_PLATFORMS,
  createHarvesterValidators,
} from './harvester-registry.js';

describe('HARVESTER_PLATFORMS 配置', () => {
  it('注册了 6 个平台', () => {
    expect(HARVESTER_PLATFORMS.length).toBe(6);
  });

  it('包含 zhihu', () => {
    expect(HARVESTER_PLATFORMS.find((p) => p.platform === 'zhihu')).toBeDefined();
  });

  it('包含 csdn', () => {
    expect(HARVESTER_PLATFORMS.find((p) => p.platform === 'csdn')).toBeDefined();
  });

  it('包含 juejin', () => {
    expect(HARVESTER_PLATFORMS.find((p) => p.platform === 'juejin')).toBeDefined();
  });

  it('toutiao 配置了 harvesterPlatform', () => {
    const toutiao = HARVESTER_PLATFORMS.find((p) => p.platform === 'toutiao');
    expect(toutiao).toBeDefined();
    expect(toutiao!.harvesterPlatform).toBe('toutiaohao');
  });

  it('sohu 配置了 harvesterPlatform', () => {
    const sohu = HARVESTER_PLATFORMS.find((p) => p.platform === 'sohu');
    expect(sohu).toBeDefined();
    expect(sohu!.harvesterPlatform).toBe('sohuhao');
  });

  it('netease 配置了 harvesterPlatform', () => {
    const netease = HARVESTER_PLATFORMS.find((p) => p.platform === 'netease');
    expect(netease).toBeDefined();
    expect(netease!.harvesterPlatform).toBe('wangyihao');
  });

  it('zhihu 没有自定义 harvesterPlatform', () => {
    const zhihu = HARVESTER_PLATFORMS.find((p) => p.platform === 'zhihu');
    expect(zhihu!.harvesterPlatform).toBeUndefined();
  });

  it('csdn 没有自定义 harvesterPlatform', () => {
    const csdn = HARVESTER_PLATFORMS.find((p) => p.platform === 'csdn');
    expect(csdn!.harvesterPlatform).toBeUndefined();
  });

  it('恰好 3 个平台有自定义 harvesterPlatform', () => {
    const custom = HARVESTER_PLATFORMS.filter((p) => p.harvesterPlatform !== undefined);
    expect(custom.length).toBe(3);
  });

  it('恰好 3 个平台没有自定义 harvesterPlatform', () => {
    const defaults = HARVESTER_PLATFORMS.filter((p) => p.harvesterPlatform === undefined);
    expect(defaults.length).toBe(3);
  });

  it('所有 platform 值唯一', () => {
    const platforms = HARVESTER_PLATFORMS.map((p) => p.platform);
    const unique = new Set(platforms);
    expect(unique.size).toBe(platforms.length);
  });
});

describe('createHarvesterValidators', () => {
  it('创建 6 个验证器实例', () => {
    const validators = createHarvesterValidators();
    expect(validators.length).toBe(6);
  });

  it('每个验证器有 platform 属性', () => {
    const validators = createHarvesterValidators();
    const knownPlatforms = HARVESTER_PLATFORMS.map((p) => p.platform);
    for (const v of validators) {
      expect(knownPlatforms).toContain(v.platform);
    }
  });

  it('第一个验证器是 zhihu', () => {
    const validators = createHarvesterValidators();
    expect(validators[0].platform).toBe('zhihu');
  });

  it('最后一个验证器是 netease', () => {
    const validators = createHarvesterValidators();
    expect(validators[validators.length - 1].platform).toBe('netease');
  });

  it('每个验证器都有 validate 方法', () => {
    const validators = createHarvesterValidators();
    for (const v of validators) {
      expect(typeof v.validate).toBe('function');
    }
  });
});
