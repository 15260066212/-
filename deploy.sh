#!/bin/bash
set -e

echo "============================================"
echo "  GEO 系统 + Cookie 采集服务 部署脚本"
echo "============================================"

# Check for .env file
if [ ! -f .env ]; then
  echo "[Warning] .env file not found. Creating from .env.docker..."
  cp .env.docker .env
  echo "[Warning] Please edit .env to set OPENAI_API_KEY and CREDENTIAL_ENCRYPTION_KEY"
  echo "         Then run: docker compose up -d --build"
  exit 1
fi

# Build and start all services
echo "[1/4] Building Docker images..."
docker compose build

echo "[2/4] Starting services..."
docker compose up -d

echo "[3/4] Waiting for services to be ready..."
sleep 10

# Health checks
echo "[4/4] Verifying services..."

# Check geo-app
if curl -sf http://localhost:3000/api/health > /dev/null 2>&1; then
  echo "  [OK] GEO Server: http://localhost:3000/api/health"
else
  echo "  [FAIL] GEO Server not responding on port 3000"
fi

# Check harvester
if curl -sf http://localhost:3003/health > /dev/null 2>&1; then
  echo "  [OK] Harvester: http://localhost:3003/health"
else
  echo "  [WARN] Harvester not responding on port 3003 (may still be starting up)"
fi

# Check nginx
if curl -sf http://localhost:9000/ > /dev/null 2>&1; then
  echo "  [OK] Nginx: http://localhost:9000/"
else
  echo "  [FAIL] Nginx not responding on port 9000"
fi

# Check noVNC
if curl -sf http://localhost:6080/ > /dev/null 2>&1; then
  echo "  [OK] noVNC: http://localhost:6080/"
else
  echo "  [WARN] noVNC not responding on port 6080 (may still be starting up)"
fi

echo ""
echo "============================================"
echo "  Deployment Complete"
echo "============================================"
echo ""
echo "Services:"
echo "  - Web UI:       http://<server-ip>:9000/"
echo "  - API:          http://<server-ip>:9000/api/"
echo "  - Cookie采集:    http://<server-ip>:9000/ (Cookie采集 tab)"
echo "  - noVNC:        http://<server-ip>:9000/novnc/"
echo ""
echo "To view logs:"
echo "  docker compose logs -f"
echo ""
echo "To stop:"
echo "  docker compose down"
