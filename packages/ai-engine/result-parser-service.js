export class ResultParserService {
    parseAIResponse(aiResponse) {
        const responseText = this.extractResponseText(aiResponse);
        return { originalText: responseText, parsingStatus: 'completed' };
    }
    extractResponseText(aiResponse) {
        if (typeof aiResponse === 'string')
            return aiResponse;
        const doubaoOutput = aiResponse?.output || aiResponse?.data?.output;
        if (Array.isArray(doubaoOutput)) {
            const messageItems = doubaoOutput.filter((item) => item?.type === 'message');
            for (const msg of messageItems) {
                if (Array.isArray(msg.content)) {
                    const texts = msg.content
                        .filter((c) => c?.type === 'output_text' && c?.text)
                        .map((c) => c.text);
                    if (texts.length > 0)
                        return texts.join('\n');
                }
            }
        }
        const candidates = [
            aiResponse?.choices?.[0]?.message?.content,
            aiResponse?.data?.choices?.[0]?.message?.content,
            aiResponse?.choices?.[0]?.text,
            aiResponse?.data?.choices?.[0]?.text,
            aiResponse?.output,
            aiResponse?.data?.output,
            aiResponse?.output_text,
            aiResponse?.data?.output_text,
            aiResponse?.text,
            aiResponse?.data?.text,
            aiResponse?.answer,
            aiResponse?.data?.answer,
            aiResponse?.result,
            aiResponse?.data?.result,
            aiResponse?.response,
            aiResponse?.data?.response,
        ];
        const hasKnownTextShape = candidates.some((c) => c !== undefined);
        for (const candidate of candidates) {
            const text = this.normalizeTextContent(candidate);
            if (text)
                return text;
        }
        if (hasKnownTextShape)
            return '';
        return '';
    }
    normalizeTextContent(content) {
        if (typeof content === 'string')
            return content;
        if (Array.isArray(content)) {
            return content.map((item) => this.normalizeTextContent(item)).filter(Boolean).join('\n');
        }
        if (content && typeof content === 'object') {
            return this.normalizeTextContent(content.text || content.content || content.output_text || content.answer || content.result || content.response);
        }
        return '';
    }
}
export const resultParserService = new ResultParserService();
//# sourceMappingURL=result-parser-service.js.map