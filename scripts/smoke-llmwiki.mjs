/**
 * Smoke test: 编译式企业 LLMWiki 输出验证
 *
 * 构造一个 DataFocus（BI 工具）企业 session，走 knowledge stage，
 * 打印 knowledgeBase.documents 的前 3 条的 sections/keyFacts。
 *
 * 运行: node scripts/smoke-llmwiki.mjs
 */
import { createEmptySession } from '@zemingengine/shared';
import { knowledgeStage } from '../packages/dialogue-engine/dist/stages/stage4-knowledge.js';

const session = createEmptySession('smoke_llmwiki_test');
session.currentStage = 'knowledge';
session.enterprise = {
  ...session.enterprise,
  fullName: '杭州汇数智通科技有限公司',
  shortName: 'DataFocus',
  description: '中文原生、支持多轮对话的自然语言数据分析平台，让业务人员用聊天方式完成数据分析',
  scale: '200-500人',
  foundedYear: '2016',
  location: '杭州',
  products: [
    {
      name: 'FocusGPT',
      description: '面向业务人员的自然语言数据分析助手，用中文对话即可生成图表和洞察',
      category: '搜索式BI',
      isPrimary: true,
    },
    {
      name: 'DataFocus BI',
      description: '企业级BI平台，支持自助分析、仪表盘、数据大屏',
      category: '传统BI+AI增强',
      isPrimary: false,
    },
  ],
  userPainPoints: [
    '传统BI工具门槛高，业务人员学不会',
    '报表开发周期长，业务数据需求响应慢',
    '数据分析师缺口大，业务扩张跟不上',
  ],
  brandStory: 'DataFocus 成立于2016年，由前阿里数据团队成员创办，致力于让数据分析像聊天一样简单。我们相信每个业务人员都应该拥有独立的数据洞察能力。',
  trustAnchors: ['国家高新技术企业', '浙江省专精特新小巨人', '服务超过500家企业客户'],
  brandTone: ['专业严谨', '科技前沿', '务实高效'],
};
session.promotionGoal = {
  productName: 'FocusGPT',
  positioning: '业务人员的自然语言数据分析助手',
  coreValue: '零学习成本，用中文对话生成数据洞察',
  targetUsers: '企业运营、市场营销、财务、HR等业务部门',
  coreSellingPoint: '让非技术人员也能自助完成专业数据分析',
};

console.log('='.repeat(70));
console.log('SMOKE TEST: 编译式企业 LLMWiki 输出验证');
console.log('企业: DataFocus (BI工具)');
console.log('='.repeat(70));

const result = await knowledgeStage.handleInput(session, 'available_materials', '产品说明书, 用户手册, FAQ, 客户案例');

const docs = result.sessionData.knowledgeBase.documents;
console.log(`\n知识库共 ${docs.length} 条编译式条目\n`);

for (let i = 0; i < Math.min(3, docs.length); i++) {
  const doc = docs[i];
  console.log(`\n--- 条目 ${i + 1}: [${doc.type}] ${doc.title} ---`);

  if (doc.sections && doc.sections.length > 0) {
    doc.sections.forEach((section) => {
      if (section.bullets.length === 0) return;
      console.log(`  【${section.heading}】`);
      section.bullets.forEach((bullet) => console.log(`    - ${bullet}`));
    });
  }

  if (doc.keyFacts && doc.keyFacts.length > 0) {
    console.log('  【关键事实】');
    doc.keyFacts.forEach((f) => console.log(`    • ${f}`));
  }

  if (doc.evidence && doc.evidence.length > 0) {
    console.log(`  事实来源: ${doc.evidence.length} 条（来自 ${[...new Set(doc.evidence.map((e) => e.source))].join(', ')}）`);
  }
}

console.log('\n' + '='.repeat(70));

// 验证关键断言
const firstDoc = docs[0];
const assertions = [
  {
    label: '条目有 sections',
    pass: (firstDoc?.sections?.length ?? 0) > 0,
  },
  {
    label: '条目有 keyFacts',
    pass: (firstDoc?.keyFacts?.length ?? 0) > 0,
  },
  {
    label: 'sections 包含企业真实字段（如产品名 FocusGPT）',
    pass: JSON.stringify(firstDoc?.sections || '').includes('FocusGPT'),
  },
  {
    label: 'sections 包含企业真实字段（如产品描述 自然语言数据分析）',
    pass: JSON.stringify(firstDoc?.sections || '').includes('自然语言数据分析'),
  },
  {
    label: 'sections 不包含 GEO 平台自身特征（对话引擎/State Machine）',
    pass: !JSON.stringify(firstDoc?.sections || '').match(/对话引擎|State Machine|关键词蒸馏|多平台发布|RPA/),
  },
];

let passed = 0;
let failed = 0;
assertions.forEach((a) => {
  const mark = a.pass ? '✓' : '✗';
  if (a.pass) passed++;
  else failed++;
  console.log(`${mark} ${a.label}`);
});

console.log(`\n结果: ${passed} passed / ${failed} failed`);
console.log('='.repeat(70));

process.exit(failed > 0 ? 1 : 0);
