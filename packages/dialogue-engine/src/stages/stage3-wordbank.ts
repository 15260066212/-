import type { SessionData, DialogueMessage } from '@zemingengine/shared';
import type { StageHandler, Question, StageResult } from '../types.js';
import { required } from '../validators.js';

let messageCounter = 0;
function nextId(): string {
  return `msg_${Date.now()}_${++messageCounter}`;
}

function makeMessage(role: 'system' | 'user', content: string): DialogueMessage {
  return { id: nextId(), role, content, stage: 'wordbank', timestamp: new Date().toISOString() };
}

const questions: Question[] = [
  {
    id: 'prefixes',
    text: '词库会根据企业画像、产品属性和关键词自动生成。如需额外补充前缀，可在这里输入；否则回复“确认”。\n\n例如：最好的、推荐、免费、企业级、2026年...',
    geoContext: '前缀词帮助覆盖"最好的XX"、"推荐的XX"等高频 AI 搜索模式。',
    validator: required,
  },
  {
    id: 'suffixes',
    text: '如需额外补充后缀，可在这里输入；否则回复“确认”。\n\n例如：工具、平台、软件、方案、方法...',
    geoContext: '后缀词帮助覆盖"XX工具"、"XX平台"等变体搜索。',
    validator: required,
  },
];

export const wordbankStage: StageHandler = {
  stage: 'wordbank',
  questions,

  getIntroMessage(): string {
    return '词库已由系统根据企业画像、产品属性和关键词自动生成，包含品牌词、产品词、行业词、前缀和后缀。';
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
    const items = input.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
    const updated = { ...session, wordBank: { ...session.wordBank } };

    if (questionId === 'prefixes') {
      updated.wordBank.prefixes = items;
    } else {
      updated.wordBank.suffixes = items;
    }

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

    updated.currentStage = 'knowledge';
    return {
      messages: [
        userMsg,
        makeMessage('system', `词库已确认。前缀 ${updated.wordBank.prefixes.length} 个，后缀 ${updated.wordBank.suffixes.length} 个。\n\n接下来配置知识库。`),
      ],
      sessionData: updated,
      stageComplete: true,
      allComplete: false,
    };
  },

  isComplete(session: SessionData): boolean {
    return session.wordBank.prefixes.length > 0 && session.wordBank.suffixes.length > 0;
  },
};
