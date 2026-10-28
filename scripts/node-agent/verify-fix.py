#!/usr/bin/env python3
"""验证修复效果"""
import json
import urllib.request
import urllib.error

print("=== 1. 检查 Harvester 健康状态 ===")
try:
    with urllib.request.urlopen('http://localhost:3003/health', timeout=5) as resp:
        data = json.loads(resp.read())
        print(f"  ✅ Harvester 在线: {data}")
except Exception as e:
    print(f"  ❌ {e}")

print()
print("=== 2. 检查后端 cookie-harvester 健康状态 ===")
try:
    with urllib.request.urlopen('http://localhost:3000/api/cookie-harvester/health', timeout=5) as resp:
        data = json.loads(resp.read())
        print(f"  ✅ 后端代理正常: {data}")
except Exception as e:
    print(f"  ❌ {e}")

print()
print("=== 3. 检查支持的平台列表 ===")
try:
    with urllib.request.urlopen('http://localhost:3003/api/platforms', timeout=5) as resp:
        data = json.loads(resp.read())
        platforms = data.get('platforms', [])
        print(f"  ✅ Harvester 支持 {len(platforms)} 个平台:")
        for p in platforms[:5]:
            print(f"    - {p.get('id')}: {p.get('name')}")
        if len(platforms) > 5:
            print(f"    ... 还有 {len(platforms)-5} 个")
except Exception as e:
    print(f"  ❌ {e}")

print()
print("=== 4. 验证后端凭证保存 (模拟测试) ===")
print("  需要实际启动浏览器会话才能完整测试")
print("  修复内容:")
print("    - 后端: 从 harvester 返回的 platform 字段反向映射，不依赖前端传参")
print("    - Harvester: 会话关闭时自动保存已登录的 profile")
print("    - Harvester: /cookies 接口返回 accountName, profileSaved, profilePath")

print()
print("=== 5. 检查当前 profile 数量 ===")
import os
profile_dir = '/home/ubuntu/geo-assistant-clean/harvester/data/browser-profiles'
if os.path.exists(profile_dir):
    items = os.listdir(profile_dir)
    chrome_profiles = sorted([d for d in items if d.startswith('chrome-')])
    print(f"  持久化 Profile: {len(chrome_profiles)} 个")
    print(f"  最新 3 个: {chrome_profiles[-3:]}")
