#!/bin/bash
# 修复 credentials API 500 错误
# 把 GET / 的 withErrorHandler 换成内联 try-catch，验证是否是 withErrorHandler 的问题

FILE=/home/ubuntu/geo-assistant-clean/apps/server/dist/routes/credentials.js

echo "=== 查找 GET / 路由位置 ==="
grep -n "获取所有凭据\|GET / - " $FILE

echo ""
echo "=== 当前 GET / 路由代码 ==="
grep -n "app.get('/'" $FILE

echo ""
echo "=== 测试当前状态 ==="
curl -s -o /dev/null -w "Before fix: %{http_code}\n" http://localhost:3000/api/credentials/
