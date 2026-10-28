#!/usr/bin/env python3
"""检查 platform_credentials 表"""
import sqlite3
import os

# 检查可能的数据库位置
db_paths = [
    '/home/ubuntu/geo-assistant-clean/apps/data/geo-assistant.db',
    '/home/ubuntu/geo-assistant-clean/data/geo-assistant.db',
    '/home/ubuntu/geo-assistant-clean/apps/server/data/geo-assistant.db',
]

for db_path in db_paths:
    if not os.path.exists(db_path):
        continue
    print(f"\n=== 数据库: {db_path} ===")
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    
    # 列出所有表
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    tables = [r[0] for r in cur.fetchall()]
    print(f"表: {tables}")
    
    if 'platform_credentials' in tables:
        cur.execute("SELECT COUNT(*) FROM platform_credentials")
        count = cur.fetchone()[0]
        print(f"platform_credentials 总数: {count}")
        cur.execute("SELECT platform, account_id, status, account_name, cookie_count FROM platform_credentials ORDER BY id DESC LIMIT 10")
        rows = cur.fetchall()
        print("最近 10 条:")
        for row in rows:
            print(f"  {row[0]} / {row[1]} / {row[2]} / {row[3]} / cookies={row[4]}")
    
    conn.close()
