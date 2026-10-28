import Database from 'better-sqlite3';
const db = new Database('/home/ubuntu/geo-assistant-clean/apps/data/geo-assistant.db', { readonly: true });

// Get run timing
const run = db.prepare("SELECT * FROM pipeline_runs WHERE id = 'run_1792739797505_zhys95'").get();
console.log('Run:', JSON.stringify({ id: run.id, started: run.started_at, completed: run.completed_at, total: run.total_articles, completed: run.completed_articles }, null, 2));

// Articles created during this run window + session match
const arts = db.prepare(`
  SELECT title, platform, word_count, content_markdown, generation_meta, created_at
  FROM articles
  WHERE session_id = ? AND created_at >= ? AND created_at <= ?
  ORDER BY created_at ASC
`).all(run.session_id, run.started_at, run.completed_at);

console.log(`\n=== Articles created during run window (${arts.length}) ===`);

const modelCount = {};
for (const a of arts) {
  try {
    const m = JSON.parse(a.generation_meta || '{}');
    modelCount[m.model] = (modelCount[m.model] || 0) + 1;
    
    // Brand density check
    const brandTerms = ['新途', '芯图', '漳州新途', 'XTAUTO', 'xintu'];
    let brandCount = 0;
    for (const term of brandTerms) {
      brandCount += (a.content_markdown?.match(new RegExp(term, 'gi')) || []).length;
    }
    const wc = a.word_count || 1;
    const density = (brandCount / wc * 1000).toFixed(2);
    const ctaHard = /联系我们|扫码咨询|立即试用|免费获取|点击了解|立即咨询|获取方案|微信/.test(a.content_markdown || '');
    const unsourcedNums = /\d+%|\d+倍|\d+用户|\d+家企业/.test(a.content_markdown || '');
    
    console.log(`\n--- ${a.title?.slice(0, 50)} (${a.platform}) ---`);
    console.log(`  model=${m.model} wc=${wc} durMs=${m.durationMs}`);
    console.log(`  brandMentions=${brandCount} density=${density}/1000words`);
    console.log(`  hardCTA=${ctaHard} unsourcedNums=${unsourcedNums}`);
    if (parseFloat(density) > 5) console.log(`  ⚠️ DENSITY > 5/1000`);
    
    // Show first 300 chars of content
    console.log(`  content_preview: ${a.content_markdown?.slice(0, 200) || '(none)'}`);
  } catch(e) { console.log(`  parse error: ${e.message}`); }
}

console.log(`\n=== MODEL SUMMARY ===`);
console.log(JSON.stringify(modelCount, null, 2));
console.log(`\nLLM success (deepseek-chat): ${modelCount['deepseek-chat'] === arts.length ? '✅ ALL' : modelCount['deepseek-chat'] + '/' + arts.length}`);

db.close();
