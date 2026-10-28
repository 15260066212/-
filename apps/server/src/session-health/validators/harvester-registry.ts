import type { PlatformId } from '@zemingengine/shared';
import { HarvesterBrowserValidator } from './harvester-browser.js';

/**
 * Configuration for a harvester-based platform validator.
 * When harvesterPlatform is omitted, the platform ID is used directly.
 */
export interface HarvesterPlatformConfig {
  platform: PlatformId;
  harvesterPlatform?: string;
}

/**
 * Registry of all RPA/harvester platform configurations.
 * Replaces the 10 previously empty Validator subclasses.
 */
export const HARVESTER_PLATFORMS: HarvesterPlatformConfig[] = [
  { platform: 'zhihu' },
  { platform: 'csdn' },
  { platform: 'toutiao', harvesterPlatform: 'toutiaohao' },
  { platform: 'juejin' },
  { platform: 'sohu', harvesterPlatform: 'sohuhao' },
  { platform: 'netease', harvesterPlatform: 'wangyihao' },
];

/**
 * Factory function that creates HarvesterBrowserValidator instances
 * for all registered harvester platforms.
 */
export function createHarvesterValidators(): HarvesterBrowserValidator[] {
  return HARVESTER_PLATFORMS.map(
    (cfg) => new HarvesterBrowserValidator(cfg.platform, cfg.harvesterPlatform),
  );
}
