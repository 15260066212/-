#!/bin/bash
set -e
fuser -k 9527/tcp 2>/dev/null || true
sleep 1

# 先检查 CLI 能不能读到环境变量
TOKEN="9251ae04-5fc5-4549-badb-2f0fc8106571"
echo "=== testing CLI with TOKEN=$TOKEN ==="

# 用 node 直接验证环境变量
WECHATSYNC_TOKEN="$TOKEN" node -e "process.stdout.write('NODE sees: ' + process.env.WECHATSYNC_TOKEN + '\n')"

echo "=== run CLI ==="
WECHATSYNC_TOKEN="$TOKEN" timeout 25 wechatsync ls 2>&1
echo "=== exit: $? ==="
