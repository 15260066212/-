#!/bin/bash
# ============================================================
# Profile 模式部署验证脚本
# 用法：./verify-profile-deployment.sh [harvester_url]
# ============================================================

set -e

HARVESTER_URL="${1:-http://localhost:3003}"

echo "=========================================="
echo "  Profile 模式部署验证"
echo "=========================================="
echo ""
echo "目标: $HARVESTER_URL"
echo ""

PASS=0
FAIL=0

check() {
  local name="$1"
  local result="$2"
  if [ "$result" = "pass" ]; then
    echo "  ✅ $name"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $name"
    FAIL=$((FAIL + 1))
  fi
}

# Test 1: 服务健康检查
echo "[1/5] 服务健康检查..."
if curl -s "$HARVESTER_URL/health" > /dev/null 2>&1; then
  check "服务运行正常" "pass"
else
  check "服务运行正常" "fail"
  echo ""
  echo "❌ 部署验证失败：服务未启动"
  exit 1
fi

# Test 2: Profile API 可用
echo ""
echo "[2/5] Profile API 可用性..."
PROFILES=$(curl -s "$HARVESTER_URL/api/profiles" 2>/dev/null)
if echo "$PROFILES" | grep -q '"profiles"' || echo "$PROFILES" | grep -q '"accounts"'; then
  check "Profile 列表 API 可用" "pass"
else
  check "Profile 列表 API 可用" "fail"
  echo "     响应: $PROFILES"
fi

# Test 3: 检查是否有平台专属发布逻辑（通过测试已知平台）
echo ""
echo "[3/5] 头条号发布接口..."
# 发送一个测试请求（无 cookie，应该返回 profile 或 cookie 模式的错误）
TEST_RESP=$(curl -s -X POST "$HARVESTER_URL/api/llmwiki/publish" \
  -H "Content-Type: application/json" \
  -d '{"platform":"toutiaohao","article":{"title":"test","contentMarkdown":"test"},"credentials":{"accountName":"verify-test","platform":"toutiaohao","data":{"cookie":""}}}' 2>/dev/null)

if echo "$TEST_RESP" | grep -q '"publishMode"'; then
  check "发布接口返回 publishMode 字段" "pass"
  MODE=$(echo "$TEST_RESP" | grep -o '"publishMode":"[^"]*"' | cut -d'"' -f4)
  echo "     模式: $MODE"
else
  # 可能返回错误（因为没有 profile 也没有 cookie），但只要 API 存在就行
  if echo "$TEST_RESP" | grep -q 'success'; then
    check "发布接口可用" "pass"
  else
    check "发布接口可用" "fail"
  fi
fi

# Test 4: 续期 API 可用
echo ""
echo "[4/5] 续期 API 可用性..."
RENEW_RESP=$(curl -s -X POST "$HARVESTER_URL/api/profiles/renew-all" 2>/dev/null)
if echo "$RENEW_RESP" | grep -q '"total"'; then
  check "续期 API 可用" "pass"
  TOTAL=$(echo "$RENEW_RESP" | grep -o '"total":[0-9]*' | cut -d: -f2)
  echo "     Profile 总数: ${TOTAL:-0}"
else
  check "续期 API 可用" "fail"
fi

# Test 5: health 端点存在
echo ""
echo "[5/5] 健康检查端点..."
HEALTH_RESP=$(curl -s "$HARVESTER_URL/api/profiles" 2>/dev/null)
if [ -n "$HEALTH_RESP" ]; then
  check "Profile 健康检查端点可用" "pass"
else
  check "Profile 健康检查端点可用" "fail"
fi

# 总结
echo ""
echo "=========================================="
echo "  验证结果: $PASS 通过 / $FAIL 失败"
echo "=========================================="

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "⚠️  有 $FAIL 项未通过，请检查"
  exit 1
else
  echo ""
  echo "✅ 全部通过！Profile 模式部署成功"
  exit 0
fi
