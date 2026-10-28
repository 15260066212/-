#!/bin/bash
echo "=== harvester 环境变量 ==="
pm2 env 88 2>&1 | grep -E "NODE_AGENT|NODE_ID|NODE_NAME|MAIN_SERVER" | head -10

echo ""
echo "=== 节点列表 API ==="
curl -s http://localhost:3000/api/nodes/ | head -c 600
echo ""

echo ""
echo "=== 前端构建目录 ==="
ls -la /home/ubuntu/geo-assistant-clean/apps/web/dist/ 2>&1 | head -5

echo ""
echo "=== node-agent 进程 ==="
pm2 status node-agent 2>&1 | head -10

echo ""
echo "=== harvester 是否加载了 node-agent ==="
grep -c "node-agent\|NodeAgent" /home/ubuntu/geo-assistant-clean/harvester/server.js 2>/dev/null || echo "Not found in harvester/server.js"
