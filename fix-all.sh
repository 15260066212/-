#!/bin/bash
set -e

# Step 1: Fix manifest.json - version must be pure numbers
python3 -c "
import json
with open('/home/ubuntu/wechatsync-ext/manifest.json') as f:
    m = json.load(f)
m['version'] = '2.0.10'  # pure number
with open('/home/ubuntu/wechatsync-ext/manifest.json', 'w') as f:
    json.dump(m, f, indent=2)
print('manifest version fixed to 2.0.10')
"

# Step 2: Restore patched extension JS from backup
EXT_JS=/home/ubuntu/wechatsync-ext/assets/index.ts-Bw-475TG.js
if [ -f "${EXT_JS}.bak" ]; then
  cp "${EXT_JS}.bak" "$EXT_JS"
  echo "Restored extension JS from .bak"
else
  echo "WARNING: no .bak found for extension JS"
fi

# Step 3: Restore CLI from backup
CLI_JS=/usr/lib/node_modules/@wechatsync/cli/dist/index.js
if [ -f "${CLI_JS}.bak" ]; then
  sudo cp "${CLI_JS}.bak" "$CLI_JS"
  echo "Restored CLI from .bak"
elif [ -f "${CLI_JS}.bak3" ]; then
  sudo cp "${CLI_JS}.bak3" "$CLI_JS"
  echo "Restored CLI from .bak3"
else
  echo "WARNING: no CLI backup found"
fi

# Step 4: Clear all caches
rm -rf /home/ubuntu/geo-assistant-clean/harvester/data/browser-profiles/chrome-wechatsync/Default/Service\ Worker/ 2>/dev/null || true
rm -rf /home/ubuntu/geo-assistant-clean/harvester/data/browser-profiles/chrome-wechatsync/Default/Code\ Cache/ 2>/dev/null || true
echo "caches cleared"

# Step 5: Kill Chrome and restart
pkill -9 -f 'chrome-linux64' 2>/dev/null
sleep 2
echo "=== killing chrome ==="

DISPLAY=:99 setsid nohup /home/ubuntu/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome \
  --no-sandbox --disable-setuid-sandbox --disable-blink-features=AutomationControlled \
  --no-first-run --no-default-browser-check --disable-background-networking --disable-default-apps \
  --user-data-dir=/home/ubuntu/geo-assistant-clean/harvester/data/browser-profiles/chrome-wechatsync \
  --load-extension=/home/ubuntu/wechatsync-ext > /tmp/ws-chrome.log 2>&1 &
sleep 6

echo ""
echo "=== chrome now running ==="
ps aux | grep -v grep | grep 'chrome-linux64/chrome --no-sandbox.*wechatsync' | head -1

echo ""
echo "=== manifest version now ==="
grep '"version"' /home/ubuntu/wechatsync-ext/manifest.json

echo ""
echo "=== EXTENSION JS TOKEN CHECK RESTORED? ==="
grep -c 'MCP token not configured' /home/ubuntu/wechatsync-ext/assets/index.ts-Bw-475TG.js && echo "YES - token check restored" || echo "NO - still patched!"

echo ""
echo "=== CLI TOKEN RESTORED? ==="
grep -c 'WECHATSYNC_TOKEN' /usr/lib/node_modules/@wechatsync/cli/dist/index.js && echo "YES - env var reading restored" || echo "NO!"

echo ""
echo "=== DONE ==="
