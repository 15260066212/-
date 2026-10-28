import Database from 'better-sqlite3';
const db = new Database('/home/ubuntu/geo-assistant-clean/apps/data/geo-assistant.db', { readonly: true });

// Latest sessions
console.log('=== LATEST 5 SESSIONS ===');
const sessions = db.prepare('SELECT id, data, created_at FROM sessions ORDER BY created_at DESC LIMIT 5').all();
for (const s of sessions) {
  try {
    const d = JSON.parse(s.data || '{}');
    console.log(JSON.stringify({ id: s.id, enterprise: d.enterpriseFullName || d.enterprise_full_name || '(no enterprise)', created_at: s.created_at }, null, 2));
  } catch {
    console.log(JSON.stringify({ id: s.id, data: s.data?.slice(0, 200) }, null, 2));
  }
}

// Latest pipeline runs
console.log('\n=== LATEST 5 PIPELINE RUNS ===');
const runs = db.prepare('SELECT id, session_id, status, total_articles, completed_articles, current_platform, started_at FROM pipeline_runs ORDER BY started_at DESC LIMIT 5').all();
console.log(JSON.stringify(runs, null, 2));

// Latest article generation meta with model distribution
console.log('\n=== MODEL DISTRIBUTION (last 100 articles) ===');
const arts = db.prepare('SELECT generation_meta FROM articles ORDER BY created_at DESC LIMIT 100').all();
const counts = { deepseek: 0, fallback: 0, other: 0, none: 0 };
const sampleDeepseek = [];
const sampleFallback = [];
for (const a of arts) {
  if (!a.generation_meta) { counts.none++; continue; }
  try {
    const m = JSON.parse(a.generation_meta);
    if (m.model && m.model.includes('deepseek')) {
      counts.deepseek++;
      if (sampleDeepseek.length < 2) sampleDeepseek.push(m);
    } else if (m.model && m.model.includes('fallback')) {
      counts.fallback++;
      if (sampleFallback.length < 2) sampleFallback.push(m);
    } else {
      counts.other++;
    }
  } catch { counts.none++; }
}
console.log(JSON.stringify(counts, null, 2));
console.log('\nSample deepseek meta:');
console.log(JSON.stringify(sampleDeepseek, null, 2));
console.log('\nSample fallback meta:');
console.log(JSON.stringify(sampleFallback, null, 2));

// Brand density check on latest deepseek article
console.log('\n=== BRAND DENSITY CHECK ===');
const lastDS = db.prepare("SELECT content_markdown, generation_meta, session_id FROM articles WHERE generation_meta LIKE '%deepseek%' ORDER BY created_at DESC LIMIT 1").get();
if (lastDS) {
  const content = lastDS.content_markdown || '';
  const brandMatch = content.match(/辛图|xintu|Xintu/g);
  const brandCount = brandMatch ? brandMatch.length : 0;
  const wordCount = content.length;
  const density = wordCount > 0 ? (brandCount / wordCount * 1000).toFixed(2) : '0';
  console.log(JSON.stringify({ session_id: lastDS.session_id, contentLength: wordCount, brandMentions: brandCount, densityPer1000: density }, null, 2));
} else {
  console.log('No deepseek articles found');
}

db.close();
