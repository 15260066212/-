#!/bin/bash
# ============================================================
# GEO-assistant 一键部署脚本
# 用法: ./deploy-geo.sh [command]
#
# 命令:
#   deploy   - 部署最新代码（默认）
#   rollback - 回滚到上一版本
#   status   - 查看当前状态
#   backup   - 手动备份数据库
#   build    - 只构建不部署
#   logs     - 查看最近日志
# ============================================================

set -euo pipefail

# === 配置 ===
PROJECT_DIR="/home/ubuntu/geo-assistant-clean"
BACKUP_DIR="/home/ubuntu/geo-backups"
CONTAINER="geo-app"
NGINX_CONTAINER="geo-nginx"
DB_PATH="/app/data/geo-assistant.db"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="/tmp/geo-deploy-${TIMESTAMP}.log"

# === 颜色输出 ===
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $1" | tee -a "$LOG_FILE"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1" | tee -a "$LOG_FILE"; }
error() { echo -e "${RED}[ERROR]${NC} $1" | tee -a "$LOG_FILE"; }

# === 命令函数 ===

cmd_backup() {
    info "备份数据库..."
    mkdir -p "$BACKUP_DIR"
    local bak_file="$BACKUP_DIR/geo-assistant-${TIMESTAMP}.db"
    docker exec "$CONTAINER" sqlite3 "$DB_PATH" ".backup '$bak_file'" 2>/dev/null || \
    docker cp "$CONTAINER:$DB_PATH" "$bak_file"
    # 保留最近 30 个备份
    ls -t "$BACKUP_DIR"/geo-assistant-*.db 2>/dev/null | tail -n +31 | xargs rm -f 2>/dev/null || true
    info "备份完成: $bak_file"
    info "当前备份数: $(ls "$BACKUP_DIR"/geo-assistant-*.db 2>/dev/null | wc -l)"
}

cmd_deploy() {
    info "=== GEO-assistant 部署开始 ${TIMESTAMP} ==="

    # Step 1: 备份
    cmd_backup

    # Step 2: 记录当前版本（用于回滚）
    info "记录当前版本..."
    echo "$(docker inspect $CONTAINER --format='{{.Created}}')" > "$BACKUP_DIR/last-version-${TIMESTAMP}.txt"
    docker exec $CONTAINER sh -c 'ls /app/apps/server/dist/routes/' > "$BACKUP_DIR/routes-${TIMESTAMP}.txt" 2>/dev/null || true

    # Step 3: 复制源码到容器
    info "复制源码到容器..."
    cd "$PROJECT_DIR"

    # 根配置
    docker cp package.json "$CONTAINER":/app/
    docker cp tsconfig.base.json "$CONTAINER":/app/
    docker cp turbo.json "$CONTAINER":/app/

    # packages
    for pkg in shared ai-engine content-generator content-reviewer dialogue-engine manual-generator publisher scraper; do
        docker cp "packages/$pkg/src/." "$CONTAINER":/app/packages/$pkg/src/
        docker cp "packages/$pkg/package.json" "$CONTAINER":/app/packages/$pkg/
        docker cp "packages/$pkg/tsconfig.json" "$CONTAINER":/app/packages/$pkg/ 2>/dev/null || true
    done

    # server
    docker cp apps/server/src/. "$CONTAINER":/app/apps/server/src/
    docker cp apps/server/package.json "$CONTAINER":/app/apps/server/
    docker cp apps/server/tsconfig.json "$CONTAINER":/app/apps/server/ 2>/dev/null || true

    # web
    docker cp apps/web/src/. "$CONTAINER":/app/apps/web/src/
    docker cp apps/web/index.html "$CONTAINER":/app/apps/web/
    docker cp apps/web/vite.config.ts "$CONTAINER":/app/apps/web/
    docker cp apps/web/package.json "$CONTAINER":/app/apps/web/
    docker cp apps/web/tsconfig.json "$CONTAINER":/app/apps/web/ 2>/dev/null || true

    info "源码复制完成"

    # Step 4: 安装依赖
    info "安装依赖..."
    docker exec "$CONTAINER" sh -c "cd /app && npm install 2>&1 | tail -3" | tee -a "$LOG_FILE"

    # Step 5: 构建后端
    info "构建后端..."
    if docker exec "$CONTAINER" sh -c "cd /app && npx turbo build --filter=@zemingengine/server... 2>&1" | tee -a "$LOG_FILE"; then
        info "后端构建成功"
    else
        error "后端构建失败！"
        error "部署中止，旧版本仍在运行"
        exit 1
    fi

    # Step 6: 构建前端
    info "构建前端..."
    if docker exec "$CONTAINER" sh -c "cd /app/apps/web && npx --yes vite build 2>&1" | tee -a "$LOG_FILE"; then
        info "前端构建成功"
        # 复制 dist 到宿主机
        rm -rf "$PROJECT_DIR/apps/web/dist"
        docker cp "$CONTAINER":/app/apps/web/dist "$PROJECT_DIR/apps/web/dist"
        info "前端 dist 已复制到宿主机"
    else
        warn "前端构建失败，保留旧前端（不影响后端）"
    fi

    # Step 7: 重启容器
    info "重启 $CONTAINER..."
    docker restart "$CONTAINER"
    sleep 5

    info "重启 $NGINX_CONTAINER..."
    docker restart "$NGINX_CONTAINER"
    sleep 2

    # Step 8: 验证
    info "验证部署..."
    local health=$(curl -s http://localhost:9000/api/health 2>/dev/null)
    if echo "$health" | grep -q '"status":"ok"'; then
        info "✅ 健康检查通过"
        echo "$health" | python3 -m json.tool 2>/dev/null | tee -a "$LOG_FILE"
    else
        error "❌ 健康检查失败！"
        error "响应: $health"
        warn "可运行 ./deploy-geo.sh rollback 回滚"
        exit 1
    fi

    # Step 9: 验证新功能
    local monitor=$(curl -s http://localhost:9000/api/monitor/overview 2>/dev/null)
    if echo "$monitor" | grep -q '"success":true'; then
        info "✅ 监控接口正常"
    fi

    local users=$(curl -s http://localhost:9000/api/users 2>/dev/null)
    if echo "$users" | grep -q '"success":true'; then
        info "✅ 用户接口正常"
    fi

    local cache=$(curl -s http://localhost:9000/api/cache/stats 2>/dev/null)
    if echo "$cache" | grep -q '"success":true'; then
        info "✅ 缓存接口正常"
    fi

    info "=== 部署完成 ${TIMESTAMP} ==="
    info "日志: $LOG_FILE"
}

cmd_rollback() {
    warn "回滚功能需要重新构建 Docker 镜像"
    warn "当前版本: $(docker inspect $CONTAINER --format='{{.Created}}')"

    # 找到最近的备份
    local latest_bak=$(ls -t "$BACKUP_DIR"/geo-assistant-*.db 2>/dev/null | head -1)
    if [ -z "$latest_bak" ]; then
        error "没有找到数据库备份"
        exit 1
    fi

    warn "将恢复数据库备份: $latest_bak"
    read -p "确认回滚？(y/N): " confirm
    if [ "$confirm" != "y" ]; then
        info "取消回滚"
        exit 0
    fi

    # 停止容器
    info "停止容器..."
    docker stop "$CONTAINER"

    # 恢复数据库
    info "恢复数据库..."
    docker cp "$latest_bak" "$CONTAINER:$DB_PATH"

    # 重启
    info "重启容器..."
    docker start "$CONTAINER"
    sleep 5

    local health=$(curl -s http://localhost:9000/api/health 2>/dev/null)
    if echo "$health" | grep -q '"status":"ok"'; then
        info "✅ 回滚成功"
    else
        error "❌ 回滚后健康检查失败"
    fi
}

cmd_status() {
    echo "=== GEO-assistant 状态 ==="
    echo ""

    echo "--- 容器状态 ---"
    docker ps --filter name=geo- --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    echo ""

    echo "--- 健康检查 ---"
    curl -s http://localhost:9000/api/health 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "FAIL"
    echo ""

    echo "--- 数据库统计 ---"
    local monitor=$(curl -s http://localhost:9000/api/monitor/overview 2>/dev/null)
    echo "$monitor" | python3 -c "
import sys, json
d = json.load(sys.stdin)['data']
print(f\"  文章总数: {d['articles']['total']}\")
print(f\"  会话总数: {d['sessions']['total']}\")
print(f\"  发布任务: {d['publishTasks']['total']}\")
print(f\"  流水线: {d['pipelineRuns']['total']}\")
" 2>/dev/null || echo "  (监控接口不可用)"
    echo ""

    echo "--- 缓存状态 ---"
    curl -s http://localhost:9000/api/cache/stats 2>/dev/null | python3 -c "
import sys, json
d = json.load(sys.stdin)['data']
print(f\"  缓存条目: {d['entries']}\")
print(f\"  命中率: {d['hitRate']:.1%}\")
print(f\"  总查询: {d['hits'] + d['misses']}\")
" 2>/dev/null || echo "  (缓存接口不可用)"
    echo ""

    echo "--- 备份文件 ---"
    local count=$(ls "$BACKUP_DIR"/geo-assistant-*.db 2>/dev/null | wc -l)
    local latest=$(ls -t "$BACKUP_DIR"/geo-assistant-*.db 2>/dev/null | head -1)
    echo "  总备份数: $count"
    echo "  最新备份: ${latest:-无}"
    echo ""

    echo "--- 磁盘使用 ---"
    df -h / | tail -1
    echo ""
    docker system df 2>/dev/null | head -5
}

cmd_logs() {
    info "最近 50 行日志:"
    docker logs "$CONTAINER" --tail 50 2>&1
}

cmd_build() {
    info "只构建不部署..."
    cd "$PROJECT_DIR"
    docker exec "$CONTAINER" sh -c "cd /app && npm install && npx turbo build --filter=@zemingengine/server... 2>&1" | tee -a "$LOG_FILE"
    docker exec "$CONTAINER" sh -c "cd /app/apps/web && npx --yes vite build 2>&1" | tee -a "$LOG_FILE"
    info "构建完成"
}

# === 主入口 ===

mkdir -p "$BACKUP_DIR"

case "${1:-deploy}" in
    deploy)   cmd_deploy ;;
    rollback) cmd_rollback ;;
    status)   cmd_status ;;
    backup)   cmd_backup ;;
    build)    cmd_build ;;
    logs)     cmd_logs ;;
    *)
        echo "用法: $0 {deploy|rollback|status|backup|build|logs}"
        echo ""
        echo "  deploy   - 部署最新代码（默认）"
        echo "  rollback - 回滚到上一版本"
        echo "  status   - 查看当前状态"
        echo "  backup   - 手动备份数据库"
        echo "  build    - 只构建不部署"
        echo "  logs     - 查看最近日志"
        exit 1
        ;;
esac
