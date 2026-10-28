#!/bin/bash
# 路线 B: headed Chromium + WechatSync 扩展 + noVNC 可操作
set -e

echo "=== step 1: cleanup ==="
sudo killall chrome 2>/dev/null || true
sudo killall Xvfb 2>/dev/null || true
pkill -f 'chrome.*wechatsync' 2>/dev/null || true
sleep 1

echo "=== step 2: start Xvfb ==="
Xvfb :99 -screen 0 1920x1080x24 &
XVFB_PID=$!
sleep 2
export DISPLAY=:99
echo "Xvfb PID=$XVFB_PID on :99"

echo "=== step 3: generate token ==="
TOKEN=$(openssl rand -hex 16)
echo "WECHATSYNC_TOKEN=$TOKEN"
echo "$TOKEN" > /tmp/wechatsync-token.txt
echo "token saved to /tmp/wechatsync-token.txt"

echo "=== step 4: check noVNC ==="
if ! pgrep -x websockify > /dev/null; then
  echo "Starting noVNC websockify on :6080"
  which websockify > /dev/null || sudo apt-get install -y novnc websockify 2>&1 | tail -3
  sudo websockify -D --web=/usr/share/novnc 6080 localhost:5900 2>&1 | head -3
  # Wait and check if started
  sleep 2
  if ! sudo pgrep -x websockify > /dev/null; then
    echo "WARNING: websockify didn't start, trying alternative..."
    sudo websockify -D --web=/usr/share/novnc 6080 localhost:5900 &
  fi
fi
# Check if VNC server is already there (harvester RPA_HEADLESS=false might already have one)
if ! pgrep -x Xvfb 2>/dev/null; then
  Xvfb :5900 -screen 0 1920x1080x24 &
  sleep 1
fi

echo "=== step 5: launch headed Chromium ==="
CHROME=/home/ubuntu/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome
PROFILE=/home/ubuntu/geo-assistant-clean/harvester/data/browser-profiles/chrome-wechatsync
rm -rf /tmp/ws-chrome.log
mkdir -p "$PROFILE"

setsid nohup $CHROME \
  --no-sandbox \
  --disable-setuid-sandbox \
  --disable-blink-features=AutomationControlled \
  --no-first-run \
  --no-default-browser-check \
  --disable-background-networking \
  --disable-default-apps \
  --user-data-dir="$PROFILE" \
  --load-extension=/home/ubuntu/wechatsync-ext \
  > /tmp/ws-chrome.log 2>&1 &
CHROME_PID=$!
sleep 5

echo "=== chrome processes ==="
ps aux | grep chrome | grep -v grep | head -3

echo "=== ports listening ==="
ss -tlnp 2>/dev/null | grep -E '9527|6080|5900' || netstat -tlnp 2>/dev/null | grep -E '9527|6080|5900' || true

echo ""
echo "=== NO-VNC CONNECT INFO ==="
echo "Open in browser: http://49.232.131.195:6080/vnc.html?autoconnect=true"
echo "Token (paste into WechatSync extension settings): $TOKEN"
echo "Chrome user data dir: $PROFILE"
echo ""
echo "=== NEXT STEPS YOU DO IN VNC ==="
echo "1. Click WechatSync extension icon (top-right puzzle piece)"
echo "2. Click settings/gear icon"
echo "3. Enable 'Bridge' or 'Sync Bridge'"
echo "4. Paste the token above and save"
echo "5. Login to all platforms (zhihu/csdn/juejin/toutiao)"
echo ""
echo "=== TOKEN FILE ==="
cat /tmp/wechatsync-token.txt
