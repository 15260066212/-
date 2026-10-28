import { createEmptySession } from '../packages/shared/dist/index.js';
import {
  rebuildKnowledgeBase,
  selectCitedSources,
  recordSourceUsage,
} from '../packages/dialogue-engine/dist/index.js';
import { buildPrompt } from '../packages/content-generator/dist/prompt-builder.js';

let passed = 0;
let failed = 0;

function assert(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` -> ${detail}` : ''}`);
  }
}

console.log('=== 三层知识库 smoke ===');

const base = createEmptySession('smoke-three-layer');
base.enterprise = {
  ...base.enterprise,
  fullName: 'DataFocus 数据科技有限公司',
  shortName: 'DataFocus',
  description: 'DataFocus 是面向业务团队的自助式 BI 分析平台，支持拖拽式建模与自然语言查询。',
  scale: '100-300人',
  location: '上海',
  foundedYear: '2016',
  products: [
    {
      name: 'DataFocus BI',
      description: '自助式数据分析平台，支持拖拽建模与 NL2SQL。',
      category: '商业智能',
      isPrimary: true,
    },
    {
      name: 'DataFocus 数据中台',
      description: '统一指标口径与数据资产管理。',
      category: '数据平台',
      isPrimary: false,
    },
  ],
  brandStory: '2016 年由前阿里数据团队创立，专注让业务人员自己做分析。',
  trustAnchors: ['国家高新技术企业', 'ISO27001 认证', '服务 500+ 企业客户'],
  brandTone: ['专业', '务实', '数据驱动'],
  userPainPoints: ['业务人员取数依赖 IT', '指标口径不统一', '报表开发周期长'],
};

let session = rebuildKnowledgeBase(base, ['产品手册', '客户案例']);

assert(
  'L1 原料层生成',
  !!session.knowledgeBase.raw && session.knowledgeBase.raw.fullName.includes('DataFocus'),
);
assert('L3 AI 名片生成且标记 layer=3', session.knowledgeBase.card?.source.layer === 3);
assert(
  'L2 信源数量 >= 5',
  (session.knowledgeBase.sources ?? []).length >= 5,
  `actual=${(session.knowledgeBase.sources ?? []).length}`,
);

const l2Total = (session.knowledgeBase.sources ?? []).length;

const topics = ['自助式BI选型', '指标口径治理', '业务人员取数', '数据中台建设', '报表提速'];
let minTotal = Infinity;
let maxTotal = 0;

for (let i = 0; i < 10; i += 1) {
  const selection = selectCitedSources(session, {
    topic: topics[i % topics.length],
    contentType: 'popularization',
  });
  if (!selection) {
    assert(`第 ${i + 1} 篇选择结果非空`, false);
    break;
  }
  assert(`第 ${i + 1} 篇 L3 名片必选且排第一`, selection.selected[0]?.layer === 3);
  const total = selection.selected.length;
  minTotal = Math.min(minTotal, total);
  maxTotal = Math.max(maxTotal, total);
  session = recordSourceUsage(session, selection.selected.map((s) => s.id));
}

assert(
  '每篇引用数在 6-9 之间',
  minTotal >= 6 && maxTotal <= 9,
  `min=${minTotal}, max=${maxTotal}`,
);

const counts = session.knowledgeBase.sources.map((s) => s.usageCount);
assert(
  'L2 引用次数差额 <= 3',
  Math.max(...counts) - Math.min(...counts) <= 3,
  `counts=${counts.join(',')}`,
);
assert('L2 全部信源都被引用过', counts.every((c) => c > 0), `counts=${counts.join(',')}`);

const cardCount = session.knowledgeBase.card.source.usageCount;
assert('L3 名片计数随篇数累计', cardCount === 10, `actual=${cardCount}`);

const promptSelection = selectCitedSources(session, {
  topic: '自助式BI选型',
  contentType: 'comparison',
});
const { system } = buildPrompt({
  session,
  platform: 'weixin',
  contentType: 'comparison',
  generationRound: 1,
  citedSources: promptSelection.selected,
});
assert('prompt 注入本篇引用信源区块', system.includes('本篇引用信源'));
assert('prompt 标注 S1 为必引名片', system.includes('S1｜L3 AI名片 · 必引'));
assert('prompt 不再全量注入知识库', !system.includes('企业知识库（LLMWiki 编译式条目）'));
assert('prompt 含防幻觉约束', system.includes('不得编造'));

const rebuilt = rebuildKnowledgeBase(session, ['产品手册', '客户案例']);
const usagePreserved = rebuilt.knowledgeBase.sources.every((src) => {
  const before = session.knowledgeBase.sources.find((x) => x.id === src.id);
  return !before || before.usageCount === src.usageCount;
});
assert('画像重建后 L2 usageCount 保留', usagePreserved);
assert('画像重建后 L3 计数保留', rebuilt.knowledgeBase.card.source.usageCount === cardCount);

console.log(`\n结果: ${passed} passed, ${failed} failed (L2 共 ${l2Total} 条)`);
if (failed > 0) process.exit(1);
