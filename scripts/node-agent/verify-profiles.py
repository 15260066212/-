#!/usr/bin/env python3
import json
import urllib.request

print("=== Harvester profiles API ===")
with urllib.request.urlopen('http://localhost:3003/api/profiles') as r:
    d = json.loads(r.read())
print(f"Total profiles: {d['total']}")
for p in d['profiles'][:5]:
    print(f"  {p['platformName']} - {p['account']} ({p['sizeBytes']//1024}KB)")
if len(d['profiles']) > 5:
    print(f"  ... and {len(d['profiles'])-5} more")

print()
print("=== Backend profiles API ===")
try:
    with urllib.request.urlopen('http://localhost:3000/api/profiles/') as r:
        d = json.loads(r.read())
    print(f"Success: {d.get('success', False)}")
    if d.get('success'):
        print(f"Total profiles: {d.get('total', 0)}")
        for p in d.get('profiles', [])[:5]:
            print(f"  {p.get('platformName', p.get('platform','?'))} - {p.get('account', '?')}")
    else:
        print(f"Error: {d.get('error', 'unknown')}")
except Exception as e:
    print(f"Error: {e}")
