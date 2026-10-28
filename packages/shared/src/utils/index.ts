/**
 * Shared utility functions.
 *
 * Sub-path import: `import { resolveStorageState } from '@zemingengine/shared/utils'`
 */

export {
  cookieStringToStorageState,
  storageStateToCookieString,
  resolveStorageState,
  mergeRefreshedCookies,
  hasFullStorageState,
  filterCookiesByDomain,
  isLoginRedirectUrl,
} from './storage-state.js';

export type { StorageState } from './storage-state.js';
