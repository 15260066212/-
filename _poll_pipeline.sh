#!/bin/bash
RUN_ID="run_1792739269656_gvmwy7"
echo "=== Polling pipeline $RUN_ID ==="
for i in $(seq 1 20); do
  STATUS=$(curl -s "http://localhost:3000/api/pipeline/run/$RUN_ID")
  echo "[poll $i] $(date '+%H:%M:%S') -> $STATUS"
  echo "$STATUS" | grep -q '"status":"completed"' && echo "=== COMPLETED ===" && break
  echo "$STATUS" | grep -q '"status":"failed"' && echo "=== FAILED ===" && break
  sleep 3
done
echo ""
echo "=== DB CHECK: recent articles ==="
cd /home/ubuntu/geo-assistant-clean/apps/server && node -e "
import Database from 'better-sqlite3';
const db = new Database('/home/ubuntu/geo-assistant-clean/apps/data/geo-assistant.db', { readonly: true });
const arts = db.prepare('SELECT title, platform, generation_meta FROM articles WHERE session_id=\"session_1792655033074_ij2g9s\" ORDER BY created_at DESC LIMIT 8').all();
for (const a of arts) {
  try {
    const m = JSON.parse(a.generation_meta || '{}');
    console.log(JSON.stringify({ title: a.title?.slice(0,40), platform: a.platform, model: m.model, durationMs: m.durationMs, tokens: m.tokensUsed }));
  } catch {}
}
db.close();
" --input-type=module
