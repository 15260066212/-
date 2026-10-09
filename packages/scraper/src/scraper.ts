import * as cheerio from 'cheerio';
import type { ScrapeResult } from '@zemingengine/shared';

export interface ScrapeOptions {
  /** Timeout in milliseconds. Default: 10000 */
  timeout?: number;
  /** User agent string */
  userAgent?: string;
}

/**
 * Scrape a URL using Cheerio (static HTML parsing).
 * This is the primary scraping method, suitable for ~90% of sites.
 */
export async function scrapeUrl(
  url: string,
  options: ScrapeOptions = {}
): Promise<ScrapeResult> {
  const {
    timeout = 10_000,
    userAgent = 'ZemingEngine/0.1 (+https://zemingengine.dev)',
  } = options;

  const response = await fetch(url, {
    headers: { 'User-Agent': userAgent },
    signal: AbortSignal.timeout(timeout),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  // Extract title
  const title = $('title').first().text().trim();

  // Extract meta description
  const description =
    $('meta[name="description"]').attr('content')?.trim() ?? '';

  // Extract meta keywords
  const metaKeywords =
    $('meta[name="keywords"]').attr('content')?.trim() ?? '';

  // Extract headings (h1-h3)
  const headings: string[] = [];
  $('h1, h2, h3').each((_, el) => {
    const text = $(el).text().trim();
    if (text) headings.push(text);
  });

  // Extract links
  const links: { text: string; href: string }[] = [];
  $('a[href]').each((_, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr('href') ?? '';
    if (text && href) links.push({ text, href });
  });

  // Extract main text content
  // Remove script, style, nav, footer elements first
  $('script, style, nav, footer, header, noscript').remove();
  const textContent = $('body').text().replace(/\s+/g, ' ').trim();

  // Extract keywords from meta, headings, and content (prioritizing question-form for GEO)
  const keywords = extractKeywords($, metaKeywords, headings, textContent);

  // Extract product information
  const products = extractProducts($, links);

  // Extract about us content
  const aboutUs = extractAboutUs($, links, url);

  // Extract contact information
  const contactInfo = extractContactInfo($);

  return {
    url,
    title,
    description,
    headings,
    links,
    textContent,
    scrapedAt: new Date().toISOString(),
    method: 'cheerio',
    keywords,
    products,
    aboutUs,
    contactInfo,
  };
}

/**
 * Extract keywords from meta tags, headings, and content.
 * Prioritizes question-form keywords for GEO optimization.
 */
function extractKeywords(
  $: cheerio.CheerioAPI,
  metaKeywords: string,
  headings: string[],
  content: string
): string[] {
  const keywords = new Set<string>();

  // 1. Extract question-form content (highest priority for GEO)
  const questions = extractQuestions($, content);
  questions.forEach((q) => keywords.add(q));

  // 2. From meta keywords
  if (metaKeywords) {
    metaKeywords.split(/[,，、]/).forEach((kw) => {
      const trimmed = kw.trim();
      if (trimmed && trimmed.length > 1) keywords.add(trimmed);
    });
  }

  // 3. From headings (h1-h3) - also check for question-form headings
  headings.forEach((heading) => {
    // Question-form headings are GEO gold
    if (/[?？]/.test(heading) || /^(如何|怎么|什么是|为什么|哪些|哪个|是否|能否)/.test(heading)) {
      keywords.add(heading.replace(/[?？]/, '').trim());
    }
    // Extract key phrases from headings
    const phrases = heading
      .split(/[,，、；;|｜]/)
      .map((p) => p.trim())
      .filter((p) => p.length > 1 && p.length < 20);
    phrases.forEach((p) => keywords.add(p));
  });

  // 4. From content - extract frequently mentioned terms
  const words = content.split(/\s+/);
  const wordCount = new Map<string, number>();
  words.forEach((word) => {
    if (word.length > 1 && word.length < 10) {
      wordCount.set(word, (wordCount.get(word) || 0) + 1);
    }
  });

  // Add words that appear more than 3 times
  wordCount.forEach((count, word) => {
    if (count >= 3) {
      keywords.add(word);
    }
  });

  return Array.from(keywords).slice(0, 20); // Limit to 20 keywords
}

/**
 * Extract question-form content from the page for GEO optimization.
 * Looks for FAQ sections, question patterns in content, and Q&A structures.
 */
function extractQuestions(
  $: cheerio.CheerioAPI,
  content: string
): string[] {
  const questions: string[] = [];

  // 1. Look for FAQ sections
  const faqSelectors = [
    '[class*="faq"]',
    '[id*="faq"]',
    '[class*="question"]',
    '[id*="question"]',
    '[class*="qa"]',
    '[id*="qa"]',
    'dl', // definition lists often used for Q&A
  ];

  faqSelectors.forEach((selector) => {
    $(selector).each((_, el) => {
      const text = $(el).text();
      // Extract sentences that look like questions
      const questionMatches = text.match(/[^.!。！\n]*[?？]/g);
      if (questionMatches) {
        questionMatches.forEach((q) => {
          const trimmed = q.trim();
          if (trimmed.length > 5 && trimmed.length < 80) {
            questions.push(trimmed);
          }
        });
      }
    });
  });

  // 2. Extract questions from content using patterns
  const questionPatterns = [
    // Chinese question patterns
    /(?:^|[。！？\n])((?:如何|怎么|什么是|为什么|哪些|哪个|是否|能否|有没有|请问|想问)[^。！？\n]{5,60}[?？])/g,
    // Sentences ending with question marks
    /([^.!。！\n]{10,60}[?？])/g,
  ];

  questionPatterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const q = match[1]?.trim();
      if (q && q.length > 5 && q.length < 80) {
        // Filter out non-question content
        if (!/^[a-zA-Z]/.test(q) && !/^\d+$/.test(q)) {
          questions.push(q);
        }
      }
    }
  });

  // 3. Look for dt/dd pairs (definition list Q&A)
  $('dt').each((_, el) => {
    const question = $(el).text().trim();
    if (question.length > 5 && question.length < 80) {
      questions.push(question);
    }
  });

  // Deduplicate and limit
  const unique = [...new Set(questions)];
  return unique.slice(0, 10);
}

/**
 * Extract product information from the page
 */
function extractProducts(
  $: cheerio.CheerioAPI,
  links: { text: string; href: string }[]
): { name: string; description: string }[] {
  const products: { name: string; description: string }[] = [];

  // Look for product-related sections
  const productSelectors = [
    '[class*="product"]',
    '[class*="service"]',
    '[id*="product"]',
    '[id*="service"]',
    '.item',
    '.card',
  ];

  productSelectors.forEach((selector) => {
    $(selector).each((_, el) => {
      const $el = $(el);
      const name =
        $el.find('h2, h3, h4, .title, .name').first().text().trim() ||
        $el.find('a').first().text().trim();
      const description =
        $el.find('p, .description, .desc').first().text().trim();

      if (name && name.length > 1 && name.length < 50) {
        products.push({
          name,
          description: description || name,
        });
      }
    });
  });

  // Also look for links that might be product pages
  links.forEach((link) => {
    if (
      link.href.includes('/product') ||
      link.href.includes('/service') ||
      link.text.includes('产品') ||
      link.text.includes('服务')
    ) {
      if (link.text.length > 1 && link.text.length < 30) {
        products.push({
          name: link.text,
          description: link.text,
        });
      }
    }
  });

  // Remove duplicates
  const uniqueProducts = products.filter(
    (product, index, self) =>
      index === self.findIndex((p) => p.name === product.name)
  );

  return uniqueProducts.slice(0, 10); // Limit to 10 products
}

/**
 * Extract about us content
 */
function extractAboutUs(
  $: cheerio.CheerioAPI,
  _links: { text: string; href: string }[],
  _baseUrl: string
): string {
  // Try to find about us section on current page
  const aboutSelectors = [
    '[class*="about"]',
    '[id*="about"]',
    'section:contains("关于")',
    'div:contains("关于我们")',
  ];

  for (const selector of aboutSelectors) {
    const $el = $(selector).first();
    if ($el.length) {
      const text = $el.text().replace(/\s+/g, ' ').trim();
      if (text.length > 50) {
        return text.substring(0, 500); // Limit to 500 chars
      }
    }
  }

  // If no about us section found, return empty string
  // The about us page would need to be fetched separately
  return '';
}

/**
 * Extract contact information
 */
function extractContactInfo($: cheerio.CheerioAPI): {
  phone: string;
  email: string;
  address: string;
} {
  const contactInfo = {
    phone: '',
    email: '',
    address: '',
  };

  // Extract phone numbers
  const phoneRegex = /(\+?86)?1[3-9]\d{9}|0\d{2,3}-?\d{7,8}/g;
  const bodyText = $('body').text();
  const phoneMatch = bodyText.match(phoneRegex);
  if (phoneMatch) {
    contactInfo.phone = phoneMatch[0];
  }

  // Extract email
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const emailMatch = bodyText.match(emailRegex);
  if (emailMatch) {
    contactInfo.email = emailMatch[0];
  }

  // Extract address (look for common address patterns)
  const addressSelectors = [
    '[class*="address"]',
    '[id*="address"]',
    'address',
  ];

  for (const selector of addressSelectors) {
    const $el = $(selector).first();
    if ($el.length) {
      contactInfo.address = $el.text().replace(/\s+/g, ' ').trim();
      break;
    }
  }

  return contactInfo;
}
