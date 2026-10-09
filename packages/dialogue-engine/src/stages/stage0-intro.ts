import type { SessionData, DialogueMessage } from '@zemingengine/shared';
import type { StageHandler, StageResult } from '../types.js';
import { isUrl } from '../validators.js';

let messageCounter = 0;
function nextId(): string {
  return `msg_${Date.now()}_${++messageCounter}`;
}

function makeMessage(role: 'system' | 'user', content: string, stage: 'intro'): DialogueMessage {
  return { id: nextId(), role, content, stage, timestamp: new Date().toISOString() };
}

export const introStage: StageHandler = {
  stage: 'intro',

  questions: [
    {
      id: 'welcome',
      text: '你好！我是 芯图引擎：GEO 实操配置教练。我会通过企业画像、关键词、知识库等核心对话，帮你生成词库、内容提示词和平台发布策略。\n\n请提供你的企业官网 URL，我会自动抓取并分析；或者输入"手动"从零开始配置。',
      geoContext: 'GEO 是让 AI 搜索引擎（如 ChatGPT、Perplexity）更好地理解和推荐你的品牌的方法。',
      validator: (_input, session) => {
        // If website already scraped, accept any input to proceed
        if (session?.enterprise.website) return { valid: true };
        if (_input === '手动') return { valid: true };
        return isUrl(_input);
      },
    },
  ],

  getIntroMessage(session: SessionData): string {
    if (session.enterprise.website) {
      return `已获取官网信息：${session.enterprise.website}\n\n接下来我们开始完善企业画像。如有需要修改的信息，请随时告诉我。`;
    }
    return this.questions[0].text;
  },

  handleInput(session: SessionData, questionId: string, input: string): StageResult {
    const question = this.questions.find((q) => q.id === questionId);
    if (!question) {
      return {
        messages: [makeMessage('system', '未知问题，请重试', 'intro')],
        sessionData: session,
        stageComplete: false,
        allComplete: false,
      };
    }

    // Handle modification commands even in intro stage
    const modifyMatch = input.match(/^(名称|全称|简称|描述|规模|所在地|产品|品牌故事|信任背书)(?:改为|是|为|：|:)?(.+)$/);
    if (modifyMatch && session.enterprise.website) {
      const field = modifyMatch[1];
      const value = modifyMatch[2].trim();
      const updatedSession = { ...session, enterprise: { ...session.enterprise } };

      switch (field) {
        case '名称':
        case '全称':
          updatedSession.enterprise.fullName = value;
          break;
        case '简称':
          updatedSession.enterprise.shortName = value;
          break;
        case '描述':
          updatedSession.enterprise.description = value;
          break;
        case '规模':
          updatedSession.enterprise.scale = value;
          break;
        case '所在地':
          updatedSession.enterprise.location = value;
          break;
        case '产品':
          updatedSession.enterprise.products = [{ name: value, description: value, category: '', isPrimary: true }];
          break;
        case '品牌故事':
          updatedSession.enterprise.brandStory = value;
          break;
        case '信任背书':
          updatedSession.enterprise.trustAnchors = value.split(/[,，、；;]/).map((s) => s.trim()).filter(Boolean);
          break;
      }

      return {
        messages: [makeMessage('system', `已更新${field}信息。接下来我们继续完善企业画像。`, 'intro')],
        sessionData: updatedSession,
        stageComplete: false,
        allComplete: false,
      };
    }

    // Validate
    if (question.validator) {
      const result = question.validator(input, session);
      if (!result.valid) {
        return {
          messages: [makeMessage('system', result.error ?? '输入无效，请重试', 'intro')],
          sessionData: session,
          stageComplete: false,
          allComplete: false,
        };
      }
    }

    const userMsg = makeMessage('user', input, 'intro');
    const updatedSession = { ...session };

    // If website already scraped (from submitUrl flow), just proceed
    if (session.enterprise.website) {
      updatedSession.currentStage = 'profile';
      return {
        messages: [
          userMsg,
          makeMessage('system', '好的，接下来我们完善企业画像。如有需要修改的信息，请随时告诉我。', 'intro'),
        ],
        sessionData: updatedSession,
        stageComplete: true,
        allComplete: false,
      };
    }

    if (input === '手动') {
      updatedSession.currentStage = 'profile';
      return {
        messages: [
          userMsg,
          makeMessage('system', '好的，我们从手动模式开始。接下来完善企业画像。', 'intro'),
        ],
        sessionData: updatedSession,
        stageComplete: true,
        allComplete: false,
      };
    }

    // URL provided
    updatedSession.enterprise.website = input;
    updatedSession.currentStage = 'profile';
    return {
      messages: [
        userMsg,
        makeMessage('system', `已记录官网：${input}\n我将尝试抓取网站信息，接下来请确认或补充企业画像。`, 'intro'),
      ],
      sessionData: updatedSession,
      stageComplete: true,
      allComplete: false,
    };
  },

  isComplete(session: SessionData): boolean {
    return session.currentStage !== 'intro';
  },
};
