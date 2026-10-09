export type ModelProvider = 'openai' | 'deepseek' | 'doubao' | 'ernie';
export interface ProviderConfig {
    provider: ModelProvider;
    apiKey: string;
    baseUrl: string;
    model: string;
}
export declare function isAIAvailable(): boolean;
export declare function getActiveModel(): string;
export declare function getActiveProvider(): ModelProvider;
export interface ChatCompletionOptions {
    temperature?: number;
    maxTokens?: number;
}
/**
 * Unified chat completion function supporting multiple AI providers.
 * Uses OpenAI-compatible Chat Completions API for all providers.
 * For OpenAI, also tries the Responses API first (supports gpt-5.x models).
 */
export declare function chatCompletion(systemPrompt: string, userMessage: string, options?: ChatCompletionOptions): Promise<string>;
//# sourceMappingURL=client.d.ts.map