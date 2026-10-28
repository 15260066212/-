#!/usr/bin/env python3
"""检查 platform_credentials 表结构和数据"""
import sqlite3

db_path = '/home/ubuntu/geo-assistant-clean/apps/data/geo-assistant.db'
conn = sqlite3.connect(db_path)
cur = conn.cursor()

print("=== platform_credentials 表结构 ===")
cur.execute("PRAGMA table_info(platform_credentials)")
cols = cur.fetchall()
for col in cols:
    print(f"  {col[1]} ({col[2]})")

print()
print("=== 所有凭证 ===")
cur.execute("SELECT id, platform, account_id, status, account_name, brand_id FROM platform_credentials ORDER BY id DESC")
rows = cur.fetchall()
for row in rows:
    print(f"  #{row[0]} {row[1]} / {row[2]} / {row[3]} / name={row[4]} / brand={row[5]}")

conn.close()
