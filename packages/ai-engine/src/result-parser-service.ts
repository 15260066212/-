import { TRACKING_QUERY_KEYS } from './source-utils.js';

export class ResultParserService {
  parseAIResponse(aiResponse: unknown) {
    const responseText = this.extractResponseText(aiResponse);
    return { originalText: responseText, parsingStatus: 'completed' as const };
  }

  /**
   * Normalize a URL for cross-platform deduplication.
   * Strips tracking params, normalizes protocol/host, removes trailing slash.
   */
  normalizeUrlForDedup(url: string): string {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
      const path = parsed.pathname.replace(/\/+$/, '') || '/';
      const params = Array.from(parsed.searchParams.entries())
        .filter(([k]) => !TRACKING_QUERY_KEYS.has(k.toLowerCase()))
        .sort(([a], [b]) => a.localeCompare(b));
      const query = params.length ? `?${params.map(([k, v]) => `${k}=${v}`).join('&')}` : '';
      return `${host}${path}${query}`.toLowerCase();
    } catch {
      return String(url || '').toLowerCase();
    }
  }

  /**
   * Normalize a domain for cross-platform deduplication.
   */
  normalizeDomainForDedup(domain: string): string {
    return String(domain || '').toLowerCase().replace(/^www\./, '').trim();
  }

  /**
   * Deduplicate sources across multiple platform results.
   * Returns merged source list with cross-platform citation count and consensus ranking.
   */
  deduplicateCrossPlatformSources(platformSources: Record<string, Array<{ url?: string; domain?: string; title?: string; ecosystem?: string }>>): {
    unifiedSources: { url: string; domain: string; title?: string; platforms: string[]; ecosystem: string }[];
    consensusSources: { url: string; domain: string; title?: string; platforms: string[]; ecosystem: string }[];
    platformCoverage: Record<string, number>;
  } {
    type UnifiedSource = { url: string; domain: string; title?: string; platforms: string[]; ecosystem: string };
    const sourceMap = new Map<string, UnifiedSource>();

    for (const [platform, sources] of Object.entries(platformSources)) {
      if (!Array.isArray(sources)) continue;
      for (const src of sources) {
        const domain = String(src?.domain || '').toLowerCase().replace(/^www\./, '');
        const url = String(src?.url || '').trim();
        const dedupKey = url ? this.normalizeUrlForDedup(url) : `domain:${this.normalizeDomainForDedup(domain)}`;
        if (!dedupKey || dedupKey === 'domain:') continue;

        const existing = sourceMap.get(dedupKey);
        if (existing) {
          if (!existing.platforms.includes(platform)) {
            existing.platforms.push(platform);
          }
        } else {
          sourceMap.set(dedupKey, {
            url: url || '',
            domain,
            title: src?.title,
            platforms: [platform],
            ecosystem: src?.ecosystem || 'independent',
          });
        }
      }
    }

    const unifiedSources = Array.from(sourceMap.values());
    const consensusSources = unifiedSources.filter((s) => s.platforms.length >= 2);

    const platformCoverage: Record<string, number> = {};
    for (const s of unifiedSources) {
      for (const p of s.platforms) {
        platformCoverage[p] = (platformCoverage[p] || 0) + 1;
      }
    }

    return { unifiedSources, consensusSources, platformCoverage };
  }

  extractResponseText(aiResponse: unknown): string {
    if (typeof aiResponse === 'string') return aiResponse;
    if (typeof aiResponse !== 'object' || aiResponse === null) return '';
    const resp = aiResponse as Record<string, unknown>;
    const data = resp.data as Record<string, unknown> | undefined;

    const doubaoOutput = resp.output || data?.output;
    if (Array.isArray(doubaoOutput)) {
      const messageItems = doubaoOutput.filter((item: unknown) => {
        const obj = item as Record<string, unknown>;
        return obj?.type === 'message';
      });
      for (const msg of messageItems) {
        const msgObj = msg as Record<string, unknown>;
        if (Array.isArray(msgObj.content)) {
          const texts = msgObj.content
            .filter((c: unknown) => {
              const obj = c as Record<string, unknown>;
              return obj?.type === 'output_text' && obj?.text;
            })
            .map((c: unknown) => (c as Record<string, unknown>).text as string);
          if (texts.length > 0) return texts.join('\n');
        }
      }
    }

    const choices = resp.choices as unknown[] | undefined;
    const dataChoices = data?.choices as unknown[] | undefined;
    const candidates: unknown[] = [
      (choices?.[0] as Record<string, unknown>)?.message as Record<string, unknown> | undefined,
      (dataChoices?.[0] as Record<string, unknown>)?.message as Record<string, unknown> | undefined,
    ].map((v) => v && typeof v === 'object' ? (v as Record<string, unknown>).content : undefined).concat([
      (choices?.[0] as Record<string, unknown>)?.text,
      (dataChoices?.[0] as Record<string, unknown>)?.text,
      resp.output,
      data?.output,
      resp.output_text,
      data?.output_text,
      resp.text,
      data?.text,
      resp.answer,
      data?.answer,
      resp.result,
      data?.result,
      resp.response,
      data?.response,
    ]);
    for (const candidate of candidates) {
      const text = this.normalizeTextContent(candidate);
      if (text) return text;
    }
    return '';
  }

  normalizeTextContent(content: unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map((item) => this.normalizeTextContent(item)).filter(Boolean).join('\n');
    }
    if (content && typeof content === 'object') {
      const obj = content as Record<string, unknown>;
      return this.normalizeTextContent(obj.text || obj.content || obj.output_text || obj.answer || obj.result || obj.response);
    }
    return '';
  }
}

export const resultParserService = new ResultParserService();
