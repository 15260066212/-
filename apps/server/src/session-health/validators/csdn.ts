import { HarvesterBrowserValidator } from './harvester-browser.js';

export class CsdnValidator extends HarvesterBrowserValidator {
  readonly platform = 'csdn' as const;
}
