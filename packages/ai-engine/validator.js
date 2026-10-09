import { chatCompletion, isAIAvailable } from './client.js';
const VALIDATION_PROMPT = `你是一个 GEO 配置教练，负责校验用户输入。

任务：判断用户输入是否有效，并给出改进建议。

规则：
1. 如果输入为空或无意义，返回无效
2. 如果输入与问题不相关，返回无效并引导用户
3. 如果输入有效但不够好，返回有效并给出优化建议
4. 如果输入很好，返回有效并给予肯定

以 JSON 格式返回：{ "valid": boolean, "feedback": "string", "suggestion": "string" }`;
export async function validateInput(questionId, questionText, userInput, session) {
    // Basic validation first
    if (!userInput.trim()) {
        return { valid: false, feedback: '输入不能为空，请填写后重试。' };
    }
    // If AI is not available, do basic validation
    if (!isAIAvailable()) {
        return basicValidation(userInput);
    }
    const context = `当前阶段：${session.currentStage}
企业名称：${session.enterprise.fullName || '未填写'}
问题ID：${questionId}
问题内容：${questionText}
用户输入：${userInput}`;
    try {
        const response = await chatCompletion(VALIDATION_PROMPT, context, {
            temperature: 0.3,
            maxTokens: 500,
        });
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            return basicValidation(userInput);
        }
        return JSON.parse(jsonMatch[0]);
    }
    catch {
        return basicValidation(userInput);
    }
}
function basicValidation(input) {
    const trimmed = input.trim();
    if (trimmed.length < 2) {
        return { valid: false, feedback: '输入太短，请提供更多细节。' };
    }
    // Check if input is just random characters
    if (/^[a-z]{1,3}$/i.test(trimmed)) {
        return { valid: false, feedback: '这看起来不像有效输入，请提供完整的内容。' };
    }
    return { valid: true, feedback: '已收到你的输入。' };
}
//# sourceMappingURL=validator.js.map