import type { SessionData, DialogueMessage, PendingUpdate } from '@zemingengine/shared';
import type { StageHandler, Question, StageResult } from '../types.js';
import { required, minLength, combine } from '../validators.js';

let messageCounter = 0;
function nextId(): string {
  return `msg_${Date.now()}_${++messageCounter}`;
}

function makeMessage(role: 'system' | 'user', content: string): DialogueMessage {
  return { id: nextId(), role, content, stage: 'profile', timestamp: new Date().toISOString() };
}

const CONFIRM_KEYWORDS = /^(确认|继续|ok|yes|没问题|对|好的|确定|是)$/i;
const DENY_KEYWORDS = /^(否|不|no|跳过|不需要|不用)$/i;

function isQuestionDataFilled(questionId: string, session: SessionData): boolean {
  switch (questionId) {
    case 'fullName': return !!session.enterprise.fullName;
    case 'description': return !!session.enterprise.description;
    case 'scale': return !!session.enterprise.scale;
    case 'location': return !!session.enterprise.location;
    case 'products': return session.enterprise.products.length > 0;
    case 'brandStory': return !!session.enterprise.brandStory;
    case 'trustAnchors': return session.enterprise.trustAnchors.length > 0;
    default: return false;
  }
}

function isQuestionConfirmed(questionId: string, session: SessionData): boolean {
  return (session.confirmedProfileFields ?? []).includes(questionId) && isQuestionDataFilled(questionId, session);
}

function getNextQuestionAfter(questionId: string, session: SessionData): Question | undefined {
  const currentIndex = questions.findIndex((q) => q.id === questionId);
  return questions.slice(currentIndex + 1).find((q) => !isQuestionConfirmed(q.id, session));
}

function getQuestionDataValue(questionId: string, session: SessionData): string {
  switch (questionId) {
    case 'fullName':
      return session.enterprise.fullName + (session.enterprise.shortName ? `（${session.enterprise.shortName}）` : '');
    case 'description':
      return session.enterprise.description;
    case 'scale':
      return session.enterprise.scale;
    case 'location':
      return session.enterprise.location;
    case 'products':
      return session.enterprise.products.map(p => p.name).join('、');
    case 'brandStory':
      return session.enterprise.brandStory;
    case 'trustAnchors':
      return session.enterprise.trustAnchors.join('、');
    default:
      return '';
  }
}

function isConfirmCommand(input: string): boolean {
  return CONFIRM_KEYWORDS.test(input.trim());
}

function isDenyCommand(input: string): boolean {
  return DENY_KEYWORDS.test(input.trim());
}

/**
 * Format the question prompt for a field that already has data.
 */
function formatQuestionWithData(question: Question, currentValue: string): string {
  return `📋 当前已有数据：${currentValue}\n\n${question.text}\n\n（直接输入新内容修改，或回复"确认"保持不变。${question.geoContext}）`;
}

/**
 * Apply a pending update to the session data.
 */
function applyPendingUpdate(session: SessionData, pending: PendingUpdate): SessionData {
  const updated = { ...session, enterprise: { ...session.enterprise } };
  switch (pending.questionId) {
    case 'fullName': {
      const parts = pending.newValue.split(/[,，、]/).map((s) => s.trim());
      updated.enterprise.fullName = parts[0];
      if (parts.length > 1) updated.enterprise.shortName = parts[1];
      break;
    }
    case 'description':
      updated.enterprise.description = pending.newValue;
      break;
    case 'scale':
      updated.enterprise.scale = pending.newValue;
      break;
    case 'location':
      updated.enterprise.location = pending.newValue;
      break;
    case 'products':
      updated.enterprise.products = [{ name: pending.newValue, description: pending.newValue, category: '', isPrimary: true }];
      break;
    case 'brandStory':
      updated.enterprise.brandStory = pending.newValue;
      break;
    case 'trustAnchors':
      updated.enterprise.trustAnchors = pending.newValue.split(/[,，、；;]/).map((s) => s.trim()).filter(Boolean);
      break;
  }
  return updated;
}

/**
 * Get the label for a question ID.
 */
function getQuestionLabel(questionId: string): string {
  const labels: Record<string, string> = {
    fullName: '企业名称',
    description: '业务描述',
    scale: '公司规模',
    location: '所在地',
    products: '核心产品',
    brandStory: '品牌故事',
    trustAnchors: '信任背书',
  };
  return labels[questionId] || questionId;
}

/**
 * Build the message for the current question, showing existing data if available.
 */
function buildQuestionPrompt(question: Question, session: SessionData): string {
  if (isQuestionDataFilled(question.id, session)) {
    const currentValue = getQuestionDataValue(question.id, session);
    return formatQuestionWithData(question, currentValue);
  }
  return question.text;
}

const questions: Question[] = [
  {
    id: 'fullName',
    text: '你们的公司全称是什么？有没有常用简称？',
    geoContext: 'AI 搜索引擎需要准确的公司名称来匹配用户搜索。全称和简称都是重要的触发词。',
    validator: combine(required, minLength(2)),
  },
  {
    id: 'description',
    text: '用一句话描述你们公司是做什么的？（建议 20-50 字）',
    geoContext: '这段描述会成为 AI 引用你时的"一句话介绍"，越精准越好。',
    validator: combine(required, minLength(5)),
  },
  {
    id: 'scale',
    text: '你们的公司规模大概是？（如：50人、100-500人、1000+）',
    geoContext: '公司规模帮助 AI 判断你的企业体量，影响推荐场景。',
    validator: required,
  },
  {
    id: 'location',
    text: '你们的总部在哪里？有分支机构吗？',
    geoContext: '地域信息帮助 AI 在本地化搜索中推荐你。',
    validator: required,
  },
  {
    id: 'products',
    text: '你们有哪些核心产品/服务？哪个是最核心的？请简要描述。',
    geoContext: '产品信息是 AI 理解你业务范围的关键。核心产品应该排在第一位。',
    validator: combine(required, minLength(5)),
  },
  {
    id: 'brandStory',
    text: '能用 3-5 句话讲讲你们的品牌故事吗？（创立背景、使命、愿景）',
    geoContext: '品牌故事帮助 AI 在回答"XX公司怎么样"时给出有温度的回复。',
    validator: combine(required, minLength(10)),
  },
  {
    id: 'trustAnchors',
    text: '你们有哪些信任背书？（如：客户数量、行业奖项、知名客户、认证资质）',
    geoContext: '信任锚点是 AI 推荐你时的"证据"，如"服务过1000+企业"。',
    validator: required,
  },
];

export const profileStage: StageHandler = {
  stage: 'profile',
  questions,

  getIntroMessage(session: SessionData): string {
    if (session.enterprise.fullName) {
      const filled: string[] = [];
      if (session.enterprise.fullName) filled.push(`名称: ${session.enterprise.fullName}`);
      if (session.enterprise.description) filled.push(`描述: ${session.enterprise.description}`);
      if (session.enterprise.scale) filled.push(`规模: ${session.enterprise.scale}`);
      if (session.enterprise.location) filled.push(`所在地: ${session.enterprise.location}`);
      if (session.enterprise.products.length > 0) filled.push(`产品: ${session.enterprise.products.map(p => p.name).join('、')}`);

      // Always start from the first question so user can review each field
      const firstQuestion = questions[0];
      const firstCurrentValue = getQuestionDataValue(firstQuestion.id, session);

      if (filled.length >= 3) {
        return `AI 已从官网提取了以下信息：\n${filled.map(f => `  · ${f}`).join('\n')}\n\n接下来我们逐一确认每项信息。\n\n${formatQuestionWithData(firstQuestion, firstCurrentValue)}`;
      }
      return `已记录企业信息：${session.enterprise.fullName}\n\n接下来我们确认一下品牌画像的细节。\n\n${formatQuestionWithData(firstQuestion, firstCurrentValue)}`;
    }
    return `接下来我们来完善企业画像。这将帮助 AI 搜索引擎准确理解你的企业。\n\n${questions[0].text}`;
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

    const trimmed = input.trim();
    const userMsg = makeMessage('user', trimmed);
    let updated = { ...session, enterprise: { ...session.enterprise } };

    // --- Step 0: Handle pending update from previous round ---
    if (session.pendingUpdate) {
      const pending = session.pendingUpdate;
      updated.pendingUpdate = undefined; // clear pending

      if (isConfirmCommand(trimmed)) {
        // Apply the pending update
        updated = applyPendingUpdate(updated, pending);
        const label = getQuestionLabel(pending.questionId);
        // Now continue processing current question as normal
        const prompt = buildQuestionPrompt(question, updated);
        return {
          messages: [userMsg, makeMessage('system', `✅ 已修改${label}。`), makeMessage('system', prompt)],
          sessionData: updated,
          stageComplete: false,
          allComplete: false,
          nextQuestionId: questionId,
        };
      }

      if (isDenyCommand(trimmed)) {
        // Discard pending update, keep original
        const label = getQuestionLabel(pending.questionId);
        const prompt = buildQuestionPrompt(question, updated);
        return {
          messages: [userMsg, makeMessage('system', `已保留原${label}。`), makeMessage('system', prompt)],
          sessionData: updated,
          stageComplete: false,
          allComplete: false,
          nextQuestionId: questionId,
        };
      }

      // User said something else entirely — discard pending, treat as input for current question
      updated.pendingUpdate = undefined;
    }

    // --- Step 1: Handle "跳过" command ---
    if (trimmed === '跳过') {
      // Advance to next question
      const nextQ = getNextQuestionAfter(questionId, updated);
      if (!nextQ) {
        updated.currentStage = 'keywords';
        return {
          messages: [userMsg, makeMessage('system', '品牌画像已完善！接下来我们确定核心关键词。')],
          sessionData: updated,
          stageComplete: true,
          allComplete: false,
        };
      }
      return {
        messages: [userMsg, makeMessage('system', buildQuestionPrompt(nextQ, updated))],
        sessionData: updated,
        stageComplete: false,
        allComplete: false,
        nextQuestionId: nextQ.id,
      };
    }

    // --- Step 2: Handle modification commands (e.g., "名称改为XX公司", "简称 DataFocus") ---
    const modifyMatch = trimmed.match(/^(名称|全称|简称|描述|规模|所在地|产品|品牌故事|信任背书)(?:改为|是|为|：|:)?(.+)$/);
    if (modifyMatch) {
      const field = modifyMatch[1];
      const value = modifyMatch[2].trim();

      switch (field) {
        case '名称':
        case '全称':
          updated.enterprise.fullName = value;
          break;
        case '简称':
          updated.enterprise.shortName = value;
          break;
        case '描述':
          updated.enterprise.description = value;
          break;
        case '规模':
          updated.enterprise.scale = value;
          break;
        case '所在地':
          updated.enterprise.location = value;
          break;
        case '产品':
          updated.enterprise.products = [{ name: value, description: value, category: '', isPrimary: true }];
          break;
        case '品牌故事':
          updated.enterprise.brandStory = value;
          break;
        case '信任背书':
          updated.enterprise.trustAnchors = value.split(/[,，、；;]/).map((s) => s.trim()).filter(Boolean);
          break;
      }

      // After modification, show the updated question context
      const prompt = buildQuestionPrompt(question, updated);
      return {
        messages: [userMsg, makeMessage('system', `✅ 已更新${field}信息。`), makeMessage('system', prompt)],
        sessionData: updated,
        stageComplete: false,
        allComplete: false,
      };
    }

    // --- Step 3: Current field already has data ---
    const hasData = isQuestionDataFilled(questionId, session);
    const currentValue = getQuestionDataValue(questionId, session);

    if (hasData) {
      // 3a: Confirm → keep existing, advance
      if (isConfirmCommand(trimmed)) {
        updated.confirmedProfileFields = Array.from(new Set([...updated.confirmedProfileFields, questionId]));
        const nextQ = getNextQuestionAfter(questionId, updated);
        if (!nextQ) {
          updated.currentStage = 'keywords';
          return {
            messages: [userMsg, makeMessage('system', '品牌画像已完善！接下来我们确定核心关键词。')],
            sessionData: updated,
            stageComplete: true,
            allComplete: false,
          };
        }
        return {
          messages: [userMsg, makeMessage('system', buildQuestionPrompt(nextQ, updated))],
          sessionData: updated,
          stageComplete: false,
          allComplete: false,
          nextQuestionId: nextQ.id,
        };
      }

      // 3b: Deny → also keep existing, advance
      if (isDenyCommand(trimmed)) {
        const nextQ = getNextQuestionAfter(questionId, updated);
        if (!nextQ) {
          updated.currentStage = 'keywords';
          return {
            messages: [userMsg, makeMessage('system', '品牌画像已完善！接下来我们确定核心关键词。')],
            sessionData: updated,
            stageComplete: true,
            allComplete: false,
          };
        }
        return {
          messages: [userMsg, makeMessage('system', buildQuestionPrompt(nextQ, updated))],
          sessionData: updated,
          stageComplete: false,
          allComplete: false,
          nextQuestionId: nextQ.id,
        };
      }

      // 3c: Same value as current → just advance
      if (trimmed === currentValue.trim()) {
        updated.confirmedProfileFields = Array.from(new Set([...updated.confirmedProfileFields, questionId]));
        const nextQ = getNextQuestionAfter(questionId, updated);
        if (!nextQ) {
          updated.currentStage = 'keywords';
          return {
            messages: [userMsg, makeMessage('system', '品牌画像已完善！接下来我们确定核心关键词。')],
            sessionData: updated,
            stageComplete: true,
            allComplete: false,
          };
        }
        return {
          messages: [userMsg, makeMessage('system', buildQuestionPrompt(nextQ, updated))],
          sessionData: updated,
          stageComplete: false,
          allComplete: false,
          nextQuestionId: nextQ.id,
        };
      }

      // 3d: Different value → validate, then ask for confirmation
      if (question.validator) {
        const result = question.validator(trimmed);
        if (!result.valid) {
          return {
            messages: [makeMessage('system', result.error ?? '输入无效，请重试')],
            sessionData: session,
            stageComplete: false,
            allComplete: false,
          };
        }
      }

      // Store as pending update, ask for confirmation
      updated.pendingUpdate = { questionId, newValue: trimmed };
      return {
        messages: [
          userMsg,
          makeMessage('system', `📋 当前已有数据：${currentValue}\n✏️ 您的新输入：${trimmed}\n\n是否确认修改？回复"是"确认修改，回复"否"保持原值。`),
        ],
        sessionData: updated,
        stageComplete: false,
        allComplete: false,
        preserveQuestion: true,
      };
    }

    // --- Step 4: Field has no data → validate and store ---
    if (question.validator) {
      const result = question.validator(trimmed);
      if (!result.valid) {
        return {
          messages: [makeMessage('system', result.error ?? '输入无效，请重试')],
          sessionData: session,
          stageComplete: false,
          allComplete: false,
        };
      }
    }

    // Store the data
    switch (questionId) {
      case 'fullName': {
        const parts = trimmed.split(/[,，、]/).map((s) => s.trim());
        updated.enterprise.fullName = parts[0];
        if (parts.length > 1) updated.enterprise.shortName = parts[1];
        break;
      }
      case 'description':
        updated.enterprise.description = trimmed;
        break;
      case 'scale':
        updated.enterprise.scale = trimmed;
        break;
      case 'location':
        updated.enterprise.location = trimmed;
        break;
      case 'products':
        updated.enterprise.products = [{ name: trimmed, description: trimmed, category: '', isPrimary: true }];
        break;
      case 'brandStory':
        updated.enterprise.brandStory = trimmed;
        break;
      case 'trustAnchors':
        updated.enterprise.trustAnchors = trimmed.split(/[,，、；;]/).map((s) => s.trim()).filter(Boolean);
        break;
    }

    // Advance to next question
    const nextQ = getNextQuestionAfter(questionId, updated);
    if (!nextQ) {
      updated.currentStage = 'keywords';
      return {
        messages: [userMsg, makeMessage('system', '品牌画像已完善！接下来我们确定核心关键词。')],
        sessionData: updated,
        stageComplete: true,
        allComplete: false,
      };
    }

    return {
      messages: [userMsg, makeMessage('system', buildQuestionPrompt(nextQ, updated))],
      sessionData: updated,
      stageComplete: false,
      allComplete: false,
      nextQuestionId: nextQ.id,
    };
  },

  isComplete(session: SessionData): boolean {
    return !!session.enterprise.fullName && !!session.enterprise.description;
  },
};
