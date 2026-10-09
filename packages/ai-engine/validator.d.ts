import type { SessionData } from '@zemingengine/shared';
interface ValidationResult {
    valid: boolean;
    feedback: string;
    suggestion?: string;
}
export declare function validateInput(questionId: string, questionText: string, userInput: string, session: SessionData): Promise<ValidationResult>;
export {};
//# sourceMappingURL=validator.d.ts.map