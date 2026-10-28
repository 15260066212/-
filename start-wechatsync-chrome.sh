#!/bin/bash
set -e
sudo killall Xvfb 2>/dev/null || true
sudo killall chrome 2>/dev/null || true
sleep 1
Xvfb :99 -screen 0 1920x1080x24 &
XVFB_PID=$!
sleep 2
export DISPLAY=:99
CHROME=/home/ubuntu/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome
echo "chrome version: $($CHROME --version)"
mkdir -p /home/ubuntu/geo-assistant-clean/harvester/data/browser-profiles/chrome-wechatsync
setsid nohup $CHROME \
  --no-sandbox \
  --disable-setuid-sandbox \
  --headless=new \
  --disable-blink-features=AutomationControlled \
  --user-data-dir=/home/ubuntu/geo-assistant-clean/harvester/data/browser-profiles/chrome-wechatsync \
  --load-extension=/home/ubuntu/wechatsync-ext \
  > /tmp/ws-chrome.log 2>&1 &
sleep 6
echo "=== chrome processes ==="
ps aux | grep chrome | grep -v grep | head -5
echo "=== last log ==="
tail -15 /tmp/ws-chrome.log
echo "=== extension profile contents ==="
ls /home/ubuntu/geo-assistant-clean/harvester/data/browser-profiles/chrome-wechatsync/ 2>/dev/null | head
