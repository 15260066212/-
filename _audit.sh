#!/bin/bash
# GEO 全链路验收脚本 — 输出 JSON 格式证据
set -euo pipefail
SERVER=ubuntu@81.70.79.239
REMOTE=/home/ubuntu/geo-assistant-clean
OUT=/tmp/geo_evidence.md

echo "# GEO 全链路验收证据 $(date)" > $OUT
echo "" >> $OUT

# --- Q0: 服务器健康 ---
echo "## Q0: 服务器健康" >> $OUT
echo "" >> $OUT

# pm2 status
echo "### pm2 进程状态" >> $OUT
ssh $SERVER "pm2 status --no-color" >> $OUT 2>&1 || echo "pm2 状态获取失败" >> $OUT
echo "" >> $OUT

# geo-assistant 重启计数和 uptime
echo "### geo-assistant 重启次数" >> $OUT
ssh $SERVER "pm2 describe geo-assistant --no-color 2>/dev/null | grep -E '(pid|uptime|restarts|status|memory)'" >> $OUT 2>&1
echo "" >> $OUT

# 端口 3000 可达
echo "### API 端口 3000 可达性" >> $OUT
HTTP_CODE=$(ssh $SERVER "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/articles" 2>/dev/null || echo "000")
echo "- HTTP code: $HTTP_CODE" >> $OUT
[ "$HTTP_CODE" = "200" ] && echo "✅ PASS" >> $OUT || echo "❌ FAIL (code=$HTTP_CODE)" >> $OUT
echo "" >> $OUT

# 后端路由列表（看 pipeline 相关路由是否注册）
echo "### 后端注册路由（pipeline 相关）" >> $OUT
ROUTES=$(ssh $SERVER "curl -s http://localhost:3000/api/articles 2>/dev/null | head -c 200")
echo "- /api/articles 返回: ${ROUTES}..." >> $OUT
echo "" >> $OUT

# error log 无 crash
echo "### geo-assistant error log (最近 20 行)" >> $OUT
ssh $SERVER "tail -20 /home/ubuntu/.pm2/logs/geo-assistant-error.log 2>/dev/null | grep -v MODULE_TYPELESS | grep -v CookieWarmer | grep -v 正在运行" >> $OUT 2>&1 || echo "(无错误日志)" >> $OUT
ERR_COUNT=$(ssh $SERVER "tail -20 /home/ubuntu/.pm2/logs/geo-assistant-error.log 2>/dev/null | grep -c -i 'syntaxerror\|rangeserror\|Error:' || echo 0" 2>/dev/null)
echo "" >> $OUT
echo "### crash 错误计数: $ERR_COUNT" >> $OUT
[ "$ERR_COUNT" = "0" ] && echo "✅ PASS" >> $OUT || echo "❌ FAIL (crash errors found)" >> $OUT
echo "" >> $OUT

# DeepSeek API 连通
echo "### DeepSeek API 连通" >> $OUT
DS_RESULT=$(ssh $SERVER "cd $REMOTE/apps/server && node --input-type=module -e \"
import 'dotenv/config';
const key = process.env.DEEPSEEK_API_KEY;
if (!key) { console.log('NO_KEY'); process.exit(1); }
const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content: '回复 OK' }], max_tokens: 5 }),
});
const d = await res.json();
if (d.choices && d.choices[0]) { console.log('OK: ' + d.choices[0].message.content.trim()); }
else { console.log('FAIL: ' + JSON.stringify(d).slice(0, 200)); }
\"" 2>/dev/null || echo "DS_TEST_FAILED")
echo "- $DS_RESULT" >> $OUT
echo "" >> $OUT

# 返回输出路径
cat $OUT
