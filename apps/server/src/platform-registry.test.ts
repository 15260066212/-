import { describe, it, expect } from 'vitest';
import {
  PLATFORM_REGISTRY,
  getPlatformInfo,
  getHarvesterPlatformName,
  getSessionPlatformName,
  getPlatformLabel,
  listAllPlatforms,
} from '@zemingengine/shared';

describe('PLATFORM_REGISTRY', () => {
  it('包含所有已知发布平台', () => {
    const platforms = listAllPlatforms();
    expect(platforms.length).toBeGreaterThanOrEqual(10);
    expect(platforms.map(p => p.id)).toContain('weixin');
    expect(platforms.map(p => p.id)).toContain('zhihu');
    expect(platforms.map(p => p.id)).toContain('baijia');
    expect(platforms.map(p => p.id)).toContain('toutiao');
    expect(platforms.map(p => p.id)).toContain('csdn');
    expect(platforms.map(p => p.id)).toContain('juejin');
    expect(platforms.map(p => p.id)).toContain('bilibili');
    expect(platforms.map(p => p.id)).toContain('sohu');
    expect(platforms.map(p => p.id)).toContain('netease');
    expect(platforms.map(p => p.id)).toContain('zhidao');
  });

  it('每个平台都有 id 和 label', () => {
    for (const p of listAllPlatforms()) {
      expect(p.id).toBeTruthy();
      expect(p.label).toBeTruthy();
    }
  });
});

describe('getPlatformInfo', () => {
  it('返回已知平台的完整信息', () => {
    const info = getPlatformInfo('zhihu');
    expect(info).toBeDefined();
    expect(info!.id).toBe('zhihu');
    expect(info!.label).toBe('知乎');
  });

  it('未知平台返回 undefined', () => {
    expect(getPlatformInfo('unknown-platform')).toBeUndefined();
  });
});

describe('getHarvesterPlatformName', () => {
  it('返回 harvester 使用的平台名称', () => {
    expect(getHarvesterPlatformName('weixin')).toBe('wechat');
    expect(getHarvesterPlatformName('baijia')).toBe('baijiahao');
    expect(getHarvesterPlatformName('toutiao')).toBe('toutiaohao');
    expect(getHarvesterPlatformName('sohu')).toBe('sohuhao');
    expect(getHarvesterPlatformName('netease')).toBe('wangyihao');
  });

  it('无特殊映射时返回原 id', () => {
    expect(getHarvesterPlatformName('zhihu')).toBe('zhihu');
    expect(getHarvesterPlatformName('csdn')).toBe('csdn');
  });
});

describe('getSessionPlatformName', () => {
  it('返回 session pool 使用的平台名称', () => {
    expect(getSessionPlatformName('weixin')).toBe('weixin');
    expect(getSessionPlatformName('zhihu')).toBe('zhihu');
    expect(getSessionPlatformName('baijia')).toBe('baijiahao');
    expect(getSessionPlatformName('toutiao')).toBe('toutiao');
    expect(getSessionPlatformName('csdn')).toBe('csdn');
    expect(getSessionPlatformName('juejin')).toBe('juejin');
    expect(getSessionPlatformName('bilibili')).toBe('bilibili');
    expect(getSessionPlatformName('sohu')).toBe('sohu');
    expect(getSessionPlatformName('netease')).toBe('netease');
    expect(getSessionPlatformName('zhidao')).toBe('zhidao');
  });
});

describe('getPlatformLabel', () => {
  it('返回中文显示名称', () => {
    expect(getPlatformLabel('weixin')).toBe('微信公众号');
    expect(getPlatformLabel('zhihu')).toBe('知乎');
    expect(getPlatformLabel('baijia')).toBe('百家号');
  });

  it('未知平台返回原 id', () => {
    expect(getPlatformLabel('unknown')).toBe('unknown');
  });
});
