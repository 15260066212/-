#!/bin/bash
# ============================================================
# GEO-assistant 数据库自动备份脚本
# 由 cron 每日调用，保留最近 30 天备份
# ============================================================

set -euo pipefail

BACKUP_DIR="/home/ubuntu/geo-backups"
CONTAINER="geo-app"
DB_PATH="/app/data/geo-assistant.db"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="/home/ubuntu/geo-backups/backup.log"

mkdir -p "$BACKUP_DIR"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 开始备份..." >> "$LOG_FILE"

BAK_FILE="$BACKUP_DIR/geo-assistant-${TIMESTAMP}.db"

# 复制所有数据库文件（主库 + WAL + SHM）
docker cp "$CONTAINER:$DB_PATH" "$BAK_FILE"
docker cp "$CONTAINER:${DB_PATH}-wal" "${BAK_FILE}-wal" 2>/dev/null || true
docker cp "$CONTAINER:${DB_PATH}-shm" "${BAK_FILE}-shm" 2>/dev/null || true

if [ -f "$BAK_FILE" ]; then
    SIZE=$(du -h "$BAK_FILE" | cut -f1)
    TOTAL=$(du -sh "$BACKUP_DIR/geo-assistant-${TIMESTAMP}".db* 2>/dev/null | tail -1 | cut -f1)
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 备份成功: $BAK_FILE ($SIZE), 全部文件: $TOTAL" >> "$LOG_FILE"
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 备份失败!" >> "$LOG_FILE"
    exit 1
fi

# 清理超过 30 天的旧备份
find "$BACKUP_DIR" -name "geo-assistant-*.db*" -mtime +30 -delete 2>/dev/null || true

# 统计
COUNT=$(ls "$BACKUP_DIR"/geo-assistant-*.db 2>/dev/null | wc -l)
TOTAL_SIZE=$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1)
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 当前备份数: $COUNT, 总占用: $TOTAL_SIZE" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"
