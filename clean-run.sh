#!/bin/bash
set +e

echo "=== 1. what's on 9527 ==="
ss -tlnp | grep 9527 || echo "9527 free"

echo ""
echo "=== 2. kill anything on 9527 ==="
fuser -k 9527/tcp 2>/dev/null
sleep 2
ss -tlnp | grep 9527 || echo "9527 now free"

echo ""
echo "=== 3. make sure chrome still alive ==="
ps aux | grep -v grep | grep 'chrome-linux64/chrome --no-sandbox.*wechatsync' | head -1

echo ""
echo "=== 4. run CLI (PRIMARY mode, wait for extension) ==="
timeout 40 wechatsync ls 2>&1
echo ""
echo "=== DONE exit: $? ==="
