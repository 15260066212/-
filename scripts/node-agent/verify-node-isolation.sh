#!/bin/bash
# 验证节点隔离的凭证同步

echo "=== 1. 触发 harvester 全量同步 ==="
RESULT=$(curl -s -X POST http://localhost:3003/api/credentials/sync)
echo "$RESULT"
echo ""

echo "=== 2. 获取 admin apiKey ==="
API_KEY=$(sqlite3 /home/ubuntu/geo-assistant-clean/data/geo-assistant.db "SELECT api_key FROM users WHERE role = 'admin' LIMIT 1;")
echo "apiKey: ${API_KEY:0:15}..."

echo ""
echo "=== 3. 查看当前凭证列表（accountId 和 accountName） ==="
CREDS=$(curl -s -H "X-API-Key: $API_KEY" http://localhost:3000/api/credentials/)
echo "$CREDS" | node -e "
const d = require('fs').readFileSync('/dev/stdin', 'utf8');
try {
  const j = JSON.parse(d);
  if (j.success && j.data) {
    console.log('总凭证数:', j.data.length);
    j.data.forEach(c => {
      console.log('  -', c.platform, '| accountId:', c.accountId, '| accountName:', c.accountName || '(无)', '| status:', c.status);
    });
  } else {
    console.log('返回:', JSON.stringify(j));
  }
} catch(e) {
  console.log('解析失败:', e.message);
  console.log(d.slice(0, 300));
}
"

echo ""
echo "=== 4. 检查是否有 node-dc91b9a42895 作为 accountId 的凭证 ==="
if echo "$CREDS" | grep -q "node-dc91b9a42895"; then
  echo "✅ 成功：凭证已使用节点 ID 作为 accountId，节点隔离生效！"
else
  echo "⚠️  未找到节点 ID 作为 accountId 的凭证（可能这台机器还没有保存的凭证）"
fi
