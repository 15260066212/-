#!/bin/bash
set -e
pkill -f '/chrome-linux64/chrome.*wechatsync' 2>/dev/null || true
sleep 1
DISPLAY=:99 setsid nohup /home/ubuntu/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome \
  --no-sandbox --disable-setuid-sandbox --disable-blink-features=AutomationControlled \
  --no-first-run --no-default-browser-check --disable-background-networking --disable-default-apps \
  --user-data-dir=/home/ubuntu/geo-assistant-clean/harvester/data/browser-profiles/chrome-wechatsync \
  --load-extension=/home/ubuntu/wechatsync-ext > /tmp/ws-chrome.log 2>&1 &
sleep 5
echo "=== chrome running ==="
ps aux | grep -v grep | grep 'chrome-linux64/chrome --no-sandbox.*wechatsync' | head -1
echo "=== now run CLI ==="
fuser -k 9527/tcp 2>/dev/null || true
sleep 1
timeout 30 wechatsync ls 2>&1
