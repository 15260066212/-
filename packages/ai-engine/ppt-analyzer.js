import { chatCompletion, isAIAvailable } from './client.js';
const PPT_ANALYSIS_PROMPT = `你是一个 GEO（AI 搜索引擎优化）专家。分析以下从企业 PPT/介绍材料中提取的文本内容，提取关键信息。

要求：
1. 提取企业全称和简称
2. 提取一句话业务描述（20-50字）
3. 推断公司规模（如：50人、100-500人）
4. 推断所在地
5. 提取核心产品/服务列表（最多5个）
6. 提炼品牌故事（3-5句话）
7. 提取信任锚点（客户数量、奖项、认证等）
8. 推断品牌调性关键词（3-5个）
9. 生成 GEO 关键词（8-15个，必须是"问题形式"），每个关键词包含：
   - question: 完整的问题形式
   - type: "core"（核心品牌问题）| "question"（信息查询）| "comparison"（对比决策）| "longtail"（长尾场景）
   - priority: 1-10（数字越小越重要）

GEO 关键词原则：
- 必须是用户会向 AI 提问的自然语言问题
- 覆盖不同搜索意图：了解品牌、查询信息、对比决策、场景需求

以 JSON 格式返回，字段：fullName, shortName, description, scale, location, products(数组), brandStory, trustAnchors(数组), brandTone(数组), keywords(数组，每个元素含 question/type/priority)`;
export async function analyzePptContent(slideTexts, fileName, session) {
    const combinedText = slideTexts.join('\n\n---\n\n');
    if (!isAIAvailable()) {
        return {
            summary: `已导入 PPT：${fileName}\n共 ${slideTexts.length} 页幻灯片\n\n（未配置 AI 服务，已提取原始文本，请手动补充信息。）\n\n提取内容摘要：\n${combinedText.slice(0, 500)}...`,
            enterprise: {},
            keywords: [],
        };
    }
    try {
        const userInput = `文件名: ${fileName}
幻灯片页数: ${slideTexts.length}

幻灯片内容:
${combinedText.slice(0, 4000)}`;
        const response = await chatCompletion(PPT_ANALYSIS_PROMPT, userInput, {
            temperature: 0.3,
            maxTokens: 1500,
        });
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            return fallbackPptAnalysis(slideTexts, fileName);
        }
        const analysis = JSON.parse(jsonMatch[0]);
        const summary = generatePptSummary(analysis, fileName, slideTexts.length);
        return {
            summary,
            enterprise: {
                fullName: analysis.fullName || session.enterprise.fullName,
                shortName: analysis.shortName || session.enterprise.shortName,
                description: analysis.description || session.enterprise.description,
                scale: analysis.scale || session.enterprise.scale,
                location: analysis.location || session.enterprise.location,
                products: analysis.products.map((name) => ({
                    name,
                    description: '',
                    category: '',
                    isPrimary: false,
                })),
                brandStory: analysis.brandStory || session.enterprise.brandStory,
                trustAnchors: analysis.trustAnchors || session.enterprise.trustAnchors,
                brandTone: analysis.brandTone || session.enterprise.brandTone,
            },
            keywords: analysis.keywords.map((kw, index) => ({
                question: kw.question,
                type: kw.type || 'core',
                priority: kw.priority || index + 1,
                geoContext: `从 PPT 提取的关键词`,
            })),
        };
    }
    catch {
        return fallbackPptAnalysis(slideTexts, fileName);
    }
}
function fallbackPptAnalysis(slideTexts, fileName) {
    const combinedText = slideTexts.join('\n');
    return {
        summary: `已导入 PPT：${fileName}\n共 ${slideTexts.length} 页幻灯片\n\n（AI 分析不可用，已提取原始文本，请手动补充信息。）\n\n提取内容摘要：\n${combinedText.slice(0, 500)}...`,
        enterprise: {},
        keywords: [],
    };
}
function generatePptSummary(analysis, fileName, slideCount) {
    const lines = [`📄 已分析 PPT：${fileName}（共 ${slideCount} 页）`, ''];
    if (analysis.fullName)
        lines.push(`📌 企业名称：${analysis.fullName}${analysis.shortName ? `（${analysis.shortName}）` : ''}`);
    if (analysis.description)
        lines.push(`📝 业务描述：${analysis.description}`);
    if (analysis.scale)
        lines.push(`👥 公司规模：${analysis.scale}`);
    if (analysis.location)
        lines.push(`📍 所在地：${analysis.location}`);
    if (analysis.products.length > 0)
        lines.push(`🎯 核心产品：${analysis.products.join('、')}`);
    if (analysis.trustAnchors.length > 0)
        lines.push(`🏆 信任锚点：${analysis.trustAnchors.join('、')}`);
    if (analysis.brandTone.length > 0)
        lines.push(`🎨 品牌调性：${analysis.brandTone.join('、')}`);
    if (analysis.keywords.length > 0) {
        const kwDisplay = analysis.keywords.slice(0, 5).map(kw => kw.question).join('、');
        lines.push(`🔑 核心关键词：${kwDisplay}`);
    }
    lines.push('');
    lines.push('以上信息已从 PPT 自动提取并填入企业画像，你可以确认或修改。');
    return lines.join('\n');
}
//# sourceMappingURL=ppt-analyzer.js.map