#!/usr/bin/env python3
import json
import sys
import urllib.request

req = urllib.request.Request('http://localhost:3000/api/nodes/')
with urllib.request.urlopen(req) as resp:
    data = json.loads(resp.read())

print(f"总节点数: {data['total']}")
print()
for n in data['nodes']:
    status_icon = '🟢' if n['status'] == 'online' else '🔴' if n['status'] == 'offline' else '🟡'
    print(f"{status_icon} {n['name']} ({n['nodeId']})")
    print(f"   状态: {n['status']}")
    print(f"   版本: {n['version']}")
    print(f"   平台数: {n['platformCount']}")
    print(f"   活跃会话: {n['activeSessions']}")
    print(f"   OS: {n['os']}")
    print(f"   CPU: {n['cpuCores']}核, 内存: {n['memoryMB']}MB")
    print(f"   标签: {', '.join(n['tags']) if n['tags'] else '无'}")
    print(f"   最后心跳: {n['lastHeartbeatAt']}")
    print()
