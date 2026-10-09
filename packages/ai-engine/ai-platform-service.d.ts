interface PlatformConfig {
    name: string;
    apiUrl: string;
    apiKey: string;
    headers: Record<string, string>;
}
interface QueryResult {
    success: boolean;
    data?: any;
    error?: string;
    platform: string;
    responseTime?: number;
}
export declare class AIPlatformService {
    platforms: Record<string, PlatformConfig>;
    constructor();
    getApiUrl(platform: string): string;
    getDoubaoResponsesModel(): string;
    getModelName(platform: string): string;
    getMaxTokens(platform: string): number;
    buildRequestData(platform: string, question: string): any;
    getAvailablePlatforms(): string[];
    queryPlatform(platform: string, question: string): Promise<QueryResult>;
    queryMultiplePlatforms(platforms: string[], question: string): Promise<QueryResult[]>;
}
export declare const aiPlatformService: AIPlatformService;
export {};
//# sourceMappingURL=ai-platform-service.d.ts.map