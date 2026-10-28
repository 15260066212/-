#!/usr/bin/env python3
"""测试 Profile 健康检查接口"""
import json
import urllib.request
import urllib.error

print("=== 测试 Harvester health check ===")
url = 'http://localhost:3003/api/profiles/baijiahao/default/health'
try:
    with urllib.request.urlopen(url, timeout=30) as resp:
        data = json.loads(resp.read())
        print(f"Status: {resp.status}")
        print(f"Response: {json.dumps(data, indent=2, ensure_ascii=False)}")
except urllib.error.HTTPError as e:
    print(f"HTTP Error: {e.code}")
    print(f"Body: {e.read().decode()[:300]}")
except Exception as e:
    print(f"Error: {e}")

print()
print("=== 测试 Backend health check ===")
url2 = 'http://localhost:3000/api/profiles/baijiahao/default/health'
try:
    with urllib.request.urlopen(url2, timeout=30) as resp:
        data = json.loads(resp.read())
        print(f"Status: {resp.status}")
        print(f"Response: {json.dumps(data, indent=2, ensure_ascii=False)}")
except urllib.error.HTTPError as e:
    print(f"HTTP Error: {e.code}")
    print(f"Body: {e.read().decode()[:300]}")
except Exception as e:
    print(f"Error: {e}")
