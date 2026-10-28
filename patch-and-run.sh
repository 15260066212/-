#!/bin/bash
set +e
echo "=== step 1: python patch ==="
sudo python3 /tmp/patch-cli.py
echo ""
echo "=== step 2: verify CLI ==="
fuser -k 9527/tcp 2>/dev/null || true
sleep 1
echo "=== step 3: run wechatsync ls ==="
timeout 25 wechatsync ls 2>&1
echo ""
echo "=== done ==="
