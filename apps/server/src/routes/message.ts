import { Hono } from 'hono';
import { isAIAvailable, validateInput, generateGuidance } from '@zemingengine/ai-engine';
import type { DialogueMessage, ProfileReviewRequest, SessionData } from '@zemingengine/shared';
import { getSession, updateSession } from '../session-store.js';
import type { DatabaseAccess } from '../db.js';

export function createMessageRoutes(db: DatabaseAccess): Hono {
  const messageRoutes = new Hono();

const PROFILE_FIELD_IDS = ['fullName', 'description', 'scale', 'location', 'products', 'brandStory', 'trustAnchors'] as const;

function splitList(input: string): string[] {
  return input.split(/[,，、；;\n]/).map((item) => item.trim()).filter(Boolean);
}

function getConfirmedProfileFields(session: SessionData): string[] {
  const confirmed: string[] = [];
  if (session.enterprise.fullName) confirmed.push('fullName');
  if (session.enterprise.description) confirmed.push('description');
  if (session.enterprise.scale) confirmed.push('scale');
  if (session.enterprise.location) confirmed.push('location');
  if (session.enterprise.products.length > 0) confirmed.push('products');
  if (session.enterprise.brandStory) confirmed.push('brandStory');
  if (session.enterprise.trustAnchors.length > 0) confirmed.push('trustAnchors');
  return confirmed;
}

function getFirstMissingProfileField(session: SessionData): string | null {
  const confirmed = new Set(session.confirmedProfileFields ?? []);
  for (const field of PROFILE_FIELD_IDS) {
    if (!confirmed.has(field)) return field;
  }
  return null;
}

function makeSystemMessage(content: string, stage: SessionData['currentStage']): DialogueMessage {
  return {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    role: 'system',
    content,
    stage,
    timestamp: new Date().toISOString(),
  };
}

// POST /api/session/:id/profile-review - Confirm scraped profile data and continue missing fields
messageRoutes.post('/:id/profile-review', async (c) => {
  const id = c.req.param('id');
  const entry = getSession(id, db);
  if (!entry) {
    return c.json({ success: false, error: 'Session not found' }, 404);
  }

  const body = await c.req.json<ProfileReviewRequest>();
  const products = splitList(body.productsText).map((item, index) => ({
    name: item,
    description: item,
    category: '',
    isPrimary: index === 0,
  }));

  const updated: SessionData = {
    ...entry.engine.getSession(),
    currentStage: 'profile',
    pendingUpdate: undefined,
    enterprise: {
      ...entry.engine.getSession().enterprise,
      fullName: body.fullName.trim(),
      shortName: body.shortName.trim(),
      description: body.description.trim(),
      scale: body.scale.trim(),
      location: body.location.trim(),
      website: body.website.trim(),
      foundedYear: body.foundedYear?.trim() || entry.engine.getSession().enterprise.foundedYear,
      phone: body.phone?.trim() || '',
      email: body.email?.trim() || '',
      address: body.address?.trim() || '',
      products,
      brandStory: body.brandStory.trim(),
      trustAnchors: splitList(body.trustAnchorsText),
      brandTone: body.brandToneText ? splitList(body.brandToneText) : entry.engine.getSession().enterprise.brandTone,
      userPainPoints: body.userPainPointsText ? splitList(body.userPainPointsText) : entry.engine.getSession().enterprise.userPainPoints,
    },
  };

  updated.confirmedProfileFields = getConfirmedProfileFields(updated);

  const missingField = getFirstMissingProfileField(updated);
  const handler = entry.engine.getStageHandlers().find((stageHandler) => stageHandler.stage === 'profile');
  const missingQuestion = handler?.questions.find((question) => question.id === missingField);

  let message: DialogueMessage;
  let isComplete = false;
  if (missingField && missingQuestion) {
    entry.engine.setCurrentQuestionId(missingField);
    message = makeSystemMessage(`已确认官网获取到的企业画像信息。\n\n接下来只补充缺失项：${missingQuestion.text}`, 'profile');
  } else {
    updated.currentStage = 'keywords';
    entry.engine.setCurrentQuestionId('core_keyword');
    message = makeSystemMessage('企业画像已确认完整。接下来我们确定核心关键词。', 'keywords');
  }

  entry.engine.setSession(updated);
  updateSession(id, updated, db);

  return c.json({
    success: true,
    data: {
      messages: [message],
      sessionData: updated,
      isComplete,
      progress: entry.engine.getProgress(),
    },
  });
});

// POST /api/session/:id/message - Send message to dialogue engine
messageRoutes.post('/:id/message', async (c) => {
  const id = c.req.param('id');
  const entry = getSession(id, db);
  if (!entry) {
    return c.json({ success: false, error: 'Session not found' }, 404);
  }

  const body = await c.req.json<{ text: string }>();
  if (!body.text?.trim()) {
    return c.json({ success: false, error: 'Message text is required' }, 400);
  }

  const inputText = body.text.trim();
  const currentStage = entry.data.currentStage;
  const engine = entry.engine;

  // Get current question for AI validation
  const questionId = engine.getCurrentQuestionId();
  let questionText = '';

  // Try to get question text from stage handler
  const handler = engine.getStageHandlers().find(h => h.stage === currentStage);
  const question = handler?.questions.find(q => q.id === questionId);
  questionText = question?.text || '';

  // AI validation (if available) - skip for confirm/continue input when data exists
  const isConfirm = /^(确认|继续|ok|yes|没问题|对)$/i.test(inputText);
  const hasWebsite = engine.getSession().enterprise.website;
  const isModifyCommand = /^(名称|全称|简称|描述|规模|所在地|产品|品牌故事|信任背书)(?:改为|是|为|：|:)?.+$/i.test(inputText);
  const isSkipCommand = inputText === '跳过';

  if (isAIAvailable() && questionId && !(isConfirm && hasWebsite) && !isModifyCommand && !isSkipCommand) {
    try {
      const validation = await validateInput(questionId, questionText, inputText, engine.getSession());
      if (!validation.valid) {
        // Return AI feedback without advancing state
        const feedbackMessage = {
          id: `msg_${Date.now()}_feedback`,
          role: 'system' as const,
          content: validation.feedback + (validation.suggestion ? `\n\n💡 建议：${validation.suggestion}` : ''),
          stage: currentStage,
          timestamp: new Date().toISOString(),
        };
        return c.json({
          success: true,
          data: {
            messages: [feedbackMessage],
            sessionData: engine.getSession(),
            isComplete: false,
            progress: engine.getProgress(),
          },
        });
      }
    } catch {
      // AI validation failed, continue with basic validation
    }
  }

  // Process input through dialogue engine
  const result = await engine.handleUserInput(inputText);
  const updatedSession = engine.getSession();
  updateSession(id, updatedSession, db);

  // Generate AI guidance for next question (if available and not complete)
  let guidanceMessage = null;
  if (isAIAvailable() && !result.isComplete && updatedSession.currentStage !== 'profile') {
    try {
      const guidance = await generateGuidance(updatedSession.currentStage, updatedSession);
      if (guidance) {
        guidanceMessage = {
          id: `msg_${Date.now()}_guidance`,
          role: 'system' as const,
          content: guidance,
          stage: updatedSession.currentStage,
          timestamp: new Date().toISOString(),
        };
      }
    } catch {
      // AI guidance failed, continue without it
    }
  }

  const messages = [...result.messages];
  if (guidanceMessage) {
    messages.push(guidanceMessage);
  }

  return c.json({
    success: true,
    data: {
      messages,
      sessionData: updatedSession,
      isComplete: result.isComplete,
      progress: engine.getProgress(),
    },
  });
});

// POST /api/session/:id/back - Go back to previous question
messageRoutes.post('/:id/back', (c) => {
  const id = c.req.param('id');
  const entry = getSession(id, db);
  if (!entry) {
    return c.json({ success: false, error: 'Session not found' }, 404);
  }

  // Simple back: just re-send the intro message for current stage
  const introMessage = entry.engine.getIntroMessage();
  return c.json({
    success: true,
    data: {
      message: introMessage,
      sessionData: entry.engine.getSession(),
    },
  });
});

  return messageRoutes;
}
