import { HarvesterBrowserValidator } from './harvester-browser.js';

export class ToutiaoValidator extends HarvesterBrowserValidator {
  readonly platform = 'toutiao' as const;
  protected override get harvesterPlatform(): string {
    return 'toutiaohao';
  }
}
