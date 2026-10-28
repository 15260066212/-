/**
 * P2 验证：rebuildKnowledgeBase — enterprise 字段变更后知识库能否正确重编译
 *
 * 模拟场景：企业客户从 DataFocus（BI）换成 "新东方教育科技"（教育），
 *          已走过 knowledge 阶段，profile-review 全量更新 enterprise 后
 *          knowledgeBase 应自动从教育行业字段重编译。
 *
 * 运行: node scripts/smoke-p2-rebuild.mjs
 */
import { createEmptySession } from '@zemingengine/shared';
import { knowledgeStage } from '../packages/dialogue-engine/dist/stages/stage4-knowledge.js';
import { rebuildKnowledgeBase } from '../packages/dialogue-engine/dist/index.js';

// 1. 先走 stage4 得到初始知识库（DataFocus BI 企业）
const session = createEmptySession('p2_test');
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

const v1 = await knowledgeStage.handleInput(session, 'available_materials', '产品说明书, FAQ, 客户案例');
console.log('【v1】初始知识库');
console.log(`  条目: ${v1.sessionData.knowledgeBase.documents.length}`);
console.log(`  sections[0].heading[0]: ${v1.sessionData.knowledgeBase.documents[0]?.sections?.[0]?.heading ?? 'N/A'}`);
console.log(`  sections[0].bullets[0]: ${v1.sessionData.knowledgeBase.documents[0]?.sections?.[0]?.bullets?.[0] ?? 'N/A'}`);
console.log(`  含旧产品名 FocusGPT: ${JSON.stringify(v1.sessionData.knowledgeBase.documents[0]?.sections).includes('FocusGPT')}`);

// 2. 模拟 profile-review：全量替换 enterprise 为新东方教育
const materials = v1.sessionData.knowledgeBase.documents.map((d) => d.title);
v1.sessionData.enterprise = {
  ...v1.sessionData.enterprise,
  fullName: '新东方教育科技集团',
  shortName: '新东方',
  description: '综合性教育服务提供商，涵盖 K12、留学、职业教育、在线教育等领域',
  products: [
    { name: '新东方在线', description: '在线教育平台，提供 K12、雅思、托福等课程', category: '在线教育', isPrimary: true },
    { name: '新东方前程无忧', description: '职业教育与就业服务', category: '职业教育', isPrimary: false },
  ],
  userPainPoints: ['线下班课时间固定难协调', '名师资源地域分布不均', '课后练习反馈不及时'],
  brandStory: '新东方由俞敏洪于1993年创立，是中国领先的教育培训机构。',
  trustAnchors: ['中国教育行业领军品牌', '全国超过1000家学习中心'],
  brandTone: ['温暖陪伴', '专业师资', '积极向上'],
};

// 3. 调 rebuildKnowledgeBase（模拟 profile-review 路由里的逻辑）
const v2 = rebuildKnowledgeBase(v1.sessionData, materials);

console.log('\n【v2】profile-review 全量更新后（自动重编译）');
console.log(`  条目数: ${v2.knowledgeBase.documents.length}（应与 v1 相同，因为 materials 相同）`);
const firstDoc = v2.knowledgeBase.documents[0];
console.log(`  sections[0].heading: ${firstDoc?.sections?.[0]?.heading ?? 'N/A'}`);
console.log(`  sections[0].bullets[0]: ${firstDoc?.sections?.[0]?.bullets?.[0] ?? 'N/A'}`);
console.log(`  keyFacts: ${firstDoc?.keyFacts?.length ?? 0} 条`);
console.log(`  含新产品名 新东方在线: ${JSON.stringify(firstDoc?.sections).includes('新东方在线')}`);
console.log(`  含新行业 在线教育: ${JSON.stringify(firstDoc?.sections).includes('在线教育')}`);
console.log(`  含新痛点 线下班课: ${JSON.stringify(firstDoc?.sections).includes('线下班课')}`);
console.log(`  含旧产品名 FocusGPT: ${JSON.stringify(firstDoc?.sections).includes('FocusGPT')}`);

// 4. 断言
const assertions = [
  // materials 用的是已生成的全部文档标题，所以条目数 = 传入 titles + requiredDocs，变化是正常的
  { label: '条目数已重建（非空）', pass: v2.knowledgeBase.documents.length > 0 },
  { label: 'sections 已用新 enterprise 编译（含 新东方在线）', pass: JSON.stringify(firstDoc?.sections).includes('新东方在线') },
  { label: 'sections 已切换到新行业（在线教育）', pass: JSON.stringify(firstDoc?.sections).includes('在线教育') },
  { label: '旧产品名 FocusGPT 已清除', pass: !JSON.stringify(firstDoc?.sections).includes('FocusGPT') },
  { label: 'promotionGoal 也重编译了', pass: v2.promotionGoal.productName === '新东方在线' },
  { label: 'platforms 也重编译了', pass: v2.platforms.length > 0 },
  { label: '标签也重编译了（含新东方品牌词）', pass: v2.knowledgeBase.tags.some((t) => t.name.includes('新东方')) },
];

let failed = 0;
console.log('\n【断言结果】');
assertions.forEach((a) => {
  console.log(`${a.pass ? '✓' : '✗'} ${a.label}`);
  if (!a.pass) failed++;
});
console.log(failed === 0 ? '\nP2 重编译链路全部通过' : `\n${failed} 项失败`);
process.exit(failed > 0 ? 1 : 0);
