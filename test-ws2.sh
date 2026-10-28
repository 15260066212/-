#!/bin/bash
set +e
fuser -k 9527/tcp 2>/dev/null || true
sleep 1
TOKEN="9251ae04-5fc5-4549-badb-2f0fc8106571"
echo "=== Starting CLI with token: $TOKEN ==="
WECHATSYNC_TOKEN="$TOKEN" timeout 30 wechatsync ls 2>&1
echo "=== done ==="
