#!/bin/bash
echo "=== manifest background ==="
grep -A5 'background\|service_worker' /home/ubuntu/wechatsync-ext/manifest.json
echo ""
echo "=== token check across ALL js files ==="
find /home/ubuntu/wechatsync-ext -name '*.js' ! -name '*.map' -exec grep -l 'MCP token not configured\|Invalid or missing token' {} \;
echo ""
echo "=== background candidates ==="
ls /home/ubuntu/wechatsync-ext/background* 2>/dev/null
ls /home/ubuntu/wechatsync-ext/assets/background* 2>/dev/null
ls /home/ubuntu/wechatsync-ext/sw* 2>/dev/null
ls /home/ubuntu/wechatsync-ext/service* 2>/dev/null
echo ""
echo "=== service-worker-loader ==="
head -30 /home/ubuntu/wechatsync-ext/service-worker-loader.js
