import type { SessionData, DialogueMessage } from '@zemingengine/shared';
import type { StageHandler, Question, StageResult } from '../types.js';
import { required } from '../validators.js';

let messageCounter = 0;
function nextId(): string {
  return `msg_${Date.now()}_${++messageCounter}`;
}

function makeMessage(role: 'system' | 'user', content: string): DialogueMessage {
  return { id: nextId(), role, content, stage: 'prompts', timestamp: new Date().toISOString() };
}

const questions: Question[] = [
  {
    id: 'chatgpt_prompt',
    text: '系统会根据企业画像和知识库自动生成 ChatGPT 内容提示词。如需补充一个重点场景，可以输入；否则回复“确认”。\n\n例如："推荐一款适合中小企业的CRM系统"',
    geoContext: 'ChatGPT 是目前最大的 AI 搜索入口。针对它的提示词能直接带来曝光。',
    validator: required,
  },
  {
    id: 'perplexity_prompt',
    text: '为 Perplexity 生成提示词：Perplexity 偏好更具体的、带数据的问题。\n\n例如："2026年CRM软件市场份额排名"',
    geoContext: 'Perplexity 是专业搜索引擎，偏好数据驱动的内容。针对性优化效果显著。',
    validator: required,
  },
];

export const promptsStage: StageHandler = {
  stage: 'prompts',
  questions,

  getIntroMessage(): string {
    return '提示词模板会根据企业画像、知识库和不同平台内容习惯自动生成。';
  },

  handleInput(session: SessionData, questionId: string, input: string): StageResult {
    const question = questions.find((q) => q.id === questionId);
    if (!question) {
      return {
        messages: [makeMessage('system', '未知问题，请重试')],
        sessionData: session,
        stageComplete: false,
        allComplete: false,
      };
    }

    if (question.validator) {
      const result = question.validator(input);
      if (!result.valid) {
        return {
          messages: [makeMessage('system', result.error ?? '输入无效，请重试')],
          sessionData: session,
          stageComplete: false,
          allComplete: false,
        };
      }
    }

    const userMsg = makeMessage('user', input);
    const platform = questionId === 'chatgpt_prompt' ? 'ChatGPT' : 'Perplexity';
    const updated = {
      ...session,
      prompts: [...session.prompts, { platform, prompt: input, scenario: '' }],
    };

    const currentIndex = questions.findIndex((q) => q.id === questionId);
    const nextQuestion = questions[currentIndex + 1];

    if (nextQuestion) {
      return {
        messages: [userMsg, makeMessage('system', nextQuestion.text)],
        sessionData: updated,
        stageComplete: false,
        allComplete: false,
      };
    }

    updated.currentStage = 'platforms';
    return {
      messages: [
        userMsg,
        makeMessage('system', '提示词模板生成完成！最后一步：制定平台策略。'),
      ],
      sessionData: updated,
      stageComplete: true,
      allComplete: false,
    };
  },

  isComplete(session: SessionData): boolean {
    return session.prompts.length >= 2;
  },
};
