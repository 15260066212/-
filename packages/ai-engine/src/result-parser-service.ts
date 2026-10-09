export class ResultParserService {
  parseAIResponse(aiResponse: any) {
    const responseText = this.extractResponseText(aiResponse);
    return { originalText: responseText, parsingStatus: 'completed' as const };
  }

  extractResponseText(aiResponse: any): string {
    if (typeof aiResponse === 'string') return aiResponse;

    const doubaoOutput = aiResponse?.output || aiResponse?.data?.output;
    if (Array.isArray(doubaoOutput)) {
      const messageItems = doubaoOutput.filter((item: any) => item?.type === 'message');
      for (const msg of messageItems) {
        if (Array.isArray(msg.content)) {
          const texts = msg.content
            .filter((c: any) => c?.type === 'output_text' && c?.text)
            .map((c: any) => c.text);
          if (texts.length > 0) return texts.join('\n');
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
    for (const candidate of candidates) {
      const text = this.normalizeTextContent(candidate);
      if (text) return text;
    }
    return '';
  }

  normalizeTextContent(content: any): string {
    if (typeof content === 'string') return content;
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
