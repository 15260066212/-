import Database from 'better-sqlite3';
const db = new Database('/home/ubuntu/geo-assistant-clean/apps/data/geo-assistant.db', { readonly: true });

const SESSION = 'session_1792655033074_ij2g9s';
const RUN_ID = 'run_1792739797505_zhys95';

console.log('=== Q1: MODEL DISTRIBUTION for this pipeline run ===');
const arts = db.prepare(`
  SELECT a.title, a.platform, a.word_count, a.content_markdown, a.generation_meta
  FROM articles a
  JOIN pipeline_runs r ON a.session_id = r.session_id
  WHERE r.id = ?
  ORDER BY a.created_at ASC
`).all(RUN_ID);

console.log(`Articles from run ${RUN_ID}: ${arts.length}`);

const models = {};
for (const a of arts) {
  try {
    const m = JSON.parse(a.generation_meta || '{}');
    models[m.model] = (models[m.model] || 0) + 1;
    console.log(`  [${m.model}] ${a.platform} | wc=${a.word_count} | dur=${m.durationMs}ms | tokens=${m.tokensUsed} | ${a.title?.slice(0,40)}`);
  } catch { console.log(`  [parse error]`); }
}
console.log(`\nModel distribution: ${JSON.stringify(models)}`);
console.log(`LLM success: ${models['deepseek-chat'] ? 'YES ✅' : 'NO ❌'}`);

console.log('\n=== Q4: BRAND DENSITY CHECK ===');
const brandTerms = ['新途', '芯图', '漳州新途', 'Xintu', 'xintu'];
for (const a of arts) {
  let brandCount = 0;
  for (const term of brandTerms) {
    const matches = a.content_markdown?.match(new RegExp(term, 'gi')) || [];
    brandCount += matches.length;
  }
  const wc = a.word_count || 1;
  const density = (brandCount / wc * 1000).toFixed(2);
  const ctaHard = /联系我们|扫码咨询|立即试用|免费获取|点击了解|立即咨询|获取方案/.test(a.content_markdown || '');
  const numbersNoSrc = /\d+%|\d+倍|\d+用户|\d+家企业/.test(a.content_markdown || '');
  console.log(`  ${a.title?.slice(0,40)}`);
  console.log(`    brandMentions=${brandCount} density=${density}/1000words ctaHard=${ctaHard} numbersNoSrc=${numbersNoSrc}`);
  if (parseFloat(density) > 5) console.log(`    ⚠️ DENSITY TOO HIGH (>5/1000)`);
  if (ctaHard) console.log(`    ⚠️ HARD CTA DETECTED`);
  if (numbersNoSrc) console.log(`    ⚠️ UNSOURCED NUMBERS`);
}

console.log('\n=== FULL ARTICLE CONTENT SAMPLE (first 500 chars of article 1) ===');
if (arts.length > 0) {
  console.log(arts[0].content_markdown?.slice(0, 500) || '(no content)');
}

db.close();
