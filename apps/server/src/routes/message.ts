import { Hono } from 'hono';
import { isAIAvailable, validateInput, generateGuidance } from '@zemingengine/ai-engine';
import type { DialogueMessage, ProfileReviewRequest, SessionData } from '@zemingengine/shared';
import { rebuildKnowledgeBase } from '@zemingengine/dialogue-engine';
import { getSession, updateSession } from '../session-store.js';
import type { DatabaseAccess } from '../db.js';

export function createMessageRoutes(db: DatabaseAccess): Hono {
  const messageRoutes = new Hono();

const PROFILE_FIELD_IDS = ['fullName', 'description', 'scale', 'location', 'products', 'brandStory', 'trustAnchors'] as const;

function splitList(input?: string): string[] {
  if (!input) return [];
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
  const productsText = body.productsText ?? '';
  const trustAnchorsText = body.trustAnchorsText ?? '';
  const brandToneText = body.brandToneText;
  const userPainPointsText = body.userPainPointsText;
  const fullName = (body.fullName ?? '').trim();
  const shortName = (body.shortName ?? '').trim();
  const description = (body.description ?? '').trim();
  const scale = (body.scale ?? '').trim();
  const location = (body.location ?? '').trim();
  const website = (body.website ?? '').trim();
  const foundedYear = (body.foundedYear ?? '').trim();
  const phone = (body.phone ?? '').trim();
  const email = (body.email ?? '').trim();
  const address = (body.address ?? '').trim();
  const brandStory = (body.brandStory ?? '').trim();
  const servicesText = body.servicesText ?? '';
  const targetCustomersText = body.targetCustomersText ?? '';
  const serviceRegion = (body.serviceRegion ?? '').trim();
  const enterpriseIntro = (body.enterpriseIntro ?? '').trim();
  const teamStrength = (body.teamStrength ?? '').trim();
  const serviceAdvantages = (body.serviceAdvantages ?? '').trim();
  const businessPhilosophy = (body.businessPhilosophy ?? '').trim();
  const caseEntryStandard = (body.caseEntryStandard ?? '').trim();
  const productDetails = (body.productDetails ?? [])
    .filter((item) => item && item.name?.trim())
    .map((item) => ({
      name: item.name.trim(),
      alias: item.alias?.trim() || undefined,
      spec: item.spec?.trim() || undefined,
      price: item.price?.trim() || undefined,
      advantages: item.advantages?.trim() || undefined,
      scenarios: item.scenarios?.trim() || undefined,
    }));

  const products = splitList(productsText).map((item, index) => {
    // 按第一个冒号拆分 name / description，兼容 "产品名：产品描述" 格式
    const sep = item.indexOf('：') !== -1 ? '：' : ':';
    const sepIdx = item.indexOf(sep);
    const name = sepIdx > 0 ? item.slice(0, sepIdx).trim() : item.trim();
    const desc = sepIdx > 0 ? item.slice(sepIdx + 1).trim() : '';
    return { name, description: desc, category: '', isPrimary: index === 0 };
  });

  const updated: SessionData = {
    ...entry.engine.getSession(),
    currentStage: 'profile',
    pendingUpdate: undefined,
    enterprise: {
      ...entry.engine.getSession().enterprise,
      fullName,
      shortName,
      description,
      scale,
      location,
      website,
      foundedYear: foundedYear || entry.engine.getSession().enterprise.foundedYear,
      phone: phone || '',
      email: email || '',
      address: address || '',
      products,
      brandStory,
      trustAnchors: splitList(trustAnchorsText),
      brandTone: brandToneText ? splitList(brandToneText) : entry.engine.getSession().enterprise.brandTone,
      userPainPoints: userPainPointsText ? splitList(userPainPointsText) : entry.engine.getSession().enterprise.userPainPoints,
      enterpriseIntro: body.enterpriseIntro !== undefined ? enterpriseIntro : entry.engine.getSession().enterprise.enterpriseIntro,
      teamStrength: body.teamStrength !== undefined ? teamStrength : entry.engine.getSession().enterprise.teamStrength,
      serviceAdvantages: body.serviceAdvantages !== undefined ? serviceAdvantages : entry.engine.getSession().enterprise.serviceAdvantages,
      businessPhilosophy: body.businessPhilosophy !== undefined ? businessPhilosophy : entry.engine.getSession().enterprise.businessPhilosophy,
      caseStudies: body.caseStudiesText !== undefined ? splitList(body.caseStudiesText) : entry.engine.getSession().enterprise.caseStudies,
      caseEntryStandard: body.caseEntryStandard !== undefined ? caseEntryStandard : entry.engine.getSession().enterprise.caseEntryStandard,
      caseIndustries: body.caseIndustriesText !== undefined ? splitList(body.caseIndustriesText) : entry.engine.getSession().enterprise.caseIndustries,
      productDetails: body.productDetails !== undefined ? productDetails : entry.engine.getSession().enterprise.productDetails,
      avoidKeywords: body.avoidKeywordsText !== undefined ? splitList(body.avoidKeywordsText) : entry.engine.getSession().enterprise.avoidKeywords,
      services: body.servicesText !== undefined ? splitList(servicesText) : entry.engine.getSession().enterprise.services,
      targetCustomers: body.targetCustomersText !== undefined ? splitList(targetCustomersText) : entry.engine.getSession().enterprise.targetCustomers,
      serviceRegion: body.serviceRegion !== undefined ? serviceRegion : entry.engine.getSession().enterprise.serviceRegion,
    },
  };

  updated.confirmedProfileFields = getConfirmedProfileFields(updated);

  // 画像保存后立即编译三层知识库：L1 原料快照 / L2 可引用信源 / L3 AI 名片。
  // 即使尚未提供资料清单，也会用默认必需文档编译出基础信源，实现「保存即入库」。
  // materials 沿用已确认的文档标题列表——用户的资料选择不丢失，只刷新条目内部内容。
  const existingMaterials = entry.engine.getSession().knowledgeBase.documents.map((d) => d.title);
  Object.assign(updated, rebuildKnowledgeBase(updated, existingMaterials));

  // 同步 Milvus —— L2 信源 + L3 AI 名片写入向量存储
  if (db.milvus?.isEnabled()) {
    try {
      await db.milvus.connect();
      await db.milvus.ensureCollection();

      const enterpriseId = updated.enterprise.shortName || updated.enterprise.fullName || id;
      const ent = updated.enterprise;

      // 批量 embed L2 + L3 的 keyFacts 拼接文本
      const sourceRows: Array<{ id: string; layer: number; type: string; title: string; keyfacts: string; usageCount: number; metadata: object }> = [];
      for (const s of updated.knowledgeBase.sources ?? []) {
        if (!s.enabled) continue;
        const keyfacts = [s.title, ...(s.keyFacts ?? [])].join('\n');
        sourceRows.push({
          id: s.id,
          layer: 2,
          type: s.type,
          title: s.title,
          keyfacts,
          usageCount: s.usageCount,
          metadata: { tags: s.tags ?? [] },
        });
      }
      // L3 AI 名片也写一份（不参与候选池过滤，但让向量里有企业自我介绍）
      if (updated.knowledgeBase.card) {
        const cardSource = updated.knowledgeBase.card.source;
        const keyfacts = [cardSource.title, ...(cardSource.keyFacts ?? [])].join('\n');
        sourceRows.push({
          id: cardSource.id,
          layer: 3,
          type: cardSource.type,
          title: cardSource.title,
          keyfacts,
          usageCount: cardSource.usageCount,
          metadata: { tags: cardSource.tags ?? [] },
        });
      }

      if (sourceRows.length > 0) {
        const embeddings = await db.milvus.embedding.embedTexts(
          sourceRows.map((r) => r.keyfacts),
        );
        const inserted = await db.milvus.upsertSources(
          sourceRows.map((r, i) => ({
            source_id: r.id,
            session_id: id,
            enterprise_id: enterpriseId,
            layer: r.layer,
            type: r.type,
            title: r.title,
            keyfacts_text: r.keyfacts,
            usage_count: r.usageCount,
            metadata_json: JSON.stringify(r.metadata),
            vector: embeddings[i],
          })),
        );
        console.log(`[profile-review] Milvus 写入 ${inserted} 条（${sourceRows.filter(r => r.layer === 2).length} L2 + ${sourceRows.filter(r => r.layer === 3).length} L3）`);
      }
    } catch (e) {
      console.warn('[profile-review] Milvus 同步失败，不阻断主流程:', e instanceof Error ? e.message : e);
    }
  }

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
    } catch (err) {
      console.warn('[Message] AI validation failed, continuing with basic validation', { error: err instanceof Error ? err.message : String(err) });
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
    } catch (err) {
      console.warn('[Message] AI guidance generation failed, continuing without it', { error: err instanceof Error ? err.message : String(err) });
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
