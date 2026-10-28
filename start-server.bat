@echo off
rem GEO server 持久启动脚本（供计划任务调用，脱离交互终端存活）
cd /d "%~dp0apps\server"
node dist\index.js 1>"%~dp0_server.out.log" 2>"%~dp0_server.err.log"
