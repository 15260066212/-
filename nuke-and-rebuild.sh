#!/bin/bash
set +e

# 彻底杀掉所有 chrome 相关进程（包括 Service Worker）
echo "=== 1. KILL EVERYTHING ==="
pkill -9 -f 'chrome-linux64' 2>/dev/null
sleep 2
# 确认全没了
ps aux | grep -v grep | grep chrome && echo "STILL RUNNING" || echo "ALL DEAD"

# 确认 patch 内容
echo ""
echo "=== 2. verify patch ==="
# 找 patch 后的处理函数
grep -o '.{0,200}handleMessage.{0,300}' /home/ubuntu/wechatsync-ext/assets/index.ts-Bw-475TG.js | head -1

# 清空 CLI 硬编码的 token（patch 里设成了扩展 token，但扩展的 token 可能不是那个值）
echo ""
echo "=== 3. reset CLI token to empty ==="
# 先备份原来的 patch
sudo cp /usr/lib/node_modules/@wechatsync/cli/dist/index.js.bak /usr/lib/node_modules/@wechatsync/cli/dist/index.js.bak3 2>/dev/null
# 然后把 token 改成空（CLI 不发 token）
sudo python3 -c "
import re
path = '/usr/lib/node_modules/@wechatsync/cli/dist/index.js'
with open(path) as f:
    content = f.read()
# 把之前的 hardcoded token patch 回退成空
old = 'token = \"9251ae04-5fc5-4549-badb-2f0fc8106571\"; // patched hardcoded'
new = 'token = \"\"; // reset empty'
content = content.replace(old, new)
with open(path, 'w') as f:
    f.write(content)
print('CLI token reset to empty')
"
grep 'token = ' /usr/lib/node_modules/@wechatsync/cli/dist/index.js | head -2

echo ""
echo "=== 4. start chrome FRESH ==="
DISPLAY=:99 setsid nohup /home/ubuntu/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome \
  --no-sandbox --disable-setuid-sandbox --disable-blink-features=AutomationControlled \
  --no-first-run --no-default-browser-check --disable-background-networking --disable-default-apps \
  --user-data-dir=/home/ubuntu/geo-assistant-clean/harvester/data/browser-profiles/chrome-wechatsync \
  --load-extension=/home/ubuntu/wechatsync-ext > /tmp/ws-chrome.log 2>&1 &
sleep 6
ps aux | grep -v grep | grep 'chrome-linux64/chrome --no-sandbox.*wechatsync' | head -1

echo ""
echo "=== 5. wait for you to toggle Bridge ==="
sleep 25

echo ""
echo "=== 6. run CLI (no token at all) ==="
fuser -k 9527/tcp 2>/dev/null || true
sleep 1
timeout 30 wechatsync ls 2>&1
echo ""
echo "=== DONE ==="
