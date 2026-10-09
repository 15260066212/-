import { Hono } from 'hono';
import { scrapeUrl } from '@zemingengine/scraper';
import { analyzeWebsite, isAIAvailable, recommendKeywords } from '@zemingengine/ai-engine';
import type { KeywordType } from '@zemingengine/shared';
import { getSession, updateSession } from '../session-store.js';
import type { DatabaseAccess } from '../db.js';

export function createScrapeRoutes(db: DatabaseAccess): Hono {
  const scrapeRoutes = new Hono();

  // POST /api/session/:id/scrape - Scrape website and analyze with AI
  scrapeRoutes.post('/:id/scrape', async (c) => {
    const id = c.req.param('id');
    const entry = getSession(id, db);
  if (!entry) {
    return c.json({ success: false, error: 'Session not found' }, 404);
  }

  const body = await c.req.json<{ url: string }>();
  if (!body.url) {
    return c.json({ success: false, error: 'URL is required' }, 400);
  }

  // Validate URL format and prevent SSRF
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(body.url);
  } catch {
    return c.json({ success: false, error: 'Invalid URL format' }, 400);
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return c.json({ success: false, error: 'Only http and https URLs are allowed' }, 400);
  }
  // SSRF protection: block localhost, private IPs, and internal hostnames
  const hostname = parsedUrl.hostname.toLowerCase();
  const blockedPatterns = [
    'localhost', '127.', '192.168.', '10.', '172.16.', '172.17.',
    '172.18.', '172.19.', '172.2', '172.30.', '172.31.',
    '0.0.0.0', '[::1]', '::1',
  ];
  if (blockedPatterns.some(p => hostname.startsWith(p) || hostname === p)) {
    return c.json({ success: false, error: 'URL hostname is not allowed' }, 400);
  }

  try {
    // Step 1: Scrape the website
    const scrapeResult = await scrapeUrl(body.url);

    // Step 2: AI analysis (if available)
    let analysisSummary = '';
    let aiKeywords: { question: string; type: KeywordType; priority: number; geoContext: string }[] = [];
    if (isAIAvailable()) {
      try {
        const analysis = await analyzeWebsite(scrapeResult, entry.engine.getSession());

        // Update session with AI analysis results (overwrite with fresh website data)
        const updated = entry.engine.getSession();
        const aiEnt = analysis.enterprise;
        if (aiEnt.fullName) updated.enterprise.fullName = aiEnt.fullName;
        if (aiEnt.shortName) updated.enterprise.shortName = aiEnt.shortName;
        if (aiEnt.description) updated.enterprise.description = aiEnt.description;
        if (aiEnt.scale) updated.enterprise.scale = aiEnt.scale;
        if (aiEnt.location) updated.enterprise.location = aiEnt.location;
        if (aiEnt.brandStory) updated.enterprise.brandStory = aiEnt.brandStory;
        if (aiEnt.trustAnchors?.length) updated.enterprise.trustAnchors = aiEnt.trustAnchors;
        if (aiEnt.brandTone?.length) updated.enterprise.brandTone = aiEnt.brandTone;
        if (aiEnt.products?.length) updated.enterprise.products = aiEnt.products;
        entry.engine.setSession(updated);
        updateSession(id, updated, db);

        analysisSummary = analysis.summary;
        aiKeywords = analysis.keywords || [];
      } catch {
        // AI analysis failed, use basic scraping results
        analysisSummary = `已抓取官网：${scrapeResult.url}\n标题：${scrapeResult.title}\n描述：${scrapeResult.description}\n\n（AI 分析不可用，请手动补充信息。）`;
      }
    } else {
      analysisSummary = `已抓取官网：${scrapeResult.url}\n标题：${scrapeResult.title}\n描述：${scrapeResult.description}\n\n（未配置 AI 服务，请手动补充信息。）`;
    }

    // Step 3: Update basic session data
    const updated = entry.engine.getSession();
    updated.currentStage = 'profile';
    updated.enterprise.website = scrapeResult.url;
    if (!updated.enterprise.fullName && scrapeResult.title) {
      updated.enterprise.fullName = scrapeResult.title;
    }
    if (!updated.enterprise.description && scrapeResult.description) {
      updated.enterprise.description = scrapeResult.description;
    }

    // Populate keywords - prefer AI analysis, fallback to recommender, then scrape
    if (aiKeywords.length > 0) {
      updated.keywords = aiKeywords;
    } else {
      try {
        const recommended = await recommendKeywords(updated);
        if (recommended.length > 0) {
          updated.keywords = recommended;
        } else if (scrapeResult.keywords.length > 0) {
          updated.keywords = scrapeResult.keywords.slice(0, 5).map((kw, index) => ({
            question: kw,
            type: 'core' as const,
            priority: index + 1,
            geoContext: `从官网提取的关键词：${kw}`,
          }));
        }
      } catch {
        // Recommender failed, use scrape keywords
        if (scrapeResult.keywords.length > 0) {
          updated.keywords = scrapeResult.keywords.slice(0, 5).map((kw, index) => ({
            question: kw,
            type: 'core' as const,
            priority: index + 1,
            geoContext: `从官网提取的关键词：${kw}`,
          }));
        }
      }
    }

    // Populate products from scrape
    if (scrapeResult.products.length > 0 && (!updated.enterprise.products || updated.enterprise.products.length === 0)) {
      updated.enterprise.products = scrapeResult.products.slice(0, 5).map((p, index) => ({
        name: p.name,
        description: p.description,
        category: '',
        isPrimary: index === 0,
      }));
    }

    // Populate about us content
    if (scrapeResult.aboutUs && !updated.enterprise.brandStory) {
      updated.enterprise.brandStory = scrapeResult.aboutUs;
    }

    // Populate contact info
    if (scrapeResult.contactInfo.address && !updated.enterprise.location) {
      updated.enterprise.location = scrapeResult.contactInfo.address;
    }

    entry.engine.setSession(updated);
    updateSession(id, updated, db);

    // Step 4: Return analysis summary as a system message
    const analysisMessage = {
      id: `msg_${Date.now()}_analysis`,
      role: 'system' as const,
      content: analysisSummary,
      stage: 'intro' as const,
      timestamp: new Date().toISOString(),
    };

    return c.json({
      success: true,
      data: {
        scrapeResult,
        analysisMessage,
        sessionData: updated,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Scraping failed';
    return c.json({ success: false, error: message }, 500);
  }
});

  return scrapeRoutes;
}
