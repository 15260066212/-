#!/bin/bash
# Run CLI in foreground waiting for extension connection
set +e

# Kill any old CLI
fuser -k 9527/tcp 2>/dev/null || true
sleep 1

echo "=== Starting CLI (waiting for extension to connect) ==="
echo "=== Now please go to noVNC and toggle Bridge switch! ==="
echo ""

WECHATSYNC_TOKEN="" timeout 120 wechatsync ls 2>&1
EXIT=$?

echo ""
echo "=== CLI exited with code $EXIT ==="
ss -tlnp | grep 9527 || echo "9527 free now"
