import { describe, it, expect } from 'vitest';
import type { Article, PlatformCredentials } from '@zemingengine/shared';
import type { Page } from 'playwright';
import { BaiduZhidaoRpaHandler } from './baidu-zhidao.js';

/**
 * Mock Page that simulates Playwright Page behavior for Baidu Zhidao.
 * Makes fillInput/clickElement succeed by default (matching the base class's
 * try-catch-returns-true pattern).
 */
class MockPage {
  urlValue: string;
  gotoUrl = '';
  /** If set, goto() will update urlValue to this instead of the requested URL (simulates redirect). */
  redirectUrl: string | null = null;
  /** URL to set after a submit click (simulates post-submit navigation). */
  postSubmitUrl: string | null = null;
  filledInputs: { selector: string; text: string }[] = [];
  clickedElements: string[] = [];
  typedText = '';
  screenshots: string[] = [];
  timeouts: number[] = [];
  selectorStore: Map<string, boolean> = new Map();

  constructor(urlValue: string = 'https://zhidao.baidu.com/ask') {
    this.urlValue = urlValue;
  }

  async goto(url: string): Promise<void> {
    this.gotoUrl = url;
    // If redirect is configured, simulate being redirected (e.g. to login page)
    this.urlValue = this.redirectUrl ?? url;
  }

  url(): string {
    return this.urlValue;
  }

  async waitForSelector(selector: string, _opts?: { state?: string; timeout?: number }): Promise<void> {
    if (this.selectorStore.has(selector) && !this.selectorStore.get(selector)) {
      throw new Error(`Selector not visible: ${selector}`);
    }
  }

  async fill(selector: string, text: string): Promise<void> {
    this.filledInputs.push({ selector, text });
  }

  async click(selector: string): Promise<void> {
    this.clickedElements.push(selector);
    // Simulate post-submit URL change when a submit button is clicked
    if (this.postSubmitUrl && (selector.includes('submit') || selector.includes('提交') || selector.includes('发布'))) {
      this.urlValue = this.postSubmitUrl;
    }
  }

  async screenshot(opts?: { path?: string }): Promise<void> {
    if (opts?.path) this.screenshots.push(opts.path);
  }

  async setExtraHTTPHeaders(): Promise<void> {}

  locator(selector: string): MockLocator {
    return new MockLocator(selector, this);
  }

  async waitForTimeout(ms: number): Promise<void> {
    this.timeouts.push(ms);
  }

  keyboard = {
    type: async (text: string): Promise<void> => {
      this.typedText += text;
    },
    press: async (_key: string): Promise<void> => {},
  };
}

class MockLocator {
  constructor(
    public selector: string,
    public page: MockPage,
  ) {}

  async isVisible(_opts?: { timeout?: number }): Promise<boolean> {
    // Simulate ProseMirror/ql-editor as visible (rich text editors)
    if (this.selector.includes('ProseMirror') || this.selector.includes('ql-editor')) {
      return true;
    }
    // contenteditable not visible by default
    if (this.selector.includes('contenteditable')) {
      return false;
    }
    // textarea not visible by default
    if (this.selector.includes('textarea')) {
      return false;
    }
    return false;
  }

  async click(): Promise<void> {
    this.page.clickedElements.push(this.selector);
  }

  async fill(text: string): Promise<void> {
    this.page.filledInputs.push({ selector: this.selector, text });
  }

  async textContent(): Promise<string | null> {
    return '页面内容正常';
  }

  first(): MockLocator {
    return this;
  }
}

function createMockArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: 'article-zhidao-1',
    sessionId: 'session-1',
    platform: 'zhidao',
    contentType: 'popularization',
    title: '漳州有演讲口才培训班吗？',
    contentMarkdown: '有的，漳州超级演说家比较专业。',
    tags: [],
    wordCount: 50,
    status: 'draft',
    generationRound: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function createMockCredentials(overrides: Partial<PlatformCredentials> = {}): PlatformCredentials {
  return {
    platform: 'zhidao',
    type: 'cookie',
    data: { cookie: 'BDUSS=mock_bduss_token; BAIDUID=mock_baidu_id' },
    status: 'active',
    ...overrides,
  };
}

describe('BaiduZhidaoRpaHandler', () => {
  it('should be constructed with platform "zhidao"', () => {
    const handler = new BaiduZhidaoRpaHandler();
    expect(handler.platform).toBe('zhidao');
  });

  it('should fail when no cookies are provided', async () => {
    const handler = new BaiduZhidaoRpaHandler();
    const page = new MockPage() as unknown as Page;
    const article = createMockArticle();
    const credentials = createMockCredentials({ data: {} });

    const result = await handler.publish(page, article, credentials);

    expect(result.success).toBe(false);
    expect(result.error).toContain('No cookies found');
  });

  it('should fail when BDUSS/BAIDUID cookies are missing', async () => {
    const handler = new BaiduZhidaoRpaHandler();
    const page = new MockPage() as unknown as Page;
    const article = createMockArticle();
    const credentials = createMockCredentials({
      data: { cookie: 'some_other_cookie=value' },
    });

    const result = await handler.publish(page, article, credentials);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Missing BDUSS/BAIDUID');
  });

  it('should use ask mode when no questionUrl is provided', async () => {
    const handler = new BaiduZhidaoRpaHandler();
    // Simulate: after submit, page navigates to the published question
    const page = new MockPage('https://zhidao.baidu.com/ask') as unknown as Page;
    // postSubmitUrl simulates the URL change that happens after clicking the submit button
    (page as unknown as MockPage).postSubmitUrl = 'https://zhidao.baidu.com/question/abc123def.html';
    const article = createMockArticle({
      title: '漳州有演讲口才培训班吗？',
      contentMarkdown: '详情补充内容',
    });
    const credentials = createMockCredentials();

    const result = await handler.publish(page, article, credentials);

    expect((page as unknown as MockPage).gotoUrl).toBe('https://zhidao.baidu.com/ask');
    expect(result.success).toBe(true);
    expect(result.postId).toBe('abc123def');
    expect(result.postUrl).toContain('zhidao.baidu.com');
  });

  it('should use answer mode when questionUrl is provided in credentials', async () => {
    const handler = new BaiduZhidaoRpaHandler();
    const questionUrl = 'https://zhidao.baidu.com/question/abc123.html';
    const page = new MockPage(questionUrl) as unknown as Page;
    const article = createMockArticle({
      contentMarkdown: '这是回答内容，超级演说家不错。',
    });
    const credentials = createMockCredentials({
      data: {
        cookie: 'BDUSS=mock_token; BAIDUID=mock_id',
        questionUrl,
      },
    });

    const result = await handler.publish(page, article, credentials);

    expect((page as unknown as MockPage).gotoUrl).toBe(questionUrl);
    expect(result.success).toBe(true);
    expect(result.postUrl).toBe(questionUrl);
  });

  it('should use answer mode when questionUrl is provided in article metadata', async () => {
    const handler = new BaiduZhidaoRpaHandler();
    const questionUrl = 'https://zhidao.baidu.com/question/xyz456.html';
    const page = new MockPage(questionUrl) as unknown as Page;
    const article = createMockArticle({
      metadata: { questionUrl },
      contentMarkdown: '这是通过 metadata 提供的回答内容。',
    });
    const credentials = createMockCredentials();

    const result = await handler.publish(page, article, credentials);

    expect((page as unknown as MockPage).gotoUrl).toBe(questionUrl);
    expect(result.success).toBe(true);
  });

  it('should fail in answer mode when article has no content', async () => {
    const handler = new BaiduZhidaoRpaHandler();
    const questionUrl = 'https://zhidao.baidu.com/question/empty.html';
    const page = new MockPage(questionUrl) as unknown as Page;
    const article = createMockArticle({
      contentMarkdown: '',
      contentPlain: '',
    });
    const credentials = createMockCredentials({
      data: {
        cookie: 'BDUSS=mock_token; BAIDUID=mock_id',
        questionUrl,
      },
    });

    const result = await handler.publish(page, article, credentials);

    expect(result.success).toBe(false);
    expect(result.error).toContain('No answer content');
  });

  it('should detect auth failure when redirected to login page', async () => {
    const handler = new BaiduZhidaoRpaHandler();
    const page = new MockPage() as unknown as Page;
    // Simulate: goto() is redirected to login page (auth failure)
    (page as unknown as MockPage).redirectUrl = 'https://passport.baidu.com/login';
    const article = createMockArticle();
    const credentials = createMockCredentials();

    const result = await handler.publish(page, article, credentials);

    expect(result.success).toBe(false);
    expect(result.error).toContain('authentication failed');
  });

  it('should detect auth failure in answer mode when redirected to passport', async () => {
    const handler = new BaiduZhidaoRpaHandler();
    const questionUrl = 'https://zhidao.baidu.com/question/test.html';
    const page = new MockPage() as unknown as Page;
    // Simulate: goto(questionUrl) is redirected to passport login (auth failure)
    (page as unknown as MockPage).redirectUrl = 'https://passport.baidu.com/v2/login';
    const article = createMockArticle({ contentMarkdown: '回答内容' });
    const credentials = createMockCredentials({
      data: { cookie: 'BDUSS=token; BAIDUID=id', questionUrl },
    });

    const result = await handler.publish(page, article, credentials);

    expect(result.success).toBe(false);
    expect(result.error).toContain('authentication failed');
  });

  it('should detect 404 error in answer mode', async () => {
    const handler = new BaiduZhidaoRpaHandler();
    const questionUrl = 'https://zhidao.baidu.com/question/deleted.html';
    const page = new MockPage() as unknown as Page;
    // Simulate: goto(questionUrl) is redirected to a 404 error page
    (page as unknown as MockPage).redirectUrl = 'https://zhidao.baidu.com/error/404.html';
    const article = createMockArticle({ contentMarkdown: '回答内容' });
    const credentials = createMockCredentials({
      data: { cookie: 'BDUSS=token; BAIDUID=id', questionUrl },
    });

    const result = await handler.publish(page, article, credentials);

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });
});
