#!/usr/bin/env python3
"""修复 rpa-engine.ts 中的 remotePublisher 调用"""
import os

file_path = '/home/ubuntu/geo-assistant-clean/packages/publisher/src/rpa-engine.ts'
with open(file_path, 'r') as f:
    content = f.read()

old = 'return this.remotePublisher.publish(article, credentials, accountId);'
new = 'return this.remotePublisher.remotePublish(credentials.platform as PlatformId, article, credentials);'

if old in content:
    content = content.replace(old, new)
    with open(file_path, 'w') as f:
        f.write(content)
    print("✅ 修复成功")
else:
    print("❌ 未找到需要替换的内容")
    # 看看实际的内容
    for i, line in enumerate(content.split('\n')):
        if 'remotePublisher' in line:
            print(f"  行 {i+1}: {line.strip()}")
