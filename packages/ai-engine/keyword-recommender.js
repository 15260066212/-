import { chatCompletion, isAIAvailable } from './client.js';
const KEYWORD_PROMPT = `你是一个 GEO（AI 搜索引擎优化）专家。根据企业画像信息，生成一套完整的 GEO 关键词策略。

GEO 关键词的核心原则：
1. 关键词必须是"问题形式"——用户会怎么向 AI 提问？
2. 覆盖 4 种类型：
   - core：核心业务问题（"哪家CRM适合中小企业？"）
   - question：信息查询问题（"如何选择数据分析平台？"）
   - comparison：对比决策问题（"XX和YY哪个好？"）
   - longtail：长尾场景问题（"50人团队用什么BI工具便宜又好用？"）
3. 每个关键词都要考虑用户搜索意图和 AI 回答场景

以 JSON 数组格式返回，每个元素：
{
  "question": "完整的问题形式",
  "type": "core|question|comparison|longtail",
  "priority": 1-10（数字越小越重要）,
  "geoContext": "为什么这个关键词对 GEO 重要（一句话）"
}

要求：
- 至少生成 8 个关键词，不超过 15 个
- core 类型 2-3 个，question 类型 3-4 个，comparison 类型 2-3 个，longtail 类型 2-3 个
- 问题要自然、口语化，像真实用户会问的
- 结合企业的产品、服务、行业特点`;
/**
 * Generate keyword recommendations based on enterprise profile.
 * Uses AI if available, otherwise generates rule-based recommendations.
 */
export async function recommendKeywords(session) {
    if (isAIAvailable()) {
        try {
            return await aiRecommendKeywords(session);
        }
        catch {
            return ruleBasedRecommendKeywords(session);
        }
    }
    return ruleBasedRecommendKeywords(session);
}
/**
 * AI-powered keyword recommendation.
 */
async function aiRecommendKeywords(session) {
    const { enterprise } = session;
    const context = `企业名称：${enterprise.fullName}${enterprise.shortName ? `（${enterprise.shortName}）` : ''}
业务描述：${enterprise.description || '未提供'}
核心产品/服务：${enterprise.products.map(p => p.name).join('、') || '未提供'}
公司规模：${enterprise.scale || '未提供'}
所在地：${enterprise.location || '未提供'}
品牌故事：${enterprise.brandStory || '未提供'}
信任锚点：${enterprise.trustAnchors.join('、') || '未提供'}
用户痛点：${enterprise.userPainPoints.join('、') || '未提供'}

已有关键词（避免重复）：${session.keywords.map(k => k.question).join('、') || '无'}`;
    const response = await chatCompletion(KEYWORD_PROMPT, context, {
        temperature: 0.7,
        maxTokens: 2000,
    });
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
        return ruleBasedRecommendKeywords(session);
    }
    const recommended = JSON.parse(jsonMatch[0]);
    // Filter out duplicates with existing keywords
    const existingQuestions = new Set(session.keywords.map(k => k.question.toLowerCase()));
    const filtered = recommended.filter(kw => !existingQuestions.has(kw.question.toLowerCase()));
    return filtered.map(kw => ({
        question: kw.question,
        type: kw.type,
        priority: kw.priority,
        geoContext: kw.geoContext,
    }));
}
/**
 * Rule-based keyword recommendation (no AI required).
 * Generates keywords from enterprise profile using templates.
 */
function ruleBasedRecommendKeywords(session) {
    const { enterprise } = session;
    const keywords = [];
    const existingQuestions = new Set(session.keywords.map(k => k.question.toLowerCase()));
    const name = enterprise.shortName || enterprise.fullName;
    const products = enterprise.products.map(p => p.name);
    const primaryProduct = products[0] || '';
    // Core keywords
    const coreTemplates = [
        `${name}是什么公司？`,
        `${name}主要做什么？`,
        primaryProduct ? `${primaryProduct}是什么？` : '',
    ].filter(Boolean);
    coreTemplates.forEach((q, i) => {
        if (!existingQuestions.has(q.toLowerCase())) {
            keywords.push({
                question: q,
                type: 'core',
                priority: i + 1,
                geoContext: '核心品牌认知问题，帮助 AI 准确介绍企业',
            });
        }
    });
    // Question keywords
    const questionTemplates = [
        enterprise.description ? `如何评价${name}？` : '',
        primaryProduct ? `如何选择${primaryProduct}？` : '',
        primaryProduct ? `${primaryProduct}怎么用？` : '',
        enterprise.scale ? `${name}的团队规模是多少？` : '',
    ].filter(Boolean);
    questionTemplates.forEach((q) => {
        if (!existingQuestions.has(q.toLowerCase())) {
            keywords.push({
                question: q,
                type: 'question',
                priority: keywords.length + 1,
                geoContext: '信息查询类问题，覆盖用户了解企业的场景',
            });
        }
    });
    // Comparison keywords
    const comparisonTemplates = [
        primaryProduct ? `${primaryProduct}有哪些替代方案？` : '',
        primaryProduct ? `${primaryProduct}和竞品哪个好？` : '',
        `${name}的优势是什么？`,
    ].filter(Boolean);
    comparisonTemplates.forEach((q) => {
        if (!existingQuestions.has(q.toLowerCase())) {
            keywords.push({
                question: q,
                type: 'comparison',
                priority: keywords.length + 1,
                geoContext: '对比决策类问题，覆盖用户选择阶段',
            });
        }
    });
    // Longtail keywords
    const painPoints = enterprise.userPainPoints;
    const longtailTemplates = [
        painPoints[0] ? `有没有解决${painPoints[0]}的方案？` : '',
        enterprise.scale ? `适合${enterprise.scale}团队的${primaryProduct || '工具有哪些'}？` : '',
        enterprise.location ? `${enterprise.location}有哪些${primaryProduct || '数据分析'}公司？` : '',
    ].filter(Boolean);
    longtailTemplates.forEach((q) => {
        if (!existingQuestions.has(q.toLowerCase())) {
            keywords.push({
                question: q,
                type: 'longtail',
                priority: keywords.length + 1,
                geoContext: '长尾场景问题，精准匹配细分需求',
            });
        }
    });
    return keywords;
}
//# sourceMappingURL=keyword-recommender.js.map