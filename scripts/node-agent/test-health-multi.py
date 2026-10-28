#!/usr/bin/env python3
"""测试多个 Profile 的健康检查"""
import json
import urllib.request
import urllib.error

# 测试几个可能有登录态的 profile
test_cases = [
    ('toutiaohao', 'default'),
    ('zhihu', 'default'),
    ('toutiaohao', '漳州肛肠医院'),
]

for platform, account in test_cases:
    url = f'http://localhost:3000/api/profiles/{platform}/{urllib.parse.quote(account)}/health'
    try:
        with urllib.request.urlopen(url, timeout=30) as resp:
            data = json.loads(resp.read())
            status = '✅ 已登录' if data.get('isLoggedIn') else '❌ 未登录'
            print(f"{platform}/{account}: {status}")
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:100]
        print(f"{platform}/{account}: ❌ HTTP {e.code} - {body}")
    except Exception as e:
        print(f"{platform}/{account}: ❌ {e}")
