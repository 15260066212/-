#!/usr/bin/env python3
import json
import urllib.request

with urllib.request.urlopen('http://localhost:3000/api/profiles') as r:
    d = json.loads(r.read())

print(f"Total: {d['total']}")
print(f"Success: {d['success']}")
for p in d['profiles'][:3]:
    cred = p.get('credential')
    print(f"  {p.get('platformName', p.get('platform','?'))} - {p.get('accountName', '?')}")
    if cred:
        print(f"    Cookie: {cred.get('cookieCount',0)}个, 状态: {cred.get('status','?')}")
        print(f"    账号名: {cred.get('accountName', '?')}")
    else:
        print(f"    无关联凭证")
print(f"  ... and {len(d['profiles'])-3} more")

# 统计有/无凭证的数量
with_cred = sum(1 for p in d['profiles'] if p.get('credential'))
without_cred = len(d['profiles']) - with_cred
print(f"\n有凭证: {with_cred}, 无凭证: {without_cred}")
