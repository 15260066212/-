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
}

interface CitationResult {
  sources: Source[];
  citation_count: number;
  owned_citation_count: number;
  competitor_citation_count: number;
}

export class CitationAnalysisService {
  NON_DOMAIN_TLDS = new Set(['js']);
  TRACKING_QUERY_KEYS = new Set([
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
    'spm', 'from', 'source', 'share', 'share_token', 'share_source', 'gclid', 'fbclid', 'msclkid', 'bd_vid'
  ]);

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
      .filter(([key]) => !this.TRACKING_QUERY_KEYS.has(String(key || '').toLowerCase()))
      .sort(([aKey, aValue], [bKey, bValue]) => (
        String(aKey).localeCompare(String(bKey)) || String(aValue).localeCompare(String(bValue))
      ));
    const query = params.length
      ? `?${params.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')}`
      : '';
    return `${protocol}//${host}${pathname}${query}`;
  }

  metadataForSource(value: any, context: any = {}): Record<string, string> {
    const metadata: Record<string, string> = {};
    if (context.source_origin) metadata.source_origin = context.source_origin;
    if (context.title) metadata.title = context.title;
    if (context.source_origin === 'web_search' && typeof value?.title === 'string' && value.title.trim()) {
      metadata.title = value.title.trim();
    }
    return metadata;
  }

  collectMetadataSources(value: any, sources: any[] = [], context: any = {}): any[] {
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
      if (value.type === 'url_citation' && value.url_citation) {
        this.collectMetadataSources(value.url_citation, sources, { ...context, source_origin: 'web_search' });
      }
      let hasUrlField = false;
      ['url', 'link', 'source', 'source_url', 'sourceUrl', 'reference_url', 'referenceUrl', 'display_url', 'displayUrl', 'web_url', 'webUrl', 'href'].forEach((key) => {
        if (typeof value[key] === 'string') {
          hasUrlField = hasUrlField || !!this.normalizeCandidateUrl(value[key]);
          this.collectMetadataSources(value[key], sources, this.metadataForSource(value, context));
        }
      });
      if (!hasUrlField) {
        ['domain', 'source_domain', 'sourceDomain', 'display_domain', 'displayDomain', 'hostname', 'host'].forEach((key) => {
          if (typeof value[key] === 'string' && !/^https?:\/\//i.test(value[key])) {
            const domain = this.normalizeDomain(value[key]);
            if (this.isValidDomain(domain)) sources.push({ url: '', domain, ...this.metadataForSource(value, context) });
          }
        });
      }
      ['citations', 'references', 'sources', 'source_urls', 'sourceUrls', 'search_results', 'searchResults', 'web_search', 'webSearch', 'source', 'output', 'content', 'choices', 'message', 'annotations', 'url_citation', 'urlCitation'].forEach((key) => {
        if (value[key]) this.collectMetadataSources(value[key], sources, context);
      });
    }
    return sources;
  }

  extractSources({ responseText, aiResponse, brand, competitors }: { responseText: string; aiResponse?: any; brand: Brand; competitors: Competitor[] }): CitationResult {
    const rawSources = [
      ...this.extractUrlsFromText(responseText).map((item) => ({ url: item.url })),
      ...this.collectMetadataSources(aiResponse)
    ];
    const brandDomain = this.normalizeDomain(brand?.website || '');
    const competitorDomains = (Array.isArray(competitors) ? competitors : [])
      .map((item) => this.normalizeDomain(item?.website || ''))
      .filter(Boolean);
    const seen = new Set<string>();
    const normalizedSources = rawSources
      .map((source: any) => {
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
      })
      .filter((source: any) => source?.domain)
      .filter((source: any) => this.isValidDomain(source.domain))
      .filter((source: any) => {
        const key = source.url ? source.url.toLowerCase() : `domain:${source.domain.toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    const urlDomains = new Set(
      normalizedSources
        .filter((source: any) => source.url)
        .map((source: any) => this.canonicalDomain(source.domain))
        .filter(Boolean)
    );
    const sources = normalizedSources
      .filter((source: any) => source.url || !urlDomains.has(this.canonicalDomain(source.domain)))
      .map((source: any) => ({
        ...source,
        owned: this.sameOrSubdomain(source.domain, brandDomain),
        competitor_owned: competitorDomains.some((domain) => this.sameOrSubdomain(source.domain, domain))
      }));

    return {
      sources,
      citation_count: sources.length,
      owned_citation_count: sources.filter((item: any) => item.owned).length,
      competitor_citation_count: sources.filter((item: any) => item.competitor_owned).length
    };
  }
}

export const citationAnalysisService = new CitationAnalysisService();
