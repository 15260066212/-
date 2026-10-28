<#
.SYNOPSIS
  芯图引擎 GEO · 服务守护脚本（开机自启 + 持续存活检测）
.DESCRIPTION
  每 30 秒检查一次 localhost:3000，不通就重启 server。
  推荐注册为 Windows 计划任务（每 1 分钟 / 开机触发）。
#>

$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$log  = Join-Path $root 'dev-server.log'
$err  = Join-Path $root 'dev-server.err.log'
$port = 3000

function Test-ServerAlive {
  try {
    $r = Invoke-WebRequest -Uri "http://localhost:$port/api/health" -UseBasicParsing -TimeoutSec 3
    return $r.StatusCode -eq 200
  } catch {
    return $false
  }
}

if (Test-ServerAlive) {
  Write-Host "[$(Get-Date -Format HH:mm:ss)] server OK on port $port"
  exit 0
}

# 杀掉残留的旧进程（可选，保守）
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ForEach-Object {
  if ($_.CommandLine -like "*geo-assistant-clean*" -or $_.CommandLine -like "*dist/index.js*") {
    Write-Host "[$(Get-Date -Format HH:mm:ss)] killing stale pid $($_.ProcessId)"
    Stop-Process -Id $_.ProcessId -Force
  }
}

Write-Host "[$(Get-Date -Format HH:mm:ss)] starting server..."
Set-Location (Join-Path $root 'apps\server')
$p = Start-Process -FilePath 'npx.cmd' `
  -ArgumentList 'tsx','dist/index.js' `
  -WorkingDirectory (Join-Path $root 'apps\server') `
  -WindowStyle Hidden `
  -RedirectStandardOutput $log `
  -RedirectStandardError $err `
  -PassThru
Write-Host "[$(Get-Date -Format HH:mm:ss)] spawned pid=$($p.Id)"

# 等一会儿确认端口起来
for ($i = 0; $i -lt 15; $i++) {
  Start-Sleep -Seconds 1
  if (Test-ServerAlive) {
    Write-Host "[$(Get-Date -Format HH:mm:ss)] server READY on port $port"
    exit 0
  }
}
Write-Host "[$(Get-Date -Format HH:mm:ss)] server FAILED to start, check $log / $err"
exit 1
