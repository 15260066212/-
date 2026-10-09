import type { SessionData, DialogueMessage } from '@zemingengine/shared';
import type { StageHandler, Question, StageResult } from '../types.js';
import { required } from '../validators.js';

let messageCounter = 0;
function nextId(): string {
  return `msg_${Date.now()}_${++messageCounter}`;
}

function makeMessage(role: 'system' | 'user', content: string): DialogueMessage {
  return { id: nextId(), role, content, stage: 'platforms', timestamp: new Date().toISOString() };
}

const questions: Question[] = [
  {
    id: 'platform_strategy',
    text: '系统会根据企业调性、所属行业和目标人群画像推荐平台策略。如需指定重点平台，可以输入；否则回复“确认”。\n\n例如：官网博客、知乎、微信公众号...',
    geoContext: '不同平台的 AI 抓取频率不同。官网和知乎是目前被 AI 引用最多的平台。',
    validator: required,
  },
];

export const platformsStage: StageHandler = {
  stage: 'platforms',
  questions,

  getIntroMessage(): string {
    return '平台发布策略会根据企业调性、行业和人群画像自动生成，包含发布平台、顺序、时间、频率和内容方向。';
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
    const platforms = input.split(/[,，、；;\n]/).map((s) => s.trim()).filter(Boolean);
    const updated = {
      ...session,
      platforms: platforms.map((p, i) => ({
        platform: p,
        focus: i === 0 ? '优先' : '补充',
        adaptations: [],
      })),
    };

    return {
      messages: [
        userMsg,
        makeMessage('system', '所有阶段配置完成！正在生成你的 GEO 实操配置手册...'),
      ],
      sessionData: updated,
      stageComplete: true,
      allComplete: true,
    };
  },

  isComplete(session: SessionData): boolean {
    return session.platforms.length > 0;
  },
};
