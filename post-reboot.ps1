# post-reboot.ps1 — Windows 重启后一键完成 Milvus + 迁移全链路
#
# 运行：管理员 PowerShell，cd 到 geo-assistant-clean 后：
#   powershell -ExecutionPolicy Bypass -File post-reboot.ps1
#
# 前置条件：
#   - 已重启（让 VirtualMachinePlatform / WSL2 生效）
#   - Docker Desktop 已能启动 daemon
#   - apps/server/.env 里 MILVUS_URI 和 DOUBAO_EMBEDDING_ENDPOINT 已填好

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Step($msg) { Write-Host "`n====> $msg" -ForegroundColor Cyan }
function Ok($msg)  { Write-Host "  ✅ $msg" -ForegroundColor Green }
function Wait-Health($service, $maxWaitSec = 120) {
    Step "等待 $service 健康..."
    $deadline = (Get-Date).AddSeconds($maxWaitSec)
    while ((Get-Date) -lt $deadline) {
        $healthy = docker ps --filter "name=$service" --filter "health=healthy" --format "{{.Names}}" 2>$null
        if ($healthy) { Ok "$service healthy"; return $true }
        Start-Sleep -Seconds 3
    }
    Write-Host "  ❌ $service 超时 ($maxWaitSec s)" -ForegroundColor Red
    return $false
}

# ===== 1. 确认 Docker daemon 可用 =====
Step "确认 Docker daemon"
$dockerOk = $false
for ($i = 0; $i -lt 20; $i++) {
    try {
        docker info 2>$null | Out-Null
        $dockerOk = $true; break
    } catch {
        Write-Host "  等待 Docker... ($i/20)"
        Start-Sleep -Seconds 5
    }
}
if (-not $dockerOk) {
    Write-Host "❌ Docker daemon 无法启动，打开 Docker Desktop 手动启动后重试" -ForegroundColor Red
    exit 1
}
Ok "Docker daemon 就绪"

# ===== 2. 拉起 Milvus =====
# 优先用本地存储版（免 MinIO，镜像少拉一个）；若之后拉到了 minio 可换回原 compose
Step "拉起 Milvus Standalone（本地存储版）"
docker compose -f docker-compose.milvus-local.yml up -d 2>&1
Wait-Health "milvus-standalone" 180
# Attu 控制台（可选）
docker start attu 2>$null | Out-Null

# ===== 3. 检查 .env =====
Step "检查 .env 配置"
$envFile = "apps/server/.env"
$milvusUri = (Get-Content $envFile | Select-String '^MILVUS_URI=' | ForEach-Object { $_.ToString().Split('=')[1] }).Trim()
$embEndpoint = (Get-Content $envFile | Select-String '^DOUBAO_EMBEDDING_ENDPOINT=' | ForEach-Object { $_.ToString().Split('=')[1] }).Trim()

if ([string]::IsNullOrWhiteSpace($milvusUri) -or $milvusUri.StartsWith('#')) {
    Write-Host "⚠️  MILVUS_URI 未设置，尝试自动填入 localhost:19530" -ForegroundColor Yellow
    (Get-Content $envFile) -replace '^# MILVUS_URI=localhost:19530', 'MILVUS_URI=localhost:19530' | Set-Content $envFile
    $milvusUri = 'localhost:19530'
}
Ok "MILVUS_URI=$milvusUri"

if ([string]::IsNullOrWhiteSpace($embEndpoint)) {
    Write-Host "⚠️  DOUBAO_EMBEDDING_ENDPOINT 为空，embedding 将使用 ZeroEmbedding (全 0 向量占位)" -ForegroundColor Yellow
    Write-Host "   语义召回效果为零，需去火山方舟控制台创建 embedding 接入点后填入 ep-xxxxxx" -ForegroundColor Yellow
} else {
    Ok "DOUBAO_EMBEDDING_ENDPOINT=$embEndpoint"
}

# ===== 4. 跑批量迁移 =====
Step "从 SQLite 批量迁移 L2/L3 信源到 Milvus"
Push-Location apps/server
# 用系统 Node 20：better-sqlite3 原生模块编译于 Node20；milvus SDK 经 thrift uuid shim 后兼容
node dist/scripts/migrate-to-milvus.js 2>&1
$migrateExit = $LASTEXITCODE
Pop-Location
if ($migrateExit -ne 0) {
    Write-Host "❌ 迁移脚本退出码 $migrateExit" -ForegroundColor Red
} else {
    Ok "迁移完成"
}

# ===== 5. 启动 server 验证 =====
Step "启动 server 并验证"
Push-Location apps/server
# 后台启动 server（系统 Node 20）
$proc = Start-Process -FilePath "node" -ArgumentList "dist/index.js" -PassThru -NoNewWindow -RedirectStandardOutput "$root\_server.out.log" -RedirectStandardError "$root\_server.err.log" -WorkingDirectory (Join-Path $root "apps/server")
Write-Host "  Server PID = $($proc.Id)"

# 等 server 起来
$serverUp = $false
for ($i = 0; $i -lt 20; $i++) {
    try {
        $port = (Get-Content (Join-Path $root "apps/server/.env") | Select-String '^PORT=' | ForEach-Object { $_.ToString().Split('=')[1] }).Trim()
        if (-not $port) { $port = "3000" }
        $r = Invoke-WebRequest -Uri "http://localhost:$port/api/health" -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
        $serverUp = $true; break
    } catch {
        Start-Sleep -Seconds 2
    }
}

if ($serverUp) {
    Ok "Server 健康检查通过 http://localhost:$port/api/health"
    Write-Host "`n🎉 全链路就绪！" -ForegroundColor Green
    Write-Host "  Server 日志: Get-Content $root\_server.out.log"
    Write-Host "  Attu 控制台: http://localhost:8000"
    Write-Host "  生成文章: POST http://localhost:$port/api/session/:id/article/generate"
} else {
    Write-Host "❌ Server 未能启动，查看日志:" -ForegroundColor Red
    Get-Content "$root\_server.err.log" -ErrorAction SilentlyContinue | Select-Object -Last 20
}
Pop-Location
