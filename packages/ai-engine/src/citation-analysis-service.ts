import { classifyEcosystem, TRACKING_QUERY_KEYS } from './source-utils.js';

interface Brand {
  name?: string;
  website?: string;
}

interface Competitor {
  name?: string;
  website?: string;
}

interface Source {
  url: string;
  domain: string;
  source_origin?: string;
  title?: string;
  owned?: boolean;
  competitor_owned?: boolean;
  ecosystem?: string;
  ecosystem_label?: string;
  publish_time?: string;
}

/** Intermediate source object produced by collectMetadataSources. */
interface RawSource {
  url?: string;
  domain?: string;
  source_origin?: string;
  title?: string;
}

/** Normalized source after URL parsing and domain validation. */
interface NormalizedSource {
  url: string;
  domain: string;
  source_origin?: string;
  title?: string;
}

/** Context metadata passed between source collection methods. */
interface SourceContext {
  source_origin?: string;
  title?: string;
}

interface CitationResult {
  sources: Source[];
  citation_count: number;
  owned_citation_count: number;
  competitor_citation_count: number;
  ecosystem_distribution: Record<string, number>;
}

export class CitationAnalysisService {
  NON_DOMAIN_TLDS = new Set(['js']);

  /**
   * Classify a domain into its ecosystem bucket.
   * Delegates to the shared classifier in source-utils.ts (single source of truth).
   */
  classifyEcosystem(domain: string): { ecosystem: string; label: string } {
    return classifyEcosystem(domain);
  }

  normalizeDomain(value: string): string {
    const text = String(value || '').trim();
    if (!text) return '';
    try {
      return new URL(text.startsWith('http') ? text : `https://${text}`).hostname.toLowerCase();
    } catch {
      return text.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
    }
  }

  isValidDomain(domain: string): boolean {
    const value = this.canonicalDomain(domain);
    if (!value || value.includes('..') || /[\s/:：]/.test(value)) return false;
    const labels = value.split('.');
    if (labels.length < 2) return false;
    const tld = labels[labels.length - 1].toLowerCase();
    if (this.NON_DOMAIN_TLDS.has(tld)) return false;
    return labels.every((label) => /^[a-z0-9-]+$/i.test(label) && !label.startsWith('-') && !label.endsWith('-'))
      && /^[a-z]{2,}$|^xn--[a-z0-9-]+$/i.test(tld);
  }

  sameOrSubdomain(domain: string, rootDomain: string): boolean {
    const normalizeComparable = (value: string) => String(value || '').toLowerCase().replace(/^www\./, '');
    const target = normalizeComparable(domain);
    const root = normalizeComparable(rootDomain);
    if (!target || !root) return false;
    return target === root || target.endsWith(`.${root}`);
  }

  canonicalDomain(domain: string): string {
    return String(domain || '').toLowerCase().replace(/^www\./, '');
  }

  normalizeCandidateUrl(value: string): string {
    const cleaned = this.stripTrailingPunctuation(String(value || '').trim());
    if (!cleaned || /\s/.test(cleaned)) return '';
    if (/^https?:\/\//i.test(cleaned)) return cleaned;
    if (this.isLikelyBareUrl(cleaned)) return `https://${cleaned}`;
    return '';
  }

  isLikelyBareUrl(value: string): boolean {
    const text = String(value || '').trim();
    const match = text.match(/^(www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(\/[^\s]*)?(\?[^\s]*)?(#[^\s]*)?$/i);
    if (!match) return false;
    return Boolean(match[1] || match[2] || match[3] || match[4]);
  }

  extractUrlsFromText(text: string): { index: number; url: string }[] {
    const source = String(text || '');
    const matches: { index: number; url: string }[] = [];
    const explicitPattern = /https?:\/\/[^\s）)\]}>】》」』，。；;、"'"'']+/gi;
    for (const match of source.matchAll(explicitPattern)) {
      const value = this.stripTrailingPunctuation(match[0]);
      if (value) matches.push({ index: match.index ?? 0, url: value });
    }
    const bareUrlPattern = /(^|[\s:：（(【《\["'"''])((?:www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s）)\]}>】》」』，。；;、"'"'']*)?)/gi;
    for (const match of source.matchAll(bareUrlPattern)) {
      const value = this.stripTrailingPunctuation(match[2]);
      if (this.isLikelyBareUrl(value)) matches.push({ index: (match.index ?? 0) + String(match[1] || '').length, url: `https://${value}` });
    }
    return matches.sort((a, b) => a.index - b.index).map((item) => ({ index: item.index, url: item.url }));
  }

  stripTrailingPunctuation(url: string): string {
    return String(url || '').replace(/[，。；;、,.!?！？:：""''》】」』]+$/g, '');
  }

  normalizeUrl(url: string): string {
    const parsed = new URL(url);
    const protocol = parsed.protocol.toLowerCase();
    const hostname = this.canonicalDomain(parsed.hostname);
    const port = parsed.port ? `:${parsed.port}` : '';
    const host = `${hostname}${port}`;
    const pathname = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '');
    const params = Array.from(parsed.searchParams.entries())
      .filter(([key]) => !TRACKING_QUERY_KEYS.has(String(key || '').toLowerCase()))
      .sort(([aKey, aValue], [bKey, bValue]) => (
        String(aKey).localeCompare(String(bKey)) || String(aValue).localeCompare(String(bValue))
      ));
    const query = params.length
      ? `?${params.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')}`
      : '';
    return `${protocol}//${host}${pathname}${query}`;
  }

  metadataForSource(value: Record<string, unknown> | null, context: SourceContext = {}): Record<string, string> {
    const metadata: Record<string, string> = {};
    if (context.source_origin) metadata.source_origin = context.source_origin;
    if (context.title) metadata.title = context.title;
    if (context.source_origin === 'web_search' && typeof value?.title === 'string' && (value.title as string).trim()) {
      metadata.title = (value.title as string).trim();
    }
    return metadata;
  }

  collectMetadataSources(value: unknown, sources: RawSource[] = [], context: SourceContext = {}): RawSource[] {
    if (!value) return sources;
    if (typeof value === 'string') {
      const url = this.normalizeCandidateUrl(value);
      const metadata = this.metadataForSource(null, context);
      if (url) sources.push({ url, ...metadata });
      else this.extractUrlsFromText(value).forEach((item) => sources.push({ url: item.url, ...metadata }));
      return sources;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => this.collectMetadataSources(item, sources, context));
      return sources;
    }
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      if (obj.type === 'url_citation' && obj.url_citation) {
        this.collectMetadataSources(obj.url_citation, sources, { ...context, source_origin: 'web_search' });
      }
      let hasUrlField = false;
      ['url', 'link', 'source', 'source_url', 'sourceUrl', 'reference_url', 'referenceUrl', 'display_url', 'displayUrl', 'web_url', 'webUrl', 'href'].forEach((key) => {
        if (typeof obj[key] === 'string') {
          hasUrlField = hasUrlField || !!this.normalizeCandidateUrl(obj[key] as string);
          this.collectMetadataSources(obj[key], sources, this.metadataForSource(obj, context));
        }
      });
      if (!hasUrlField) {
        ['domain', 'source_domain', 'sourceDomain', 'display_domain', 'displayDomain', 'hostname', 'host'].forEach((key) => {
          if (typeof obj[key] === 'string' && !/^https?:\/\//i.test(obj[key] as string)) {
            const domain = this.normalizeDomain(obj[key] as string);
            if (this.isValidDomain(domain)) sources.push({ url: '', domain, ...this.metadataForSource(obj, context) });
          }
        });
      }
      ['citations', 'references', 'sources', 'source_urls', 'sourceUrls', 'search_results', 'searchResults', 'web_search', 'webSearch', 'source', 'output', 'content', 'choices', 'message', 'annotations', 'url_citation', 'urlCitation'].forEach((key) => {
        if (obj[key]) this.collectMetadataSources(obj[key], sources, context);
      });
    }
    return sources;
  }

  extractSources({ responseText, aiResponse, brand, competitors }: { responseText: string; aiResponse?: unknown; brand: Brand; competitors: Competitor[] }): CitationResult {
    const rawSources: RawSource[] = [
      ...this.extractUrlsFromText(responseText).map((item) => ({ url: item.url })),
      ...this.collectMetadataSources(aiResponse)
    ];
    const brandDomain = this.normalizeDomain(brand?.website || '');
    const competitorDomains = (Array.isArray(competitors) ? competitors : [])
      .map((item) => this.normalizeDomain(item?.website || ''))
      .filter(Boolean);
    const seen = new Set<string>();
    const normalizedSources: (NormalizedSource | null)[] = rawSources
      .map((source: RawSource): NormalizedSource | null => {
        const url = String(source?.url || '').trim();
        if (!url && source?.domain) {
          const domain = this.canonicalDomain(this.normalizeDomain(source.domain));
          return this.isValidDomain(domain) ? { url: '', domain } : null;
        }
        try {
          const normalizedUrl = this.normalizeUrl(url);
          const parsed = new URL(normalizedUrl);
          const metadata: Record<string, string> = {};
          if (source.source_origin) metadata.source_origin = source.source_origin;
          if (source.title) metadata.title = source.title;
          return { url: normalizedUrl, domain: this.canonicalDomain(parsed.hostname), ...metadata };
        } catch {
          return null;
        }
      });
    const validSources: NormalizedSource[] = normalizedSources
      .filter((source): source is NormalizedSource => source !== null && !!source.domain)
      .filter((source) => this.isValidDomain(source.domain))
      .filter((source) => {
        const key = source.url ? source.url.toLowerCase() : `domain:${source.domain.toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    const urlDomains = new Set(
      validSources
        .filter((source) => source.url)
        .map((source) => this.canonicalDomain(source.domain))
        .filter(Boolean)
    );
    const sources: Source[] = validSources
      .filter((source) => source.url || !urlDomains.has(this.canonicalDomain(source.domain)))
      .map((source): Source => {
        const eco = classifyEcosystem(source.domain);
        return {
          ...source,
          ecosystem: eco.ecosystem,
          ecosystem_label: eco.label,
          owned: this.sameOrSubdomain(source.domain, brandDomain),
          competitor_owned: competitorDomains.some((domain) => this.sameOrSubdomain(source.domain, domain))
        };
      });

    const ecosystemDistribution = sources.reduce((acc: Record<string, number>, s: Source) => {
      const key = s.ecosystem || 'independent';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    return {
      sources,
      citation_count: sources.length,
      owned_citation_count: sources.filter((item) => item.owned).length,
      competitor_citation_count: sources.filter((item) => item.competitor_owned).length,
      ecosystem_distribution: ecosystemDistribution,
    };
  }
}

export const citationAnalysisService = new CitationAnalysisService();
