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
export declare class CitationAnalysisService {
    NON_DOMAIN_TLDS: Set<string>;
    TRACKING_QUERY_KEYS: Set<string>;
    normalizeDomain(value: string): string;
    isValidDomain(domain: string): boolean;
    sameOrSubdomain(domain: string, rootDomain: string): boolean;
    canonicalDomain(domain: string): string;
    normalizeCandidateUrl(value: string): string;
    isLikelyBareUrl(value: string): boolean;
    extractUrlsFromText(text: string): {
        index: number;
        url: string;
    }[];
    stripTrailingPunctuation(url: string): string;
    normalizeUrl(url: string): string;
    metadataForSource(value: any, context?: any): Record<string, string>;
    collectMetadataSources(value: any, sources?: any[], context?: any): any[];
    extractSources({ responseText, aiResponse, brand, competitors }: {
        responseText: string;
        aiResponse?: any;
        brand: Brand;
        competitors: Competitor[];
    }): CitationResult;
}
export declare const citationAnalysisService: CitationAnalysisService;
export {};
//# sourceMappingURL=citation-analysis-service.d.ts.map