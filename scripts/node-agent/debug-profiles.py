#!/usr/bin/env python3
import json
import urllib.request

# Harvester
print("=== Harvester ===")
with urllib.request.urlopen('http://localhost:3003/api/profiles') as r:
    d = json.loads(r.read())
p = d['profiles'][0]
print("字段:", sorted(p.keys()))
print(f"  account: {p.get('account')}")
print(f"  accountName: {p.get('accountName')}")
print(f"  sizeMB: {p.get('sizeMB')}")

print()
print("=== Backend ===")
with urllib.request.urlopen('http://localhost:3000/api/profiles') as r:
    d = json.loads(r.read())
p = d['profiles'][0]
print("字段:", sorted(p.keys()))
print(f"  account: {p.get('account')}")
print(f"  accountName: {p.get('accountName')}")
print(f"  sizeMB: {p.get('sizeMB')}")
print(f"  credential: {p.get('credential')}")
