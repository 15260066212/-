#!/usr/bin/env python3
"""检查发布日志 - 先看表结构"""
import sqlite3

db_path = '/home/ubuntu/geo-assistant-clean/apps/data/geo-assistant.db'
conn = sqlite3.connect(db_path)
cur = conn.cursor()

print("=== publish_logs 表结构 ===")
cur.execute("PRAGMA table_info(publish_logs)")
cols = cur.fetchall()
for col in cols:
    print(f"  {col[1]} ({col[2]})")

print()
print("=== 最近 20 条发布日志 ===")
cur.execute("SELECT * FROM publish_logs ORDER BY id DESC LIMIT 20")
rows = cur.fetchall()
col_names = [d[0] for d in cur.description]
print(f"列: {col_names}")
print(f"共 {len(rows)} 条")
for row in rows[:5]:
    d = dict(zip(col_names, row))
    status = d.get('status', '?')
    icon = '✅' if status == 'success' else '❌' if status == 'failed' else '⏳'
    print(f"\n{icon} #{d.get('id')} | {d.get('platform')} / {d.get('account_id', d.get('account', '?'))} | {status}")
    for k, v in d.items():
        if k in ('id',):
            continue
        if v and str(v) not in ('', 'None'):
            val_str = str(v)[:100]
            print(f"   {k}: {val_str}")

conn.close()
