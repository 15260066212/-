#!/bin/bash
# 测试部署任务下发

echo "=== 1. 创建部署批次 ==="
RESULT=$(curl -s -X POST http://localhost:3000/api/nodes/deploy/batch \
  -H "Content-Type: application/json" \
  -d '{"nodeIds":["node-dc91b9a42895"],"targetVersion":"test-v1","description":"测试部署任务"}')
echo "$RESULT"
BATCH_ID=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('batchId',''))" 2>/dev/null)
echo "批次ID: $BATCH_ID"

echo ""
echo "=== 2. 等待 8 秒，让节点拉取并开始执行 ==="
sleep 8

echo ""
echo "=== 3. 查看节点部署列表 ==="
curl -s "http://localhost:3000/api/nodes/node-dc91b9a42895/deployments" | python3 -c "
import sys, json
d = json.load(sys.stdin)
tasks = d.get('deployments', [])
print(f'部署任务数: {len(tasks)}')
for t in tasks[:3]:
    print(f'  - taskId: {t[\"taskId\"]}, status: {t[\"status\"]}, started: {t.get(\"startedAt\",\"?\")}')
    if t.get('logs'):
        print(f'    最新日志: {t[\"logs\"][-1][:80] if t[\"logs\"] else \"(无)\"}')
" 2>/dev/null || echo "解析失败，原始输出:" && curl -s "http://localhost:3000/api/nodes/node-dc91b9a42895/deployments" | head -c 500

echo ""
echo "=== 4. node-agent 最新日志 ==="
pm2 logs node-agent --lines 20 --nostream 2>&1 | tail -20
