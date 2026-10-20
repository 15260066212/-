import { HarvesterBrowserValidator } from './harvester-browser.js';

export class JuejinValidator extends HarvesterBrowserValidator {
  readonly platform = 'juejin' as const;
}
