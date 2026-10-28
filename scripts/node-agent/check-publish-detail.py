#!/usr/bin/env python3
"""查看发布任务详情"""
import sqlite3
import json

db_path = '/home/ubuntu/geo-assistant-clean/apps/data/geo-assistant.db'
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

# 1. 查看 publish_tasks 表
print("=== publish_tasks 表结构 ===")
cur.execute("PRAGMA table_info(publish_tasks)")
for col in cur.fetchall():
    print(f"  {col['name']} ({col['type']})")

print()
print("=== 最近 10 个发布任务 ===")
cur.execute("SELECT * FROM publish_tasks ORDER BY created_at DESC LIMIT 10")
tasks = cur.fetchall()
col_names = [d[0] for d in cur.description]
for task in tasks:
    d = dict(zip(col_names, task))
    status = d.get('status', '?')
    icon = '✅' if status == 'published' else '❌' if status == 'failed' else '⏳'
    print(f"\n{icon} {d.get('id', '?')}")
    for k, v in d.items():
        if v and str(v) not in ('', 'None'):
            val_str = str(v)[:150]
            print(f"   {k}: {val_str}")

# 2. 查看失败任务对应的发布日志
print()
print("=" * 80)
print("失败任务的完整错误日志")
print("=" * 80)
cur.execute("""
    SELECT task_id, level, message, metadata, created_at 
    FROM publish_logs 
    WHERE level = 'error' 
    ORDER BY created_at DESC 
    LIMIT 5
""")
for row in cur.fetchall():
    print(f"\n--- {row['created_at']} ---")
    print(f"Task: {row['task_id']}")
    print(f"Level: {row['level']}")
    print(f"Message: {row['message']}")
    if row['metadata']:
        try:
            meta = json.loads(row['metadata'])
            print(f"Metadata: {json.dumps(meta, indent=2, ensure_ascii=False)[:500]}")
        except:
            print(f"Metadata: {row['metadata'][:500]}")

conn.close()
