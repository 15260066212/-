/**
 * 端到端链路验证：stage4 编译 → JSON 持久化 round-trip（模拟 sessions 表）→ buildPrompt 消费
 *
 * 运行: node scripts/smoke-chain.mjs
 */
import { createEmptySession } from '@zemingengine/shared';
import { knowledgeStage } from '../packages/dialogue-engine/dist/stages/stage4-knowledge.js';
import { buildPrompt } from '../packages/content-generator/dist/prompt-builder.js';

// 1. 构造企业 session 并走 knowledge stage
const session = createEmptySession('chain_test');
session.currentStage = 'knowledge';
session.enterprise = {
  ...session.enterprise,
  fullName: '杭州汇数智通科技有限公司',
  shortName: 'DataFocus',
  description: '中文原生的自然语言数据分析平台',
  products: [{ name: 'FocusGPT', description: '自然语言数据分析助手', category: '搜索式BI', isPrimary: true }],
  userPainPoints: ['传统BI门槛高', '报表响应慢'],
  brandStory: 'DataFocus 成立于2016年，致力于让数据分析像聊天一样简单。',
  trustAnchors: ['国家高新技术企业'],
  brandTone: ['专业严谨'],
};
session.promotionGoal = { productName: 'FocusGPT', positioning: '', coreValue: '', targetUsers: '', coreSellingPoint: '' };

const result = await knowledgeStage.handleInput(session, 'available_materials', '产品说明书, FAQ');
const docs = result.sessionData.knowledgeBase.documents;
console.log(`[1] stage4 编译: ${docs.length} 条知识条目`);

// 2. JSON round-trip（模拟 SessionRepository upsertSession → getSession）
const restored = JSON.parse(JSON.stringify(result.sessionData));
const restoredDoc = restored.knowledgeBase.documents[0];
console.log(`[2] DB round-trip: sections=${restoredDoc.sections?.length ?? 0}, keyFacts=${restoredDoc.keyFacts?.length ?? 0}, evidence=${restoredDoc.evidence?.length ?? 0}`);

// 3. buildPrompt 消费（模拟 POST /api/articles/generate → ContentGenerator）
const { system } = buildPrompt({
  session: restored,
  platform: 'zhihu',
  contentType: 'tutorial',
  generationRound: 1,
});
console.log(`[3] buildPrompt: system prompt ${system.length} 字符`);

// 断言
const checks = [
  ['stage4 产出 sections', docs.every((d) => (d.sections?.length ?? 0) > 0)],
  ['JSON round-trip 后 sections 完整', (restoredDoc.sections?.length ?? 0) > 0],
  ['JSON round-trip 后 evidence 完整', (restoredDoc.evidence?.length ?? 0) > 0],
  ['system prompt 包含编译式知识库区块', system.includes('企业知识库（LLMWiki 编译式条目）')],
  ['system prompt 注入企业真实产品名', system.includes('FocusGPT')],
  ['system prompt 注入关键事实', system.includes('【可直接引用的关键事实】')],
  ['system prompt 注入防幻觉提示', system.includes('不要编造企业不存在的功能')],
];

let failed = 0;
checks.forEach(([label, pass]) => {
  console.log(`${pass ? '✓' : '✗'} ${label}`);
  if (!pass) failed++;
});
console.log(failed === 0 ? '\n链路全部跑通' : `\n${failed} 项失败`);
process.exit(failed > 0 ? 1 : 0);
