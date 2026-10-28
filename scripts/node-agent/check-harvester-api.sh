#!/bin/bash
echo "=== harvester platforms ==="
curl -s http://localhost:3003/api/platforms | head -c 400
echo ""

echo ""
echo "=== harvester sessions count ==="
curl -s http://localhost:3003/api/sessions | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'active sessions: {d[\"count\"]}')"

echo ""
echo "=== harvester credential count ==="
curl -s -X POST http://localhost:3003/api/credentials/sync | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'credentials: {d.get(\"total\", \"?\")}')" 2>/dev/null || echo "sync not available"

echo ""
echo "=== harvester routes (from server.js) ==="
grep -E "app\.(get|post|put|delete|use)\(" /home/ubuntu/geo-assistant-clean/harvester/server.js | head -20
