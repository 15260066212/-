#!/usr/bin/env python3
import json
import sys
from collections import defaultdict

data = json.load(sys.stdin)
creds = data.get('data', [])

print(f"总凭证数: {len(creds)}")
print()

by_platform = defaultdict(list)
for c in creds:
    by_platform[c['platform']].append(c)

for platform in sorted(by_platform.keys()):
    items = by_platform[platform]
    print(f"{platform} ({len(items)}个账号):")
    for c in items:
        name = c.get('accountName', '') or ''
        print(f"  - {c['accountId']} | {name} | {c['status']}")
