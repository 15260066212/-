#!/usr/bin/env python3
"""检查 cookie 采集后的保存状态"""
import json
import urllib.request
import urllib.error
import sqlite3
import os

print("=== 1. 检查 Harvester 凭证 ===")
try:
    with open('/home/ubuntu/geo-assistant-clean/harvester/data/credentials.json') as f:
        creds = json.load(f)
    print(f"Harvester 凭证数量: {len(creds)}")
    for k, v in list(creds.items())[:5]:
        print(f"  {k}: {v.get('platform', '?')} / {v.get('accountName', '?')} / cookieCount={v.get('cookieCount', '?')}")
except Exception as e:
    print(f"错误: {e}")

print()
print("=== 2. 检查后端 SQLite 凭证 ===")
try:
    db_path = '/home/ubuntu/geo-assistant-clean/apps/data/geo-assistant.db'
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM credentials")
    count = cur.fetchone()[0]
    print(f"SQLite 凭证总数: {count}")
    cur.execute("SELECT platform, account_id, status, account_name FROM credentials ORDER BY id DESC LIMIT 10")
    rows = cur.fetchall()
    print("最近 10 条:")
    for row in rows:
        print(f"  {row[0]} / {row[1]} / {row[2]} / {row[3]}")
    conn.close()
except Exception as e:
    print(f"错误: {e}")

print()
print("=== 3. 检查 Profile 目录 ===")
profile_dir = '/home/ubuntu/geo-assistant-clean/harvester/data/browser-profiles'
if os.path.exists(profile_dir):
    items = os.listdir(profile_dir)
    chrome_profiles = [d for d in items if d.startswith('chrome-')]
    sessions_dir = os.path.join(profile_dir, 'sessions')
    session_count = 0
    if os.path.exists(sessions_dir):
        session_count = len(os.listdir(sessions_dir))
    print(f"持久化 Profile: {len(chrome_profiles)} 个")
    for p in sorted(chrome_profiles):
        ppath = os.path.join(profile_dir, p)
        size = sum(os.path.getsize(os.path.join(dp, f)) for dp, dn, fn in os.walk(ppath) for f in fn)
        print(f"  {p}: {size/1024/1024:.1f} MB")
    print(f"临时 Session 目录: {session_count} 个")
else:
    print("Profile 目录不存在")
