import { HarvesterBrowserValidator } from './harvester-browser.js';

export class BaijiaValidator extends HarvesterBrowserValidator {
  readonly platform = 'baijia' as const;
  protected override get harvesterPlatform(): string {
    return 'baijiahao';
  }
}
