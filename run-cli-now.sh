#!/bin/bash
set +e
fuser -k 9527/tcp 2>/dev/null || true
sleep 1
echo "=== starting CLI (waiting for extension) ==="
timeout 120 wechatsync ls 2>&1
echo ""
echo "=== done, exit: $? ==="
