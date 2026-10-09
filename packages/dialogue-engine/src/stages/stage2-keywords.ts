import type { SessionData, DialogueMessage, CoreKeyword } from '@zemingengine/shared';
import type { StageHandler, Question, StageResult } from '../types.js';
import { required, minLength, combine } from '../validators.js';

let messageCounter = 0;
function nextId(): string {
  return `msg_${Date.now()}_${++messageCounter}`;
}

function makeMessage(role: 'system' | 'user', content: string): DialogueMessage {
  return { id: nextId(), role, content, stage: 'keywords', timestamp: new Date().toISOString() };
}

const CONFIRM_KEYWORDS = /^(确认|继续|ok|yes|没问题|对|好的|确定|是|全部确认)$/i;
function isConfirmCommand(input: string): boolean {
  return CONFIRM_KEYWORDS.test(input.trim());
}

const questions: Question[] = [
  {
    id: 'core_keyword',
    text: '请提供一个核心关键词：当用户向 AI 提问时，你最希望被推荐的问题是什么？（完整的问题形式）\n\n例如："哪家CRM系统适合中小企业？"',
    geoContext: 'GEO 的核心是"问题形式"的关键词，AI 搜索引擎理解的是自然语言问题。',
    validator: combine(required, minLength(5)),
  },
  {
    id: 'question_keyword',
    text: '请提供一个信息查询类关键词：用户会怎么问关于你们行业/产品的一般性问题？\n\n例如："如何选择数据分析平台？"',
    geoContext: '信息查询类问题覆盖用户了解行业的场景。',
    validator: combine(required, minLength(5)),
  },
  {
    id: 'comparison_keyword',
    text: '请提供一个对比类关键词：用户在做决策时会怎么比较？\n\n例如："XX和YY哪个好？"或"XX产品的替代方案有哪些？"',
    geoContext: '对比类问题是 AI 搜索的高频场景，也是用户决策的关键时刻。',
    validator: combine(required, minLength(5)),
  },
  {
    id: 'user_pain_points',
    text: '你的目标用户最常遇到的痛点是什么？（列出 2-3 个，用逗号分隔）',
    geoContext: '用户痛点是生成长尾关键词的基础。AI 会优先推荐能解决痛点的内容。',
    validator: required,
  },
];

/**
 * Format keyword list for display.
 */
function formatKeywordList(keywords: CoreKeyword[]): string {
  const typeLabels: Record<string, string> = {
    core: '🎯 核心',
    question: '❓ 查询',
    comparison: '⚖️ 对比',
    longtail: '🔖 长尾',
  };

  return keywords.map((kw, i) => {
    const label = typeLabels[kw.type] || '📌';
    return `  ${i + 1}. ${label} ${kw.question}`;
  }).join('\n');
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function generateWordBank(session: SessionData): SessionData['wordBank'] {
  const name = session.enterprise.shortName || session.enterprise.fullName;
  const brandTerms = unique([
    name,
    session.enterprise.fullName,
    session.enterprise.shortName,
    `${name}怎么样`,
    `${name}官网`,
  ]);

  const productTerms = unique([
    ...session.enterprise.products.flatMap((product) => [product.name, product.category, product.description]),
    ...session.keywords.map((keyword) => keyword.question.replace(/[？?]/g, '')),
  ]).slice(0, 12);

  const industryTerms = unique([
    ...session.keywords.map((keyword) => keyword.geoContext),
    ...session.enterprise.userPainPoints,
    session.enterprise.description,
  ]).slice(0, 12);

  return {
    brandTerms,
    productTerms,
    industryTerms,
    prefixes: ['最佳', '推荐', '适合', '企业级', 'AI驱动', '一站式', '高效', '专业'],
    suffixes: ['平台', '工具', '方案', '系统', '服务', '案例', '实践', '指南'],
  };
}

function completeKeywordsAndGenerateWordBank(updated: SessionData, userMsg: DialogueMessage): StageResult {
  updated.wordBank = generateWordBank(updated);
  updated.currentStage = 'knowledge';
  return {
    messages: [
      userMsg,
      makeMessage('system', `✅ 关键词配置完成，已自动生成词库：\n\n品牌词：${updated.wordBank.brandTerms.join('、') || '待补充'}\n产品词：${updated.wordBank.productTerms.slice(0, 6).join('、') || '待补充'}\n行业词：${updated.wordBank.industryTerms.slice(0, 6).join('、') || '待补充'}\n前缀：${updated.wordBank.prefixes.join('、')}\n后缀：${updated.wordBank.suffixes.join('、')}\n\n接下来构建知识库。请列出你们已有或可提供的资料，例如：用户手册、产品说明、白皮书、行业资料、案例、FAQ、产品截图、架构图等。`),
    ],
    sessionData: updated,
    stageComplete: true,
    allComplete: false,
  };
}

export const keywordsStage: StageHandler = {
  stage: 'keywords',
  questions,

  getIntroMessage(session: SessionData): string {
    const name = session.enterprise.shortName || session.enterprise.fullName || '贵公司';

    if (session.keywords.length > 0) {
      return `好的，${name}的品牌画像已完成！\n\nAI 已基于企业信息推荐了以下 GEO 关键词：\n\n${formatKeywordList(session.keywords)}\n\n以上关键词已自动填入，你可以：\n• 回复"全部确认"跳过，直接进入下一步\n• 输入编号（如"2"）修改某个关键词\n• 输入新的关键词补充\n\n${questions[0].text}`;
    }

    return `好的，${name}的品牌画像已完成！\n\n接下来确定 GEO 核心关键词。GEO 的关键词是"完整的问题形式"——用户会怎么向 AI 提问？\n\n${questions[0].text}`;
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
    const updated = { ...session };

    // --- Handle "全部确认" command ---
    if (/^全部确认$/.test(trimmed) && session.keywords.length >= 3) {
      // Check if pain points are filled
      if (session.enterprise.userPainPoints.length > 0) {
        return completeKeywordsAndGenerateWordBank(updated, userMsg);
      }
      // Need pain points, jump to that question
      return {
        messages: [userMsg, makeMessage('system', `✅ 已确认关键词。接下来补充用户痛点。\n\n${questions[questions.length - 1].text}`)],
        sessionData: updated,
        stageComplete: false,
        allComplete: false,
      };
    }

    // --- Handle "确认" command (for current question context) ---
    if (isConfirmCommand(trimmed)) {
      // If we have enough keywords and pain points, complete
      if (updated.keywords.length >= 3 && updated.enterprise.userPainPoints.length > 0) {
        return completeKeywordsAndGenerateWordBank(updated, userMsg);
      }

      // Move to next question
      const currentIndex = questions.findIndex((q) => q.id === questionId);
      const nextQ = questions[currentIndex + 1];
      if (nextQ) {
        return {
          messages: [userMsg, makeMessage('system', nextQ.text)],
          sessionData: updated,
          stageComplete: false,
          allComplete: false,
        };
      }

      // All questions done
      return completeKeywordsAndGenerateWordBank(updated, userMsg);
    }

    // --- Handle "跳过" command ---
    if (trimmed === '跳过') {
      const currentIndex = questions.findIndex((q) => q.id === questionId);
      const nextQ = questions[currentIndex + 1];
      if (nextQ) {
        return {
          messages: [userMsg, makeMessage('system', nextQ.text)],
          sessionData: updated,
          stageComplete: false,
          allComplete: false,
        };
      }
      return completeKeywordsAndGenerateWordBank(updated, userMsg);
    }

    // --- Handle numbered keyword modification (e.g., "2", "2 如何选择BI工具？") ---
    const numberMatch = trimmed.match(/^(\d+)(?:\s+(.+))?$/);
    if (numberMatch && updated.keywords.length > 0) {
      const index = parseInt(numberMatch[1]) - 1;
      const newValue = numberMatch[2];

      if (index >= 0 && index < updated.keywords.length) {
        if (newValue) {
          // Direct modification
          const oldKw = updated.keywords[index];
          updated.keywords = [...updated.keywords];
          updated.keywords[index] = { ...oldKw, question: newValue };
          return {
            messages: [userMsg, makeMessage('system', `✅ 已修改第 ${index + 1} 个关键词为：${newValue}\n\n${formatKeywordList(updated.keywords)}\n\n继续补充或回复"确认"进入下一步。`)],
            sessionData: updated,
            stageComplete: false,
            allComplete: false,
          };
        } else {
          // Show the keyword and ask for new value
          const kw = updated.keywords[index];
          return {
            messages: [userMsg, makeMessage('system', `第 ${index + 1} 个关键词：${kw.question}\n\n请输入新的问题形式：`)],
            sessionData: updated,
            stageComplete: false,
            allComplete: false,
          };
        }
      }
    }

    // --- Handle "删除X" command ---
    const deleteMatch = trimmed.match(/^删除\s*(\d+)$/);
    if (deleteMatch && updated.keywords.length > 0) {
      const index = parseInt(deleteMatch[1]) - 1;
      if (index >= 0 && index < updated.keywords.length) {
        const removed = updated.keywords[index];
        updated.keywords = updated.keywords.filter((_, i) => i !== index);
        return {
          messages: [userMsg, makeMessage('system', `✅ 已删除关键词：${removed.question}\n\n当前关键词：\n${updated.keywords.length > 0 ? formatKeywordList(updated.keywords) : '  （暂无）'}\n\n继续补充或回复"确认"进入下一步。`)],
          sessionData: updated,
          stageComplete: false,
          allComplete: false,
        };
      }
    }

    // --- Handle user_pain_points question ---
    if (questionId === 'user_pain_points') {
      updated.enterprise = {
        ...updated.enterprise,
        userPainPoints: trimmed.split(/[,，、；;\n]/).map((s) => s.trim()).filter(Boolean),
      };

      // Pain points collected, check if we have enough keywords
      if (updated.keywords.length >= 3) {
        return completeKeywordsAndGenerateWordBank(updated, userMsg);
      }

      // Need more keywords
      return {
        messages: [userMsg, makeMessage('system', `✅ 已记录用户痛点。还需要补充关键词（当前 ${updated.keywords.length} 个，至少需要 3 个）。\n\n${questions[0].text}`)],
        sessionData: updated,
        stageComplete: false,
        allComplete: false,
      };
    }

    // --- Handle batch keyword input (multiple keywords separated by commas/newlines) ---
    const batchKeywords = trimmed.split(/[,，、；;\n]/).map(s => s.trim()).filter(Boolean);
    const isBatchInput = batchKeywords.length > 1;

    // --- Regular keyword input ---
    // Validate (skip strict validation for batch input since individual items may be short)
    if (!isBatchInput && question.validator) {
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

    // Determine keyword type based on question
    let type: CoreKeyword['type'] = 'core';
    if (questionId === 'comparison_keyword') type = 'comparison';
    else if (questionId === 'question_keyword') type = 'question';

    if (isBatchInput) {
      // Add all keywords from batch input
      const newKeywords: CoreKeyword[] = batchKeywords.map((kw, idx) => ({
        question: kw,
        type: idx === 0 ? type : (idx === 1 ? 'question' : idx === 2 ? 'comparison' : 'longtail'),
        priority: updated.keywords.length + idx + 1,
        geoContext: question.geoContext ?? '',
      }));
      updated.keywords = [...updated.keywords, ...newKeywords];
    } else {
      // Add single keyword
      updated.keywords = [
        ...updated.keywords,
        {
          question: trimmed,
          type,
          priority: updated.keywords.length + 1,
          geoContext: question.geoContext ?? '',
        },
      ];
    }

    // Show current keywords and ask next question
    const currentIndex = questions.findIndex((q) => q.id === questionId);
    const nextQ = questions[currentIndex + 1];

    const keywordSummary = `\n当前已收集 ${updated.keywords.length} 个关键词：\n${formatKeywordList(updated.keywords)}`;

    if (nextQ) {
      return {
        messages: [userMsg, makeMessage('system', `✅ 已添加关键词。${keywordSummary}\n\n${nextQ.text}`)],
        sessionData: updated,
        stageComplete: false,
        allComplete: false,
      };
    }

    // All questions done
    return completeKeywordsAndGenerateWordBank(updated, userMsg);
  },

  isComplete(session: SessionData): boolean {
    return session.keywords.length >= 3;
  },
};
