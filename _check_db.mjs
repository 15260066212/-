import Database from 'better-sqlite3';

const db = new Database('/home/ubuntu/geo-assistant-clean/apps/data/geo-assistant.db', { readonly: true });

// Latest sessions
console.log('=== LATEST 5 SESSIONS ===');
const sessions = db.prepare('SELECT session_id, enterprise_full_name, created_at FROM sessions ORDER BY created_at DESC LIMIT 5').all();
console.log(JSON.stringify(sessions, null, 2));

// Latest pipeline runs
console.log('\n=== LATEST 5 PIPELINE RUNS ===');
const runs = db.prepare('SELECT run_id, session_id, status, total_articles, created_at FROM pipeline_runs ORDER BY created_at DESC LIMIT 5').all();
console.log(JSON.stringify(runs, null, 2));

// Latest article generation meta
console.log('\n=== LATEST 3 ARTICLES generationMeta ===');
const arts = db.prepare('SELECT title, generation_meta FROM articles ORDER BY created_at DESC LIMIT 3').all();
for (const a of arts) {
  try {
    const meta = JSON.parse(a.generation_meta || '{}');
    console.log(JSON.stringify({ title: a.title?.slice(0, 50), model: meta.model, tokensUsed: meta.tokensUsed, durationMs: meta.durationMs }, null, 2));
  } catch {
    console.log('(parse error for ' + a.title + ')');
  }
}

// How many articles used deepseek vs fallback
console.log('\n=== MODEL DISTRIBUTION (last 50) ===');
const allArts = db.prepare('SELECT generation_meta FROM articles ORDER BY created_at DESC LIMIT 50').all();
const counts = { deepseek: 0, fallback: 0, other: 0, none: 0 };
for (const a of allArts) {
  if (!a.generation_meta) { counts.none++; continue; }
  try {
    const m = JSON.parse(a.generation_meta);
    if (m.model && m.model.includes('deepseek')) counts.deepseek++;
    else if (m.model && m.model.includes('fallback')) counts.fallback++;
    else counts.other++;
  } catch { counts.none++; }
}
console.log(JSON.stringify(counts, null, 2));

db.close();
