import { HarvesterBrowserValidator } from './harvester-browser.js';

export class NeteaseValidator extends HarvesterBrowserValidator {
  readonly platform = 'netease' as const;
  protected override get harvesterPlatform(): string {
    return 'wangyihao';
  }
}
