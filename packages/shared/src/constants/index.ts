/**
 * Shared constants and registries — organized by domain.
 *
 * Sub-path import: `import { API_BASE_URL, PLATFORM_NAMES } from '@zemingengine/shared/constants'`
 */

// Default constants
export {
  API_BASE_URL,
  SESSION_STORAGE_KEY,
  STAGE_DISPLAY_NAMES,
  STAGE_DESCRIPTIONS,
} from './defaults.js';

// Platform derived constants
export {
  PLATFORM_NAMES,
  PLATFORM_LABELS,
  PLATFORM_URLS,
} from './platform-constants.js';

// Platform registry (unified single source of truth)
export {
  PLATFORM_REGISTRY,
  getPlatformInfo,
  getPlatformInfoBySessionName,
  getPlatformInfoByHarvesterName,
  getHarvesterPlatformName,
  getCanonicalPlatformId,
  getSessionPlatformName,
  getPlatformLabel,
  getPlatformEditorUrl,
  getPlatformLLMWikiName,
  getPlatformDomains,
  getPlatformAuthCookieNames,
  getPlatformCapabilities,
  isApiPlatform,
  isRpaPlatform,
  listAllPlatforms,
  listApiPlatforms,
  listRpaPlatforms,
} from './platform-registry.js';

export type { PlatformInfo, PlatformCapabilities, PlatformLoginConfig } from './platform-registry.js';
