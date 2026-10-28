#!/bin/bash
set +e
echo "=== 1. verify patch is complete ==="
grep -c 'MCP token not configured\|Invalid or missing token' /home/ubuntu/wechatsync-ext/assets/index.ts-Bw-475TG.js && echo "STILL EXISTS!" || echo "PATCHED OK - token checks gone"
echo ""
echo "=== 2. KILL ALL CHROME PROCESSES ==="
pkill -9 -f '/chrome-linux64/chrome' 2>/dev/null
sleep 3
ps aux | grep -v grep | grep chrome | grep -v crasher
echo ""
echo "=== 3. restart chrome FRESH ==="
DISPLAY=:99 setsid nohup /home/ubuntu/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome \
  --no-sandbox --disable-setuid-sandbox --disable-blink-features=AutomationControlled \
  --no-first-run --no-default-browser-check --disable-background-networking --disable-default-apps \
  --user-data-dir=/home/ubuntu/geo-assistant-clean/harvester/data/browser-profiles/chrome-wechatsync \
  --load-extension=/home/ubuntu/wechatsync-ext > /tmp/ws-chrome.log 2>&1 &
sleep 6
echo "=== chrome now running ==="
ps aux | grep -v grep | grep 'chrome-linux64/chrome --no-sandbox.*wechatsync' | head -1
echo ""
echo "=== 4. wait for you to toggle Bridge in VNC ==="
echo "*** GO TO VNC AND TOGGLE BRIDGE OFF THEN ON ***"
sleep 20
echo ""
echo "=== 5. run CLI ==="
fuser -k 9527/tcp 2>/dev/null || true
sleep 1
timeout 30 wechatsync ls 2>&1
echo ""
echo "=== DONE ==="
