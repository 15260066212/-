export declare class ResultParserService {
    parseAIResponse(aiResponse: any): {
        originalText: string;
        parsingStatus: "completed";
    };
    extractResponseText(aiResponse: any): string;
    normalizeTextContent(content: any): string;
}
export declare const resultParserService: ResultParserService;
//# sourceMappingURL=result-parser-service.d.ts.map