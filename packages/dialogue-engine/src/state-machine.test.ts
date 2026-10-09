import { describe, expect, it } from 'vitest';
import { createEmptySession } from '@zemingengine/shared';
import { DialogueEngine } from './state-machine.js';
import { knowledgeStage } from './stages/stage4-knowledge.js';

describe('DialogueEngine question pointer', () => {
  it('keeps the current question active after confirming a pending profile update', async () => {
    const session = createEmptySession('test_session');
    session.currentStage = 'profile';
    session.enterprise.fullName = 'Old Name';
    session.enterprise.description = 'Old description';

    const engine = new DialogueEngine(session);

    // User enters a new value → pendingUpdate created, question stays at fullName
    await engine.handleUserInput('New Name');
    expect(engine.getCurrentQuestionId()).toBe('fullName');
    expect(engine.getSession().pendingUpdate).toEqual({
      questionId: 'fullName',
      newValue: 'New Name',
    });

    // User confirms → pendingUpdate applied, question stays at fullName (shows updated data)
    await engine.handleUserInput('是');
    expect(engine.getCurrentQuestionId()).toBe('fullName');
    expect(engine.getSession().enterprise.fullName).toBe('New Name');

    // User confirms again → advances to description
    await engine.handleUserInput('确认');
    expect(engine.getCurrentQuestionId()).toBe('description');

    // User enters a new description → pendingUpdate created, question stays at description
    await engine.handleUserInput('A clearer company description');
    expect(engine.getCurrentQuestionId()).toBe('description');
    expect(engine.getSession().pendingUpdate).toEqual({
      questionId: 'description',
      newValue: 'A clearer company description',
    });

    // User confirms → pendingUpdate applied, question stays at description
    await engine.handleUserInput('是');
    expect(engine.getSession().enterprise.description).toBe('A clearer company description');
    expect(engine.getCurrentQuestionId()).toBe('description');

    // User confirms again → advances to scale
    await engine.handleUserInput('确认');
    expect(engine.getCurrentQuestionId()).toBe('scale');
  });

  it('does not advance the question pointer after invalid input', async () => {
    const session = createEmptySession('test_session');
    session.currentStage = 'wordbank';

    const engine = new DialogueEngine(session);

    await engine.handleUserInput('');
    expect(engine.getCurrentQuestionId()).toBe('prefixes');
    expect(engine.getSession().wordBank.prefixes).toEqual([]);

    await engine.handleUserInput('最好, 推荐');
    expect(engine.getCurrentQuestionId()).toBe('suffixes');
    expect(engine.getSession().wordBank.prefixes).toEqual(['最好', '推荐']);
  });

  it('skips profile fields that were confirmed in the review form', async () => {
    const session = createEmptySession('test_session');
    session.currentStage = 'profile';
    session.enterprise.fullName = '芯图引擎：GEO';
    session.enterprise.description = 'GEO configuration coach';
    session.confirmedProfileFields = ['fullName', 'description'];

    const engine = new DialogueEngine(session);
    engine.setCurrentQuestionId('fullName');

    await engine.handleUserInput('确认');

    expect(engine.getCurrentQuestionId()).toBe('scale');
    expect(engine.getSession().currentStage).toBe('profile');
  });
});

describe('knowledge stage content planning', () => {
  it('uses the customer product domain instead of 芯图引擎：GEO configuration features', async () => {
    const session = createEmptySession('datafocus_session');
    session.currentStage = 'knowledge';
    session.enterprise = {
      ...session.enterprise,
      fullName: '杭州汇数智通科技有限公司',
      shortName: 'DataFocus',
      description: '中文原生、支持多轮对话的自然语言数据分析平台',
      products: [
        {
          name: 'FocusGPT',
          description: '面向业务人员的自然语言数据分析助手',
          category: '搜索式BI',
          isPrimary: true,
        },
      ],
      userPainPoints: ['传统BI门槛高', '报表响应慢', '业务人员难以自助分析'],
    };
    session.wordBank = {
      brandTerms: ['DataFocus'],
      productTerms: ['FocusGPT', 'DataFocus BI'],
      industryTerms: ['搜索式BI', '自然语言数据分析'],
      prefixes: [],
      suffixes: [],
    };

    const result = await knowledgeStage.handleInput(session, 'available_materials', '产品说明书, 客户案例, FAQ');
    const text = JSON.stringify({
      promotionGoal: result.sessionData.promotionGoal,
      keywordStrategy: result.sessionData.keywordStrategy,
      knowledgePlan: result.sessionData.knowledgePlan,
      imagePlan: result.sessionData.imagePlan,
      contentPlaybook: result.sessionData.contentPlaybook,
    });

    expect(result.sessionData.promotionGoal.productName).toBe('FocusGPT');
    expect(result.sessionData.promotionGoal.positioning).toContain('自然语言数据分析');
    expect(text).toContain('搜索式BI');
    expect(text).toContain('自然语言数据分析');
    expect(text).not.toContain('企业画像');
    expect(text).not.toContain('关键词蒸馏');
    expect(text).not.toContain('AI内容生成');
    expect(text).not.toContain('多平台发布');
    expect(text).not.toContain('内容营销工具');
    expect(text).not.toContain('Notion');
  });
});
