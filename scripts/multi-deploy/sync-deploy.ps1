# ============================================================
# 多机同步部署脚本 (Windows PowerShell 版)
# 用法: .\sync-deploy.ps1 [-Command deploy] [-Config hosts.conf] [-Tag prod] [-Parallel 2]
#
# 命令:
#   deploy    - 部署到所有机器（默认）
#   status    - 查看所有机器状态
#   backup    - 所有机器备份数据库
#
# 选项:
#   -Config     主机配置文件路径（默认 ./hosts.conf）
#   -Tag        只部署指定标签的机器
#   -Parallel   并行部署数量（默认 2）
#   -Timeout    单台部署超时秒数（默认 600）
#   -Yes        自动确认，跳过交互提示
#
# 前置要求:
#   1. 安装 OpenSSH 客户端（Windows 10+ 自带）
#   2. 配置 SSH 密钥免密登录
#   3. 远程机器已部署基础 Docker 环境
#
# 示例:
#   .\sync-deploy.ps1 deploy -Tag prod -Parallel 4
#   .\sync-deploy.ps1 status
#   .\sync-deploy.ps1 backup
# ============================================================

param(
    [Parameter(Position=0)]
    [ValidateSet('deploy', 'status', 'backup')]
    [string]$Command = 'deploy',

    [string]$Config = "$PSScriptRoot\hosts.conf",

    [string]$Tag = '',

    [int]$Parallel = 2,

    [int]$Timeout = 600,

    [switch]$Yes
)

$ErrorActionPreference = 'Stop'
$ProjectDir = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent

# === 颜色输出 ===
function Write-Info($msg)    { Write-Host "[INFO]  " -ForegroundColor Green -NoNewline; Write-Host $msg }
function Write-Warn($msg)    { Write-Host "[WARN]  " -ForegroundColor Yellow -NoNewline; Write-Host $msg }
function Write-Err($msg)     { Write-Host "[ERROR] " -ForegroundColor Red -NoNewline; Write-Host $msg }
function Write-Header($msg)  { Write-Host "`n==== $msg ====`n" -ForegroundColor Cyan }

# === 加载主机配置 ===
function Get-Hosts {
    if (-not (Test-Path $Config)) {
        Write-Err "配置文件不存在: $Config"
        Write-Host "请从 hosts.conf.example 复制并修改"
        exit 1
    }

    $hosts = @()
    Get-Content $Config | ForEach-Object {
        $line = $_.Trim()
        if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith('#')) { return }

        $parts = $line -split '\s+', 3
        $hostSpec = $parts[0]
        $sshKey = if ($parts.Count -gt 1 -and $parts[1] -ne '-') { $parts[1] } else { "$env:USERPROFILE\.ssh\id_rsa" }
        $tags = if ($parts.Count -gt 2) { $parts[2] } else { '' }

        # 标签过滤
        if ($Tag -and $tags -notlike "*$Tag*") { return }

        # 解析 user@host:port
        $user = 'ubuntu'
        $hostname = ''
        $port = 22

        if ($hostSpec -match '^(.+)@(.+)$') {
            $user = $Matches[1]
            $hostSpec = $Matches[2]
        }
        if ($hostSpec -match '^(.+):(\d+)$') {
            $hostname = $Matches[1]
            $port = $Matches[2]
        } else {
            $hostname = $hostSpec
        }

        $hosts += [PSCustomObject]@{
            User = $user
            Host = $hostname
            Port = $port
            SshKey = $sshKey
            Tags = $tags
        }
    }

    if ($hosts.Count -eq 0) {
        Write-Err "没有找到符合条件的主机"
        if ($Tag) { Write-Err "标签过滤: $Tag" }
        exit 1
    }

    return $hosts
}

# === SSH 执行命令 ===
function Invoke-SshCommand {
    param(
        [string]$User,
        [string]$Host,
        [int]$Port,
        [string]$SshKey,
        [string]$Command
    )

    $args = @(
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'ConnectTimeout=10',
        '-o', 'ServerAliveInterval=30',
        '-i', "`"$SshKey`"",
        '-p', $Port,
        "$User@$Host",
        $Command
    )

    & ssh @args 2>&1
}

# === 部署单台 ===
function Deploy-One {
    param($h, $ResultFile)

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $status = 'success'
    $errMsg = ''
    $logFile = "$env:TEMP\geo-deploy-$($h.Host).log"
    "" | Out-File $logFile -Encoding utf8

    "[$($h.Host)] 开始部署..." | Out-File $logFile -Append -Encoding utf8

    try {
        # 1. 打包并上传源码
        "[$($h.Host)] 上传源码..." | Out-File $logFile -Append -Encoding utf8
        $tarFile = "$env:TEMP\geo-source-$($h.Host).tar.gz"

        Push-Location $ProjectDir
        $filesToInclude = @(
            'package.json', 'tsconfig.base.json', 'turbo.json',
            'packages/shared/src', 'packages/shared/package.json', 'packages/shared/tsconfig.json',
            'packages/ai-engine/src', 'packages/ai-engine/package.json',
            'packages/content-generator/src', 'packages/content-generator/package.json',
            'packages/content-reviewer/src', 'packages/content-reviewer/package.json',
            'packages/dialogue-engine/src', 'packages/dialogue-engine/package.json',
            'packages/manual-generator/src', 'packages/manual-generator/package.json',
            'packages/publisher/src', 'packages/publisher/package.json',
            'packages/scraper/src', 'packages/scraper/package.json',
            'apps/server/src', 'apps/server/package.json', 'apps/server/tsconfig.json',
            'apps/web/src', 'apps/web/index.html', 'apps/web/vite.config.ts', 'apps/web/package.json', 'apps/web/tsconfig.json',
            'scripts/deploy-geo.sh'
        )
        & tar czf "`"$tarFile`"" @filesToInclude 2>$null
        Pop-Location

        if ($LASTEXITCODE -ne 0) {
            throw "源码打包失败"
        }

        # 上传并解压
        $uploadCmd = "mkdir -p /tmp/geo-deploy && cat > /tmp/geo-deploy/source.tar.gz && cd /home/ubuntu/geo-assistant-clean && tar xzf /tmp/geo-deploy/source.tar.gz && rm -f /tmp/geo-deploy/source.tar.gz"
        $uploadOutput = Get-Content $tarFile | & ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 -i "`"$($h.SshKey)`"" -p $h.Port "$($h.User)@$($h.Host)" $uploadCmd 2>&1
        $uploadOutput | Out-File $logFile -Append -Encoding utf8

        if ($LASTEXITCODE -ne 0) {
            throw "源码上传失败"
        }
        Remove-Item $tarFile -Force -ErrorAction SilentlyContinue

        # 2. 远程构建
        "[$($h.Host)] 执行远程构建..." | Out-File $logFile -Append -Encoding utf8
        $buildCmd = "cd /home/ubuntu/geo-assistant-clean && timeout $Timeout bash scripts/deploy-geo.sh build 2>&1"
        $buildOutput = Invoke-SshCommand @($h.User, $h.Host, $h.Port, $h.SshKey, $buildCmd)
        $buildOutput | Out-File $logFile -Append -Encoding utf8

        if ($LASTEXITCODE -ne 0) {
            throw "远程构建失败"
        }

        # 3. 重启服务
        "[$($h.Host)] 重启服务..." | Out-File $logFile -Append -Encoding utf8
        $restartCmd = "docker restart geo-app geo-nginx 2>&1 && sleep 5"
        $restartOutput = Invoke-SshCommand @($h.User, $h.Host, $h.Port, $h.SshKey, $restartCmd)
        $restartOutput | Out-File $logFile -Append -Encoding utf8

        if ($LASTEXITCODE -ne 0) {
            throw "服务重启失败"
        }

        # 4. 健康检查
        "[$($h.Host)] 健康检查..." | Out-File $logFile -Append -Encoding utf8
        $healthCmd = "curl -s http://localhost:9000/api/health 2>/dev/null"
        $health = Invoke-SshCommand @($h.User, $h.Host, $h.Port, $h.SshKey, $healthCmd)
        $health = $health -join "`n"

        if ($health -match '"status":"ok"') {
            "[$($h.Host)] 健康检查通过" | Out-File $logFile -Append -Encoding utf8
        } else {
            throw "健康检查失败: $health"
        }
    }
    catch {
        $status = 'failed'
        $errMsg = $_.Exception.Message
        "[$($h.Host)] 失败: $errMsg" | Out-File $logFile -Append -Encoding utf8
    }

    $sw.Stop()
    $duration = [int]$sw.Elapsed.TotalSeconds

    # 写入结果
    "$($h.Host)|$status|$duration|$errMsg" | Out-File $ResultFile -Append -Encoding utf8

    # 输出结果
    if ($status -eq 'success') {
        Write-Host "  ✓ " -ForegroundColor Green -NoNewline
        Write-Host "$($h.Host)  成功 ($($duration)s)"
    } else {
        Write-Host "  ✗ " -ForegroundColor Red -NoNewline
        Write-Host "$($h.Host)  失败: $errMsg ($($duration)s)"
    }
}

# === 查看状态 ===
function Get-StatusOne($h) {
    $healthCmd = "curl -s http://localhost:9000/api/health 2>/dev/null || echo 'OFFLINE'"
    try {
        $health = Invoke-SshCommand @($h.User, $h.Host, $h.Port, $h.SshKey, $healthCmd)
        $health = $health -join "`n"

        if ($health -match '"status":"ok"') {
            Write-Host "  ✓ " -ForegroundColor Green -NoNewline
            Write-Host ("{0,-30} 在线" -f $h.Host)
        } else {
            Write-Host "  ✗ " -ForegroundColor Red -NoNewline
            Write-Host ("{0,-30} 离线/异常" -f $h.Host)
        }
    } catch {
        Write-Host "  ✗ " -ForegroundColor Red -NoNewline
        Write-Host ("{0,-30} 连接失败" -f $h.Host)
    }
}

# === 备份 ===
function Backup-One($h) {
    try {
        $backupCmd = "cd /home/ubuntu/geo-assistant-clean && bash scripts/deploy-geo.sh backup 2>&1 | tail -3"
        $result = Invoke-SshCommand @($h.User, $h.Host, $h.Port, $h.SshKey, $backupCmd)
        $result = $result -join "`n"

        if ($result -match '备份完成') {
            Write-Host "  ✓ " -ForegroundColor Green -NoNewline
            Write-Host "$($h.Host)  备份成功"
        } else {
            Write-Host "  ⚠ " -ForegroundColor Yellow -NoNewline
            Write-Host "$($h.Host)  $($result.Trim())"
        }
    } catch {
        Write-Host "  ✗ " -ForegroundColor Red -NoNewline
        Write-Host "$($h.Host)  连接失败"
    }
}

# === 主流程 ===
$hosts = Get-Hosts
$total = $hosts.Count

Write-Header "多机部署 - $Command"
Write-Info "目标机器: $total 台"
Write-Info "并行数: $Parallel"
if ($Tag) { Write-Info "标签过滤: $Tag" }
Write-Host ""

Write-Host "主机列表:"
$hosts | ForEach-Object {
    $tagsStr = if ($_.Tags) { $_.Tags } else { '无标签' }
    Write-Host "  - $($_.User)@$($_.Host):$($_.Port)  [$tagsStr]"
}
Write-Host ""

# 确认
if ($Command -eq 'deploy' -and -not $Yes) {
    $confirm = Read-Host "确认部署到以上 $total 台机器？(y/N)"
    if ($confirm -ne 'y' -and $confirm -ne 'Y') {
        Write-Warn "已取消"
        exit 0
    }
}

$resultFile = "$env:TEMP\geo-deploy-results.txt"
"" | Out-File $resultFile -Encoding utf8

switch ($Command) {
    'deploy' {
        Write-Header "开始部署"

        if ($Parallel -le 1) {
            # 串行
            foreach ($h in $hosts) {
                Deploy-One $h $resultFile
            }
        } else {
            # 并行（使用 Start-Job）
            $jobs = @()
            $running = 0

            foreach ($h in $hosts) {
                # 限制并发数
                while ($running -ge $Parallel) {
                    Start-Sleep -Milliseconds 500
                    $completed = Get-Job | Where-Object { $_.State -eq 'Completed' }
                    foreach ($job in $completed) {
                        Receive-Job $job
                        Remove-Job $job
                        $running--
                    }
                }

                $job = Start-Job -ScriptBlock {
                    param($h, $resultFile, $ProjectDir, $Timeout)

                    function Invoke-SshCommand {
                        param($User, $Host, $Port, $SshKey, $Command)
                        & ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o ServerAliveInterval=30 -i "`"$SshKey`"" -p $Port "$User@$Host" $Command 2>&1
                    }

                    $sw = [System.Diagnostics.Stopwatch]::StartNew()
                    $status = 'success'
                    $errMsg = ''
                    $logFile = "$env:TEMP\geo-deploy-$($h.Host).log"
                    "" | Out-File $logFile -Encoding utf8

                    try {
                        $tarFile = "$env:TEMP\geo-source-$($h.Host).tar.gz"
                        Push-Location $ProjectDir
                        $files = @(
                            'package.json', 'tsconfig.base.json', 'turbo.json',
                            'packages/shared/src', 'packages/shared/package.json',
                            'apps/server/src', 'apps/server/package.json',
                            'apps/web/src', 'apps/web/index.html', 'apps/web/vite.config.ts', 'apps/web/package.json',
                            'scripts/deploy-geo.sh'
                        )
                        & tar czf "`"$tarFile`"" @files 2>$null
                        Pop-Location

                        if ($LASTEXITCODE -ne 0) { throw "源码打包失败" }

                        # 上传
                        $uploadCmd = "mkdir -p /tmp/geo-deploy && cat > /tmp/geo-deploy/source.tar.gz && cd /home/ubuntu/geo-assistant-clean && tar xzf /tmp/geo-deploy/source.tar.gz && rm -f /tmp/geo-deploy/source.tar.gz"
                        Get-Content $tarFile -Raw | & ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 -i "`"$($h.SshKey)`"" -p $h.Port "$($h.User)@$($h.Host)" $uploadCmd 2>&1 | Out-Null
                        Remove-Item $tarFile -Force -ErrorAction SilentlyContinue
                        if ($LASTEXITCODE -ne 0) { throw "源码上传失败" }

                        # 构建
                        $buildCmd = "cd /home/ubuntu/geo-assistant-clean && timeout $Timeout bash scripts/deploy-geo.sh build 2>&1"
                        Invoke-SshCommand $h.User $h.Host $h.Port $h.SshKey $buildCmd | Out-Null
                        if ($LASTEXITCODE -ne 0) { throw "远程构建失败" }

                        # 重启
                        $restartCmd = "docker restart geo-app geo-nginx 2>&1 && sleep 5"
                        Invoke-SshCommand $h.User $h.Host $h.Port $h.SshKey $restartCmd | Out-Null
                        if ($LASTEXITCODE -ne 0) { throw "服务重启失败" }

                        # 健康检查
                        $healthCmd = "curl -s http://localhost:9000/api/health 2>/dev/null"
                        $health = Invoke-SshCommand $h.User $h.Host $h.Port $h.SshKey $healthCmd
                        $health = $health -join "`n"
                        if ($health -notmatch '"status":"ok"') { throw "健康检查失败" }
                    }
                    catch {
                        $status = 'failed'
                        $errMsg = $_.Exception.Message
                    }

                    $sw.Stop()
                    $duration = [int]$sw.Elapsed.TotalSeconds
                    "$($h.Host)|$status|$duration|$errMsg" | Out-File $resultFile -Append -Encoding utf8

                    [PSCustomObject]@{ Host = $h.Host; Status = $status; Duration = $duration; Error = $errMsg }
                } -ArgumentList $h, $resultFile, $ProjectDir, $Timeout

                $jobs += $job
                $running++
            }

            # 等待所有完成并输出结果
            $results = $jobs | Wait-Job | Receive-Job
            $jobs | Remove-Job -Force

            foreach ($r in $results) {
                if ($r.Status -eq 'success') {
                    Write-Host "  ✓ " -ForegroundColor Green -NoNewline
                    Write-Host "$($r.Host)  成功 ($($r.Duration)s)"
                } else {
                    Write-Host "  ✗ " -ForegroundColor Red -NoNewline
                    Write-Host "$($r.Host)  失败: $($r.Error) ($($r.Duration)s)"
                }
            }
        }

        # 汇总
        Write-Header "部署结果汇总"
        $success = 0; $failed = 0; $totalTime = 0
        Get-Content $resultFile | ForEach-Object {
            if ([string]::IsNullOrWhiteSpace($_)) { return }
            $parts = $_ -split '\|', 4
            if ($parts[1] -eq 'success') { $success++ } else { $failed++ }
            $totalTime += [int]$parts[2]
        }

        Write-Host "  总数: $total"
        Write-Host "  成功: " -NoNewline; Write-Host $success -ForegroundColor Green
        Write-Host "  失败: " -NoNewline; Write-Host $failed -ForegroundColor Red
        Write-Host "  累计耗时: ${totalTime}s"
        Write-Host ""

        if ($failed -gt 0) {
            Write-Warn "以下机器部署失败："
            Get-Content $resultFile | ForEach-Object {
                if ($_ -match '\|failed\|') {
                    $parts = $_ -split '\|', 4
                    Write-Host "    - $($parts[0]): $($parts[3])"
                }
            }
            Write-Host ""
            Write-Info "详细日志目录: $env:TEMP\geo-deploy-*.log"
            exit 1
        } else {
            Write-Info "✅ 全部部署成功！"
        }
    }

    'status' {
        Write-Header "机器状态"
        foreach ($h in $hosts) {
            Get-StatusOne $h
        }
    }

    'backup' {
        Write-Header "数据库备份"
        foreach ($h in $hosts) {
            Backup-One $h
        }
    }
}

Remove-Item $resultFile -Force -ErrorAction SilentlyContinue
