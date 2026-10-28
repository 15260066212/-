#!/bin/bash
set +e
TOKEN="9251ae04-5fc5-4549-badb-2f0fc8106571"

echo "=== kill old CLI ==="
fuser -k 9527/tcp 2>/dev/null || true
sleep 1

echo "=== chrome alive? ==="
ps aux | grep -v grep | grep 'chrome-linux64/chrome --no-sandbox.*wechatsync' | head -1

echo ""
echo "=== run CLI with token: $TOKEN ==="
WECHATSYNC_TOKEN="$TOKEN" timeout 45 wechatsync ls 2>&1
echo ""
echo "=== done exit: $? ==="
