#!/bin/bash
set -e

APP=/home/ubuntu/geo-assistant-clean
TS=$(date +%Y%m%d-%H%M%S)

echo "[1/5] Backup current dists..."
cp -r $APP/packages/ai-engine/dist $APP/packages/ai-engine/dist.bak.$TS
cp -r $APP/apps/server/dist $APP/apps/server/dist.bak.$TS
cp -r $APP/apps/web/dist $APP/apps/web/dist.bak.$TS

echo "[2/5] Extract new dists..."
cd /tmp
rm -rf geo-deploy-docx
mkdir -p geo-deploy-docx
tar -xzf /tmp/geo-deploy-docx.tar.gz -C geo-deploy-docx
rm -rf $APP/packages/ai-engine/dist
rm -rf $APP/apps/server/dist
rm -rf $APP/apps/web/dist
cp -r /tmp/geo-deploy-docx/packages/ai-engine/dist $APP/packages/ai-engine/dist
cp -r /tmp/geo-deploy-docx/apps/server/dist $APP/apps/server/dist
cp -r /tmp/geo-deploy-docx/apps/web/dist $APP/apps/web/dist

echo "[3/5] Verify new code present..."
grep -q "analyzeDocxContent" $APP/packages/ai-engine/dist/index.js && echo "  ai-engine: OK (analyzeDocxContent exported)" || { echo "  ai-engine: MISSING export"; exit 1; }
grep -q "import-docx" $APP/apps/server/dist/routes/import.js && echo "  server: OK (import-docx route)" || { echo "  server: MISSING route"; exit 1; }
grep -q "Word" $APP/apps/web/dist/assets/*.js && echo "  web: OK (Word import in bundle)" || { echo "  web: MISSING button"; exit 1; }

echo "[4/5] Restart geo-assistant..."
pm2 restart geo-assistant --update-env
sleep 4

echo "[5/5] Health check..."
pm2 describe geo-assistant | grep -E 'status|uptime' | head -4
curl -sf http://localhost:3000/api/health && echo "" && echo "HEALTH OK" || echo "HEALTH CHECK FAILED (check pm2 logs)"

echo "Done. Backups at dist.bak.$TS"
