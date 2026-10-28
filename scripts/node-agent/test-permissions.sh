#!/bin/bash
echo "=== 1. 不带 API Key 访问节点列表 (应返回 403) ==="
curl -s -w "\nHTTP_STATUS: %{http_code}\n" http://localhost:3000/api/nodes

echo ""
echo "=== 2. 不带 API Key 创建部署批次 (应返回 403) ==="
curl -s -w "\nHTTP_STATUS: %{http_code}\n" -X POST http://localhost:3000/api/nodes/deploy/batch \
  -H "Content-Type: application/json" \
  -d '{"nodeIds":["test"]}'

echo ""
echo "=== 3. 节点注册 API (无需鉴权，应 200) ==="
curl -s -w "\nHTTP_STATUS: %{http_code}\n" -X POST http://localhost:3000/api/nodes/register \
  -H "Content-Type: application/json" \
  -d '{"nodeId":"test-perm-check","name":"test-node"}' | head -c 150

echo ""
echo ""
echo "=== 4. 用 admin API Key 访问节点列表 (应返回 200 + 数据) ==="
# 从数据库或配置中拿一个 admin 的 apiKey 来测试
ADMIN_KEY=$(cat /home/ubuntu/geo-assistant-clean/data/users.json 2>/dev/null | python3 -c "import sys,json; users=json.load(sys.stdin); admin=[u for u in users if u.get('role')=='admin']; print(admin[0]['apiKey'] if admin else '')" 2>/dev/null)
if [ -n "$ADMIN_KEY" ]; then
  curl -s -w "\nHTTP_STATUS: %{http_code}\n" http://localhost:3000/api/nodes \
    -H "X-API-Key: $ADMIN_KEY" | head -c 200
else
  echo "  (跳过: 未找到 admin apiKey)"
fi
