#!/bin/bash
echo "=== node-agent 进程详情 ==="
pm2 show node-agent 2>&1 | grep -E "script path|exec cwd|status|version" | head -5

echo ""
echo "=== node-agent 脚本内容（前30行） ==="
NODE_AGENT_SCRIPT=$(pm2 describe node-agent 2>&1 | grep "script path" | awk '{print $NF}')
echo "Script: $NODE_AGENT_SCRIPT"
if [ -f "$NODE_AGENT_SCRIPT" ]; then
  head -30 "$NODE_AGENT_SCRIPT"
fi

echo ""
echo "=== 前端 index.html ==="
cat /home/ubuntu/geo-assistant-clean/apps/web/dist/index.html | head -20

echo ""
echo "=== 前端 JS 资源 ==="
ls /home/ubuntu/geo-assistant-clean/apps/web/dist/assets/ | head -10

echo ""
echo "=== 前端 JS 中是否包含 NodeManagement ==="
grep -l "NodeManagement\|节点管理" /home/ubuntu/geo-assistant-clean/apps/web/dist/assets/*.js 2>/dev/null | head -3
