import Database from 'better-sqlite3';
const db = new Database('/home/ubuntu/geo-assistant-clean/apps/data/geo-assistant.db', { readonly: true });

// Get the 2 most recent articles with full generation_meta
console.log('=== RECENT 3 ARTICLES FULL DETAIL ===');
const arts = db.prepare('SELECT id, title, session_id, platform, content_type, generation_meta, word_count, status FROM articles ORDER BY created_at DESC LIMIT 3').all();
for (const a of arts) {
  console.log(JSON.stringify(a, null, 2));
}

// Get the latest pipeline run details
console.log('\n=== LATEST RUN DETAIL ===');
const run = db.prepare('SELECT * FROM pipeline_runs ORDER BY started_at DESC LIMIT 1').get();
console.log(JSON.stringify(run, null, 2));

// Check if there's a preference table or config for LLM fallback
console.log('\n=== CHECK ARTICLES FROM TODAY ===');
const todayArts = db.prepare("SELECT generation_meta FROM articles WHERE date(created_at) = date('now') ORDER BY created_at DESC LIMIT 10").all();
console.log('Today count: ' + todayArts.length);
for (const a of todayArts) {
  try {
    const m = JSON.parse(a.generation_meta || '{}');
    console.log('  model=' + m.model + ' durationMs=' + m.durationMs + ' tokens=' + m.tokensUsed + ' error=' + (m.error || ''));
  } catch {}
}

db.close();
