#!/bin/bash
set +e

echo "=== 1. patch extension ==="
sudo python3 /tmp/patch-ext.py

echo ""
echo "=== 2. kill chrome ==="
pkill -f '/chrome-linux64/chrome --no-sandbox.*wechatsync' 2>/dev/null
sleep 2

echo ""
echo "=== 3. restart chrome ==="
DISPLAY=:99 setsid nohup /home/ubuntu/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome \
  --no-sandbox --disable-setuid-sandbox --disable-blink-features=AutomationControlled \
  --no-first-run --no-default-browser-check --disable-background-networking --disable-default-apps \
  --user-data-dir=/home/ubuntu/geo-assistant-clean/harvester/data/browser-profiles/chrome-wechatsync \
  --load-extension=/home/ubuntu/wechatsync-ext > /tmp/ws-chrome.log 2>&1 &
sleep 5
ps aux | grep -v grep | grep 'chrome-linux64/chrome --no-sandbox.*wechatsync' | head -1

echo ""
echo "=== 4. wait for user to re-toggle Bridge in VNC ==="
echo "*** NOW GO TO noVNC and toggle Bridge switch OFF then ON ***"
echo "*** THEN COME BACK AND THIS SCRIPT WILL WAIT FOR YOU ***"

for i in 1 2 3 4 5 6; do
  sleep 10
  echo "--- waiting... tick $i ---"
  ss -tlnp 2>/dev/null | grep 9527 || echo "9527 not open yet (CLI not started)"
done

echo ""
echo "=== 5. run wechatsync ls ==="
fuser -k 9527/tcp 2>/dev/null || true
sleep 1
timeout 30 wechatsync ls 2>&1

echo ""
echo "=== done ==="
