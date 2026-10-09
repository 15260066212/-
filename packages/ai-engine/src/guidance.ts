import type { SessionData, Stage } from '@zemingengine/shared';
import { STAGE_DISPLAY_NAMES } from '@zemingengine/shared';
import { chatCompletion, isAIAvailable } from './client.js';

const GUIDANCE_PROMPT = `你是一个友好的 GEO（AI 搜索引擎优化）配置教练。

你的任务是为用户当前的配置阶段生成引导说明。

要求：
1. 用简单易懂的语言解释当前阶段的目的
2. 说明为什么这个信息对 AI 搜索优化很重要
3. 给出 1-2 个具体的例子
4. 鼓励用户，保持积极的语气
5. 长度控制在 150-250 字

注意：GEO 是让 AI 搜索引擎（如 ChatGPT、Perplexity）更好地理解和推荐你的品牌的方法。`;

export async function generateGuidance(
  stage: Stage,
  session: SessionData
): Promise<string> {
  if (!isAIAvailable()) {
    return getDefaultGuidance(stage);
  }

  const context = `当前阶段：${STAGE_DISPLAY_NAMES[stage]}（${stage}）
企业名称：${session.enterprise.fullName || '未填写'}
已收集的信息：
- 产品：${session.enterprise.products.map(p => p.name).join('、') || '无'}
- 关键词：${session.keywords.map(k => k.question).join('、') || '无'}
- 词库前缀：${session.wordBank.prefixes.join('、') || '无'}
- 词库后缀：${session.wordBank.suffixes.join('、') || '无'}

请为"${STAGE_DISPLAY_NAMES[stage]}"阶段生成引导说明。`;

  try {
    const response = await chatCompletion(GUIDANCE_PROMPT, context, {
      temperature: 0.8,
      maxTokens: 500,
    });
    return response || getDefaultGuidance(stage);
  } catch {
    return getDefaultGuidance(stage);
  }
}

function getDefaultGuidance(stage: Stage): string {
  const guidance: Record<Stage, string> = {
    intro: '欢迎使用 芯图引擎：GEO 配置教练！我会通过企业画像、关键词、知识库等核心对话，帮你生成词库、内容提示词和平台发布策略。\n\n请提供你的企业官网 URL，我会自动抓取并分析；或者输入"手动"从零开始配置。',
    profile: '接下来我们来完善企业画像。这将帮助 AI 搜索引擎准确理解你的企业。\n\n💡 为什么重要？当用户问 AI "推荐一家XX公司"时，AI 需要准确的企业信息来做出推荐。信息越完整，被推荐的概率越高。',
    keywords: 'GEO 的关键词是"完整的问题形式"，而不是传统的短尾词。\n\n💡 例如，用户不会搜索"CRM"，而是问"哪家CRM系统适合中小企业？"。你需要想出 3 个用户最可能问的问题。',
    wordbank: '词库会根据企业画像、产品属性和关键词自动生成，不需要人工逐项填写。\n\n💡 系统会整理品牌词、产品词、行业词、前缀和后缀，用来扩展内容选题与生成提示。',
    knowledge: '知识库是你提供给 AI 的"证据材料"。\n\n💡 当 AI 引用你时，它需要有据可查的内容。产品文档、案例研究、FAQ 都是很好的素材。标签帮助 AI 理解你的内容主题。',
    prompts: '提示词模板会根据企业画像、知识库和不同平台内容习惯自动生成。\n\n💡 同一个产品在公众号、知乎、官网博客的写法不同，提示词会分别约束结构、语气、长度和事实来源。',
    platforms: '平台策略会根据企业调性、行业和目标人群自动推荐。\n\n💡 策略会包含发布平台、顺序、时间、频率、适合调性和内容方向，帮助内容持续被生成式引擎识别和引用。',
  };
  return guidance[stage] || '请继续配置。';
}
