import type { SessionData, Stage, DialogueMessage } from '@zemingengine/shared';

export interface Question {
  id: string;
  text: string;
  geoContext?: string;
  validator?: (input: string, session?: SessionData) => ValidationResult;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export interface StageResult {
  messages: DialogueMessage[];
  sessionData: SessionData;
  stageComplete: boolean;
  allComplete: boolean;
  nextQuestionId?: string | null;
  /** When true, the engine keeps the current questionId unchanged (e.g., pending confirmation). */
  preserveQuestion?: boolean;
}

export interface StageHandler {
  stage: Stage;
  questions: Question[];
  getIntroMessage(session: SessionData): string;
  handleInput(session: SessionData, questionId: string, input: string): Promise<StageResult> | StageResult;
  isComplete(session: SessionData): boolean;
}
