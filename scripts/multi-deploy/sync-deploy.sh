#!/bin/bash
# ============================================================
# 多机同步部署脚本
# 用法: ./sync-deploy.sh [options] [command]
#
# 命令:
#   deploy    - 部署到所有机器（默认）
#   status    - 查看所有机器状态
#   backup    - 所有机器备份数据库
#   rollback  - 回滚所有机器（需确认）
#   logs      - 查看所有机器最近日志
#
# 选项:
#   -c, --config FILE   指定主机配置文件（默认 ./hosts.conf）
#   -t, --tag TAG       只部署指定标签的机器
#   -p, --parallel N    并行部署数量（默认 2，0 表示全部并行）
#   -y, --yes           自动确认，跳过交互提示
#   --timeout SECONDS   单台部署超时（默认 600 秒）
#   -h, --help          显示帮助
#
# 示例:
#   ./sync-deploy.sh deploy                    # 部署所有机器
#   ./sync-deploy.sh -t prod deploy            # 只部署 prod 标签的机器
#   ./sync-deploy.sh -p 4 deploy               # 4 台并行部署
#   ./sync-deploy.sh status                    # 查看所有机器状态
#   ./sync-deploy.sh backup                    # 所有机器备份
# ============================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONFIG_FILE="$SCRIPT_DIR/hosts.conf"
PARALLEL=2
TIMEOUT=600
AUTO_YES=false
FILTER_TAG=""
COMMAND="deploy"

# === 颜色输出 ===
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

info()    { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; }
debug()   { echo -e "${CYAN}[DEBUG]${NC} $1"; }
header()  { echo -e "\n${BOLD}${BLUE}==== $1 ====${NC}\n"; }

# === 解析参数 ===
while [[ $# -gt 0 ]]; do
  case "$1" in
    -c|--config)
      CONFIG_FILE="$2"; shift 2 ;;
    -t|--tag)
      FILTER_TAG="$2"; shift 2 ;;
    -p|--parallel)
      PARALLEL="$2"; shift 2 ;;
    -y|--yes)
      AUTO_YES=true; shift ;;
    --timeout)
      TIMEOUT="$2"; shift 2 ;;
    -h|--help)
      head -40 "$0"; exit 0 ;;
    deploy|status|backup|rollback|logs)
      COMMAND="$1"; shift ;;
    *)
      error "未知参数: $1"; exit 1 ;;
  esac
done

# === 加载主机列表 ===
load_hosts() {
  if [[ ! -f "$CONFIG_FILE" ]]; then
    error "配置文件不存在: $CONFIG_FILE"
    error "请从 hosts.conf.example 复制并修改："
    error "  cp $CONFIG_FILE.example $CONFIG_FILE"
    exit 1
  fi

  HOSTS=()
  while IFS= read -r line || [[ -n "$line" ]]; do
    # 跳过空行和注释
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    # 去除首尾空白
    line="$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    [[ -z "$line" ]] && continue

    # 解析字段
    host_spec=$(echo "$line" | awk '{print $1}')
    ssh_key=$(echo "$line" | awk '{print $2}')
    tags=$(echo "$line" | awk '{print $3}')

    # 如果有标签过滤
    if [[ -n "$FILTER_TAG" ]]; then
      if [[ ",$tags," != *",$FILTER_TAG,"* ]]; then
        continue
      fi
    fi

    # 解析 user@host:port
    user="ubuntu"
    host=""
    port="22"

    if [[ "$host_spec" == *"@"* ]]; then
      user="${host_spec%%@*}"
      host_spec="${host_spec#*@}"
    fi
    if [[ "$host_spec" == *":"* ]]; then
      port="${host_spec##*:}"
      host="${host_spec%%:*}"
    else
      host="$host_spec"
    fi

    # 默认 SSH key
    if [[ -z "$ssh_key" || "$ssh_key" == "-" ]]; then
      ssh_key="$HOME/.ssh/id_rsa"
    fi

    HOSTS+=("$user|$host|$port|$ssh_key|$tags")
  done < "$CONFIG_FILE"

  if [[ ${#HOSTS[@]} -eq 0 ]]; then
    error "没有找到符合条件的主机"
    [[ -n "$FILTER_TAG" ]] && error "标签过滤: $FILTER_TAG"
    exit 1
  fi
}

# === SSH 执行 ===
ssh_exec() {
  local user="$1" host="$2" port="$3" ssh_key="$4"
  shift 4
  local cmd="$*"

  ssh -o StrictHostKeyChecking=no \
      -o ConnectTimeout=10 \
      -o ServerAliveInterval=30 \
      -i "$ssh_key" \
      -p "$port" \
      "${user}@${host}" \
      "$cmd" 2>&1
}

# === 部署单台机器 ===
deploy_one() {
  local user="$1" host="$2" port="$3" ssh_key="$4" tags="$5"
  local result_file="$6"
  local log_file="$7"

  local start_time=$(date +%s)
  local status="success"
  local err_msg=""

  echo "[$host] 开始部署..." >> "$log_file"

  # 1. 上传源码（用 tar 打包传输更高效）
  echo "[$host] 上传源码..." >> "$log_file"
  if ! (cd "$PROJECT_DIR" && \
        tar czf - \
          package.json tsconfig.base.json turbo.json \
          packages/shared/src packages/shared/package.json packages/shared/tsconfig.json \
          packages/ai-engine/src packages/ai-engine/package.json \
          packages/content-generator/src packages/content-generator/package.json \
          packages/content-reviewer/src packages/content-reviewer/package.json \
          packages/dialogue-engine/src packages/dialogue-engine/package.json \
          packages/manual-generator/src packages/manual-generator/package.json \
          packages/publisher/src packages/publisher/package.json \
          packages/scraper/src packages/scraper/package.json \
          apps/server/src apps/server/package.json apps/server/tsconfig.json \
          apps/web/src apps/web/index.html apps/web/vite.config.ts apps/web/package.json apps/web/tsconfig.json \
          scripts/deploy-geo.sh \
          2>/dev/null | \
        ssh_exec "$user" "$host" "$port" "$ssh_key" \
          "mkdir -p /tmp/geo-deploy && cat > /tmp/geo-deploy/source.tar.gz && \
           cd /home/ubuntu/geo-assistant-clean && \
           tar xzf /tmp/geo-deploy/source.tar.gz && \
           rm -f /tmp/geo-deploy/source.tar.gz" \
      ) >> "$log_file" 2>&1; then
    status="failed"
    err_msg="源码上传失败"
  fi

  # 2. 远程执行部署脚本
  if [[ "$status" == "success" ]]; then
    echo "[$host] 执行远程部署..." >> "$log_file"
    if ! ssh_exec "$user" "$host" "$port" "$ssh_key" \
        "cd /home/ubuntu/geo-assistant-clean && timeout $TIMEOUT bash scripts/deploy-geo.sh build 2>&1" \
        >> "$log_file" 2>&1; then
      status="failed"
      err_msg="远程构建失败"
    fi
  fi

  # 3. 重启服务
  if [[ "$status" == "success" ]]; then
    echo "[$host] 重启服务..." >> "$log_file"
    if ! ssh_exec "$user" "$host" "$port" "$ssh_key" \
        "docker restart geo-app geo-nginx 2>&1 && sleep 5" \
        >> "$log_file" 2>&1; then
      status="failed"
      err_msg="服务重启失败"
    fi
  fi

  # 4. 健康检查
  if [[ "$status" == "success" ]]; then
    echo "[$host] 健康检查..." >> "$log_file"
    local health
    health=$(ssh_exec "$user" "$host" "$port" "$ssh_key" \
      "curl -s http://localhost:9000/api/health 2>/dev/null" 2>/dev/null)
    if echo "$health" | grep -q '"status":"ok"'; then
      echo "[$host] 健康检查通过" >> "$log_file"
    else
      status="failed"
      err_msg="健康检查失败: $health"
    fi
  fi

  local end_time=$(date +%s)
  local duration=$((end_time - start_time))

  # 写入结果
  echo "$host|$status|$duration|$err_msg" >> "$result_file"

  if [[ "$status" == "success" ]]; then
    echo -e "  ${GREEN}✓${NC} $host  成功 (${duration}s)"
  else
    echo -e "  ${RED}✗${NC} $host  失败: $err_msg (${duration}s)"
  fi
}

# === 查看单台状态 ===
status_one() {
  local user="$1" host="$2" port="$3" ssh_key="$4"

  local health
  health=$(ssh_exec "$user" "$host" "$port" "$ssh_key" \
    "curl -s http://localhost:9000/api/health 2>/dev/null || echo 'OFFLINE'" 2>/dev/null)

  local status_color status_text
  if echo "$health" | grep -q '"status":"ok"'; then
    status_color="$GREEN"
    status_text="在线"
  else
    status_color="$RED"
    status_text="离线/异常"
  fi

  printf "  %-30s ${status_color}%s${NC}\n" "$host" "$status_text"
}

# === 备份单台 ===
backup_one() {
  local user="$1" host="$2" port="$3" ssh_key="$4"

  local result
  result=$(ssh_exec "$user" "$host" "$port" "$ssh_key" \
    "cd /home/ubuntu/geo-assistant-clean && bash scripts/deploy-geo.sh backup 2>&1 | tail -3" 2>/dev/null)

  if echo "$result" | grep -q "备份完成"; then
    echo -e "  ${GREEN}✓${NC} $host  备份成功"
  else
    echo -e "  ${YELLOW}⚠${NC} $host  $result"
  fi
}

# === 主流程 ===
main() {
  load_hosts

  local total=${#HOSTS[@]}
  header "多机部署 - $COMMAND"
  info "目标机器: $total 台"
  info "并行数: $PARALLEL"
  [[ -n "$FILTER_TAG" ]] && info "标签过滤: $FILTER_TAG"
  echo ""

  # 显示主机列表
  echo "主机列表:"
  for h in "${HOSTS[@]}"; do
    IFS='|' read -r user host port ssh_key tags <<< "$h"
    echo "  - $user@$host:$port  [${tags:-无标签}]"
  done
  echo ""

  # 确认
  if [[ "$AUTO_YES" != "true" && "$COMMAND" == "deploy" ]]; then
    read -p "确认部署到以上 $total 台机器？(y/N): " confirm
    if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
      warn "已取消"
      exit 0
    fi
  fi

  # 临时目录
  local tmpdir=$(mktemp -d)
  local result_file="$tmpdir/results.txt"
  touch "$result_file"

  case "$COMMAND" in
    deploy)
      header "开始部署"
      local running=0
      local index=0

      for h in "${HOSTS[@]}"; do
        index=$((index + 1))
        IFS='|' read -r user host port ssh_key tags <<< "$h"

        local log_file="$tmpdir/${host}.log"

        if [[ "$PARALLEL" -eq 1 ]]; then
          # 串行
          deploy_one "$user" "$host" "$port" "$ssh_key" "$tags" "$result_file" "$log_file"
        else
          # 并行
          deploy_one "$user" "$host" "$port" "$ssh_key" "$tags" "$result_file" "$log_file" &
          running=$((running + 1))

          # 控制并发数
          if [[ "$PARALLEL" -gt 0 && "$running" -ge "$PARALLEL" ]]; then
            wait -n
            running=$((running - 1))
          fi
        fi
      done

      # 等待所有任务完成
      wait
      ;;

    status)
      header "机器状态"
      for h in "${HOSTS[@]}"; do
        IFS='|' read -r user host port ssh_key tags <<< "$h"
        status_one "$user" "$host" "$port" "$ssh_key"
      done
      ;;

    backup)
      header "数据库备份"
      for h in "${HOSTS[@]}"; do
        IFS='|' read -r user host port ssh_key tags <<< "$h"
        backup_one "$user" "$host" "$port" "$ssh_key" &
      done
      wait
      ;;

    logs)
      header "最近日志"
      for h in "${HOSTS[@]}"; do
        IFS='|' read -r user host port ssh_key tags <<< "$h"
        echo -e "${BOLD}$host${NC}"
        ssh_exec "$user" "$host" "$port" "$ssh_key" \
          "docker logs geo-app --tail 20 2>&1" 2>/dev/null | sed 's/^/  /'
        echo ""
      done
      ;;
  esac

  # 汇总结果
  if [[ "$COMMAND" == "deploy" ]]; then
    header "部署结果汇总"

    local success=0 failed=0 total_time=0
    while IFS='|' read -r h status duration err; do
      [[ -z "$h" ]] && continue
      if [[ "$status" == "success" ]]; then
        success=$((success + 1))
      else
        failed=$((failed + 1))
      fi
      total_time=$((total_time + duration))
    done < "$result_file"

    echo "  总数: $total"
    echo -e "  成功: ${GREEN}$success${NC}"
    echo -e "  失败: ${RED}$failed${NC}"
    echo "  总耗时: ${total_time}s"
    echo ""

    if [[ "$failed" -gt 0 ]]; then
      warn "以下机器部署失败："
      while IFS='|' read -r h status duration err; do
        [[ -z "$h" ]] && continue
        [[ "$status" == "failed" ]] && echo "  - $h: $err"
      done < "$result_file"
      echo ""
      info "详细日志: $tmpdir/"
      exit 1
    else
      info "✅ 全部部署成功！"
    fi
  fi

  rm -rf "$tmpdir"
}

main "$@"
