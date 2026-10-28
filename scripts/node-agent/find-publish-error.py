#!/usr/bin/env python3
"""检查发布失败的详细日志"""
import subprocess
import json

# 获取最近的发布错误日志
result = subprocess.run(
    ['pm2', 'logs', 'geo-assistant', '--lines', '200', '--nostream', '--raw'],
    capture_output=True, text=True, timeout=10
)
logs = result.stdout + result.stderr

# 搜索关键错误
keywords = ['remotePublisher', 'publish is not a function', 'Publish attempt', 'task_1792057099', 'toutiao']

print("=== 相关日志 ===")
lines = logs.split('\n')
for i, line in enumerate(lines):
    for kw in keywords:
        if kw in line:
            # 打印前后 2 行
            start = max(0, i-2)
            end = min(len(lines), i+3)
            for j in range(start, end):
                marker = '>>>' if j == i else '   '
                print(f"{marker} {lines[j][:300]}")
            print("---")
            break
