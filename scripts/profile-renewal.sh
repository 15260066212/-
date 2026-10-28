#!/bin/bash
# ============================================================
# Profile 定时续期脚本
# 用于 cron 定时调用，保持所有账号登录态有效
#
# crontab 示例（每周一凌晨 3 点执行）：
# 0 3 * * 1 /opt/geo-assistant-clean/scripts/profile-renewal.sh >> /var/log/geo/profile-renewal.log 2>&1
# ============================================================

set -e

# 配置
HARVESTER_URL="${HARVESTER_URL:-http://localhost:3003}"
LOG_DIR="${LOG_DIR:-/var/log/geo}"
LOG_FILE="$LOG_DIR/profile-renewal.log"

# 确保日志目录存在
mkdir -p "$LOG_DIR"

# 记录开始时间
echo "==========================================" >> "$LOG_FILE"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Profile 续期开始" >> "$LOG_FILE"

# 调用续期 API
RESPONSE=$(curl -s -X POST "$HARVESTER_URL/api/profiles/renew-all")

# 记录结果
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 续期结果: $RESPONSE" >> "$LOG_FILE"

# 简单解析结果（需要 jq 的话可以更精细）
TOTAL=$(echo "$RESPONSE" | grep -o '"total":[0-9]*' | cut -d: -f2)
STILL_LOGGED_IN=$(echo "$RESPONSE" | grep -o '"stillLoggedIn":[0-9]*' | cut -d: -f2)
FAILED=$(echo "$RESPONSE" | grep -o '"failed":[0-9]*' | cut -d: -f2)

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 总数: ${TOTAL:-?}, 有效: ${STILL_LOGGED_IN:-?}, 失败: ${FAILED:-?}" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"

# 如果有失败的，退出码非零，方便 cron 告警
if [ "${FAILED:-0}" -gt 0 ]; then
  exit 1
fi

exit 0
