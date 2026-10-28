#!/bin/bash
RUN_ID="run_1792739503526_o4hfdq"
echo "=== Polling $RUN_ID (up to 90s) ==="
for i in $(seq 1 30); do
  STATUS=$(curl -s "http://localhost:3000/api/pipeline/run/$RUN_ID")
  COMPLETED=$(echo "$STATUS" | grep -o '"completedArticles":[0-9]*' | grep -o '[0-9]*')
  TOTAL=$(echo "$STATUS" | grep -o '"totalArticles":[0-9]*' | grep -o '[0-9]*')
  STAT=$(echo "$STATUS" | grep -o '"status":"[a-z]*"' | cut -d'"' -f4)
  echo "[${i}x3s] status=$STAT completed=$COMPLETED/$TOTAL"
  echo "$STATUS" | grep -q '"status":"completed"' && echo "=== DONE ===" && break
  echo "$STATUS" | grep -q '"status":"failed"' && echo "=== FAILED ===" && break
  sleep 3
done

echo ""
echo "=== ERROR LOG (recent LLM-related) ==="
grep -i 'ai\|llm\|deepseek\|generate\|fallback\|extractJSON\|ContentGenerator' /home/ubuntu/.pm2/logs/geo-assistant-error.log | tail -10
echo ""
echo "=== DB CHECK ==="
cd /home/ubuntu/geo-assistant-clean/apps/server && node --input-type=module -e "
import Database from 'better-sqlite3';
const db = new Database('/home/ubuntu/geo-assistant-clean/apps/data/geo-assistant.db', { readonly: true });
const arts = db.prepare(\"SELECT title, platform, generation_meta, word_count FROM articles WHERE session_id='session_1792655033074_ij2g9s' ORDER BY created_at DESC LIMIT 5\").all();
for (const a of arts) {
  try {
    const m = JSON.parse(a.generation_meta || '{}');
    console.log(JSON.stringify({ title: a.title?.slice(0,35), platform: a.platform, model: m.model, tokens: m.tokensUsed, durMs: m.durationMs, wc: a.word_count }));
  } catch { console.log('parse error'); }
}
db.close();
"
