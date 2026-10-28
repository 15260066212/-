#!/bin/bash
# ============================================================
# Profile 模式一键部署脚本
# 用法：./deploy-profile.sh [项目根目录]
# ============================================================

set -e

PROJECT_DIR="${1:-/opt/geo-assistant-clean}"
HARVESTER_DIR="$PROJECT_DIR/apps/harvester"
SHARED_DIR="$PROJECT_DIR/packages/shared"

echo "=========================================="
echo "  Profile 模式部署脚本"
echo "=========================================="
echo ""
echo "项目目录: $PROJECT_DIR"
echo ""

# Step 1: 构建 shared 包
echo "[1/5] 构建 shared 包..."
cd "$SHARED_DIR"
npm run build
echo "  ✅ shared 构建完成"

# Step 2: 构建 harvester
echo ""
echo "[2/5] 构建 harvester..."
cd "$HARVESTER_DIR"
npm run build
echo "  ✅ harvester 构建完成"

# Step 3: 重启服务
echo ""
echo "[3/5] 重启 harvester 服务..."
if command -v pm2 &> /dev/null; then
  # 尝试用 pm2 重启
  if pm2 list | grep -q "harvester"; then
    pm2 restart harvester
    echo "  ✅ PM2 重启成功"
  else
    echo "  ⚠️  未找到 harvester 进程，请手动启动"
  fi
else
  # 尝试用 systemctl
  if systemctl list-units --type=service | grep -q "harvester"; then
    systemctl restart harvester
    echo "  ✅ systemd 重启成功"
  else
    echo "  ⚠️  未检测到 PM2 或 systemd，请手动重启服务"
  fi
fi

# Step 4: 等待服务启动
echo ""
echo "[4/5] 等待服务启动..."
sleep 3

# 检查端口
if command -v curl &> /dev/null; then
  for i in {1..10}; do
    if curl -s http://localhost:3003/health > /dev/null 2>&1; then
      echo "  ✅ 服务已启动 (端口 3003)"
      break
    fi
    sleep 1
  done
fi

# Step 5: 验证
echo ""
echo "[5/5] 部署验证..."
echo ""
echo "--- Profile 列表 ---"
curl -s http://localhost:3003/api/profiles | python3 -m json.tool 2>/dev/null || curl -s http://localhost:3003/api/profiles
echo ""

echo ""
echo "=========================================="
echo "  ✅ 部署完成！"
echo "=========================================="
echo ""
echo "后续步骤："
echo "  1. 访问远程控制页面采集账号 Profile"
echo "  2. 配置定时续期 cron 任务（参考 PROFILE_DEPLOYMENT.md）"
echo "  3. 运行发布测试验证完整流程"
echo ""
