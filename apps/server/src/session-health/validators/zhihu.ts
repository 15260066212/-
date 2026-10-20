import { HarvesterBrowserValidator } from './harvester-browser.js';

export class ZhihuValidator extends HarvesterBrowserValidator {
  readonly platform = 'zhihu' as const;
}
