import { vi } from 'vitest';
import Module from 'node:module';

const pageMock = {
  goto: vi.fn(),
  close: vi.fn(),
  url: vi.fn(),
  title: vi.fn(),
  textContent: vi.fn(),
  $: vi.fn(),
  $$: vi.fn(),
  screenshot: vi.fn(),
  waitForLoadState: vi.fn(),
  waitForTimeout: vi.fn(),
  content: vi.fn(),
  evaluate: vi.fn(),
  fill: vi.fn(),
  click: vi.fn(),
  waitForSelector: vi.fn(),
};

const contextMock = {
  newPage: vi.fn(),
  cookies: vi.fn(),
  close: vi.fn(),
  addCookies: vi.fn(),
};

const browserMock = {
  newContext: vi.fn(),
  close: vi.fn(),
};

const launchFn = vi.fn();

// Set up default mock chain: launch → browser → context → page
launchFn.mockResolvedValue(browserMock);
browserMock.newContext.mockResolvedValue(contextMock);
contextMock.newPage.mockResolvedValue(pageMock);

pageMock.goto.mockResolvedValue(undefined);
pageMock.close.mockResolvedValue(undefined);
pageMock.url.mockReturnValue('https://example.com');
pageMock.title.mockResolvedValue('Test Page');
pageMock.textContent.mockResolvedValue('');
pageMock.$.mockResolvedValue(null);
pageMock.$$.mockResolvedValue([]);
pageMock.screenshot.mockResolvedValue(Buffer.from('fake'));
pageMock.waitForLoadState.mockResolvedValue(undefined);
pageMock.waitForTimeout.mockResolvedValue(undefined);
pageMock.content.mockResolvedValue('<html></html>');
pageMock.evaluate.mockResolvedValue(null);
pageMock.fill.mockResolvedValue(undefined);
pageMock.click.mockResolvedValue(undefined);
pageMock.waitForSelector.mockResolvedValue(null);

contextMock.cookies.mockResolvedValue([]);
contextMock.close.mockResolvedValue(undefined);
contextMock.addCookies.mockResolvedValue(undefined);
browserMock.close.mockResolvedValue(undefined);

// Patch Module._load to intercept require('playwright')
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'playwright') {
    return {
      chromium: { launch: launchFn },
    };
  }
  return originalLoad.apply(this, arguments);
};

// Expose mocks globally so test files can access them
globalThis.__playwrightMocks = { launchFn, browserMock, contextMock, pageMock };
