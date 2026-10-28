import { HarvesterBrowserValidator } from './harvester-browser.js';

export class SohuValidator extends HarvesterBrowserValidator {
  readonly platform = 'sohu' as const;
  protected override get harvesterPlatform(): string {
    return 'sohuhao';
  }
}
