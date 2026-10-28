#!/bin/bash
set -e

cd /home/ubuntu/geo-assistant-clean

echo "=== 1. 部署后端 profiles.ts ==="
cd apps/server
npx tsc --noEmit 2>&1 | head -20 || echo "Type check skipped or has warnings"
cd ../..

echo ""
echo "=== 2. 部署 harvester profiles.js ==="
# 已通过 scp 上传

echo ""
echo "=== 3. 部署前端 ==="
# 已通过 scp 上传 dist

echo ""
echo "=== 4. 重启服务 ==="
pm2 restart harvester
pm2 restart geo-assistant

sleep 3

echo ""
echo "=== 5. 验证 profiles API ==="
echo "--- Harvester ---"
curl -s http://localhost:3003/api/profiles | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f'Harvester: {d[\"total\"]} profiles')
p = d['profiles'][0]
print(f'  示例: {p.get(\"platformName\",\"\")} - {p.get(\"accountName\",\"\")} ({p.get(\"sizeMB\",0)}MB)')
"

echo ""
echo "--- Backend ---"
curl -s http://localhost:3000/api/profiles/ | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f'Backend: {d[\"total\"]} profiles')
for p in d['profiles'][:3]:
    cred = p.get('credential')
    if cred:
        print(f'  {p.get(\"platformName\",p.get(\"platform\",\"?\"))} - {p.get(\"accountName\",\"?\")}')
        print(f'    Cookie: {cred.get(\"cookieCount\",0)}个 / {cred.get(\"status\",\"?\")}')
    else:
        print(f'  {p.get(\"platformName\",p.get(\"platform\",\"?\"))} - {p.get(\"accountName\",\"?\")} (无凭证)')
print(f'  ... and {len(d[\"profiles\"])-3} more')
"

echo ""
echo "✅ 部署完成！"
