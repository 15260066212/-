#!/usr/bin/env python3
"""测试部署功能链路"""
import json
import urllib.request
import time

BASE_URL = 'http://localhost:3000'

def api(method, path, data=None):
    url = BASE_URL + path
    body = json.dumps(data).encode() if data else None
    headers = {'Content-Type': 'application/json'} if data else {}
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())

print("=== 步骤 1: 获取节点列表 ===")
nodes = api('GET', '/api/nodes/')
online_nodes = [n for n in nodes['nodes'] if n['status'] == 'online']
print(f"在线节点数: {len(online_nodes)}")
for n in online_nodes:
    print(f"  - {n['name']} ({n['nodeId']})")

if not online_nodes:
    print("没有在线节点，跳过部署测试")
    exit(0)

print()
print("=== 步骤 2: 创建部署批次 ===")
batch_name = f"测试部署-{int(time.time())}"
node_ids = [n['nodeId'] for n in online_nodes]
result = api('POST', '/api/nodes/deploy/batch', {
    'name': batch_name,
    'nodeIds': node_ids,
    'targetVersion': 'test-v1.0.0',
    'createdBy': 'system-test',
})
print(f"创建结果: {result.get('success', '?')}")
if result.get('success'):
    batch = result.get('batch', {})
    print(f"批次ID: {batch.get('batchId', '?')}")
    print(f"任务数: {batch.get('taskCount', '?')}")
    print(f"状态: {batch.get('status', '?')}")
    batch_id = batch.get('batchId')
else:
    print(f"错误: {result.get('error', 'unknown')}")
    exit(1)

print()
print("=== 步骤 3: 等待 15 秒后检查批次状态 ===")
time.sleep(15)

detail = api('GET', f'/api/nodes/deploy/batches/{batch_id}')
print(f"批次状态: {detail.get('batch', {}).get('status', '?')}")
tasks = detail.get('tasks', [])
print(f"任务数: {len(tasks)}")
for t in tasks:
    print(f"  - {t['nodeId']}: {t['status']} (耗时: {t.get('durationMs', 0)}ms)")
    if t.get('error'):
        print(f"    错误: {t['error']}")

print()
print("=== 步骤 4: 查看节点部署任务历史 ===")
for n in online_nodes:
    history = api('GET', f'/api/nodes/{n["nodeId"]}/deploy/tasks')
    task_list = history.get('tasks', [])
    print(f"{n['name']}: {len(task_list)} 条任务")
    for t in task_list[:3]:
        print(f"  - {t['taskId']}: {t['status']} (目标版本: {t.get('targetVersion', '?')})")
