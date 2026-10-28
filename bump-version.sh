#!/bin/bash
set -e

# Bump extension version to force Chrome to recompile patched JS
cd /home/ubuntu/wechatsync-ext
python3 -c "
import json
with open('manifest.json') as f:
    m = json.load(f)
old = m['version']
m['version'] = old + '-patched'
with open('manifest.json', 'w') as f:
    json.dump(m, f, indent=2)
print(f'Version bumped: {old} -> {m[\"version\"]}')
"

# Also clear any compiled/cached extension stuff in profile
PROFILE=/home/ubuntu/geo-assistant-clean/harvester/data/browser-profiles/chrome-wechatsync
echo ""
echo "=== clearing extension caches in profile ==="
rm -rf $PROFILE/Default/Service\ Worker/CacheStorage/ 2>/dev/null || true
rm -rf $PROFILE/Default/Service\ Worker/ScriptCache/ 2>/dev/null || true
rm -rf $PROFILE/Default/Code\ Cache/ 2>/dev/null || true
rm -rf $PROFILE/Default/Extensions/*/ 2>/dev/null || true
rm -rf $PROFILE/Default/IndexedDB/*wechatsync* 2>/dev/null || true
echo "caches cleared"

echo ""
echo "=== KILL chrome ==="
pkill -9 -f 'chrome-linux64' 2>/dev/null
sleep 2
ps aux | grep -v grep | grep chrome && echo "STILL ALIVE" || echo "ALL DEAD"

echo ""
echo "=== restart chrome ==="
DISPLAY=:99 setsid nohup /home/ubuntu/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome \
  --no-sandbox --disable-setuid-sandbox --disable-blink-features=AutomationControlled \
  --no-first-run --no-default-browser-check --disable-background-networking --disable-default-apps \
  --user-data-dir=$PROFILE \
  --load-extension=/home/ubuntu/wechatsync-ext > /tmp/ws-chrome.log 2>&1 &
sleep 6
ps aux | grep -v grep | grep 'chrome-linux64/chrome --no-sandbox.*wechatsync' | head -1
echo ""
echo "=== manifest now ==="
grep '"version"' /home/ubuntu/wechatsync-ext/manifest.json
