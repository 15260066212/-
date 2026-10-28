#!/usr/bin/env python3
"""检查凭证数据"""
import sqlite3

db_path = '/home/ubuntu/geo-assistant-clean/apps/data/geo-assistant.db'
conn = sqlite3.connect(db_path)
cur = conn.cursor()

print("=== 所有凭证 (按 platform 分组) ===")
cur.execute("SELECT platform, account_id, status, account_name, credential_type, created_at, updated_at FROM platform_credentials ORDER BY platform, account_id")
rows = cur.fetchall()
print(f"总数: {len(rows)}")
for row in rows:
    print(f"  {row[0]:15s} {row[1]:20s} {row[2]:8s} name={row[3] or 'NULL':15s} type={row[4]} created={row[5][:19] if row[5] else 'NULL'}")

# 特别检查 toutiao/toutiaohao
print()
print("=== 今日头条相关凭证 ===")
cur.execute("SELECT platform, account_id, status, account_name FROM platform_credentials WHERE platform LIKE '%toutiao%'")
rows = cur.fetchall()
for row in rows:
    print(f"  {row[0]} / {row[1]} / {row[2]} / {row[3]}")

conn.close()
