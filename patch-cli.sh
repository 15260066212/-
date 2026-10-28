#!/bin/bash
# Patch CLI to hardcode the extension token
set -e
CLI_DIST=/usr/lib/node_modules/@wechatsync/cli/dist/index.js
TOKEN="9251ae04-5fc5-4549-badb-2f0fc8106571"
echo "=== patching CLI ==="
# 替换环境变量读取为直接硬编码
sudo cp $CLI_DIST ${CLI_DIST}.bak
sudo sed -i "s|token = process.env.WECHATSYNC_TOKEN || process.env.MCP_TOKEN || \"\";|token = \"$TOKEN\"; // patched hardcoded|" $CLI_DIST
echo "=== verify patch ==="
grep -n "token.*patched\|hardcoded\|9251ae" $CLI_DIST
echo "=== cleanup port and run ==="
fuser -k 9527/tcp 2>/dev/null || true
sleep 1
timeout 25 wechatsync ls 2>&1
