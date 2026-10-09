import type { SessionData, DialogueMessage, Stage } from '@zemingengine/shared';
import { STAGES } from '@zemingengine/shared';
import type { StageResult } from './types.js';
import { getStageHandler, stageHandlers } from './stages/index.js';

let messageCounter = 0;
function nextId(): string {
  return `msg_${Date.now()}_${++messageCounter}`;
}

export class DialogueEngine {
  private session: SessionData;
  private currentQuestionId: string | null = null;

  constructor(session: SessionData) {
    this.session = session;
    this.initQuestionId();
  }

  private initQuestionId(): void {
    const handler = getStageHandler(this.session.currentStage);
    if (handler && handler.questions.length > 0) {
      this.currentQuestionId = handler.questions[0].id;
    }
  }

  getSession(): SessionData {
    return { ...this.session };
  }

  setSession(session: SessionData): void {
    this.session = session;
  }

  getCurrentStage(): Stage {
    return this.session.currentStage;
  }

  getCurrentQuestionId(): string | null {
    return this.currentQuestionId;
  }

  setCurrentQuestionId(questionId: string | null): void {
    this.currentQuestionId = questionId;
  }

  getProgress(): { current: number; total: number } {
    const currentIndex = STAGES.findIndex((stage) => stage === this.session.currentStage);
    return { current: currentIndex, total: STAGES.length };
  }

  getIntroMessage(): DialogueMessage {
    const handler = getStageHandler(this.session.currentStage);
    const content = handler
      ? handler.getIntroMessage(this.session)
      : '欢迎使用 芯图引擎：GEO 配置教练！';
    return {
      id: nextId(),
      role: 'system',
      content,
      stage: this.session.currentStage,
      timestamp: new Date().toISOString(),
    };
  }

  async handleUserInput(input: string): Promise<{ messages: DialogueMessage[]; isComplete: boolean }> {
    const handler = getStageHandler(this.session.currentStage);
    if (!handler) {
      return {
        messages: [
          {
            id: nextId(),
            role: 'system',
            content: '当前阶段配置有误，请重试。',
            stage: this.session.currentStage,
            timestamp: new Date().toISOString(),
          },
        ],
        isComplete: false,
      };
    }

    const questionId = this.currentQuestionId ?? handler.questions[0].id;
    const result: StageResult = await handler.handleInput(this.session, questionId, input);

    // Update session
    this.session = result.sessionData;

    // Update question pointer
    if (result.stageComplete) {
      // Move to next stage's first question
      const nextHandler = getStageHandler(this.session.currentStage);
      this.currentQuestionId = nextHandler?.questions[0]?.id ?? null;
    } else if (result.preserveQuestion) {
      // Keep the same question (e.g., pending update awaiting confirmation)
      this.currentQuestionId = questionId;
    } else if (result.nextQuestionId !== undefined) {
      this.currentQuestionId = result.nextQuestionId;
    } else if (!result.messages.some((message) => message.role === 'user')) {
      // Validation and retry messages should keep the same question active.
      this.currentQuestionId = questionId;
    } else {
      // Move to next question in current stage
      const currentIndex = handler.questions.findIndex((q) => q.id === questionId);
      const nextQ = handler.questions[currentIndex + 1];
      this.currentQuestionId = nextQ?.id ?? null;
    }

    return {
      messages: result.messages,
      isComplete: result.allComplete,
    };
  }

  getStageHandlers() {
    return stageHandlers;
  }
}
