#!/bin/bash
echo "=== geo-assistant 环境变量中的 harvester 相关 ==="
pm2 env 86 2>&1 | grep -i "harvester" || echo "(未找到)"
pm2 env 86 2>&1 | grep -i "rpa" || echo "(未找到 RPA)"

echo ""
echo "=== 测试 harvester 连通性 ==="
echo -n "localhost:3003: "
curl -s -o /dev/null -w "%{http_code}" http://localhost:3003/api/platforms
echo ""

echo ""
echo "=== geo-assistant 启动脚本/ecosystem ==="
ls -la /home/ubuntu/geo-assistant-clean/apps/server/ecosystem.config.js 2>/dev/null && echo "存在 ecosystem.config.js" || echo "无 ecosystem.config.js"
