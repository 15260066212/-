#!/usr/bin/env python3
"""检查发布日志"""
import sqlite3

db_path = '/home/ubuntu/geo-assistant-clean/apps/data/geo-assistant.db'
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

print("=" * 100)
print("最近 20 条发布日志")
print("=" * 100)

cur.execute("SELECT id, article_id, platform, account_id, status, error_message, created_at FROM publish_logs ORDER BY id DESC LIMIT 20")
rows = cur.fetchall()

for row in rows:
    status_icon = '✅' if row['status'] == 'success' else '❌' if row['status'] == 'failed' else '⏳'
    print(f"\n{status_icon} #{row['id']} | {row['platform']} / {row['account_id']} | {row['status']}")
    print(f"   文章ID: {row['article_id']}")
    print(f"   时间: {row['created_at']}")
    if row['error_message']:
        err = row['error_message'][:200]
        print(f"   错误: {err}")

# 统计
print()
print("=" * 100)
print("发布状态统计")
print("=" * 100)
cur.execute("SELECT status, COUNT(*) as cnt FROM publish_logs GROUP BY status ORDER BY cnt DESC")
for row in cur.fetchall():
    print(f"  {row['status']:15s}: {row['cnt']} 条")

# 失败统计
print()
print("=" * 100)
print("失败的发布（最近10条详细信息）")
print("=" * 100)
cur.execute("""
    SELECT id, article_id, platform, account_id, status, error_message, 
           error_type, retry_count, created_at, completed_at
    FROM publish_logs 
    WHERE status = 'failed' 
    ORDER BY id DESC 
    LIMIT 10
""")
failed = cur.fetchall()
if not failed:
    print("  暂无失败记录")
else:
    for row in failed:
        print(f"\n❌ #{row['id']} | {row['platform']} / {row['account_id']}")
        print(f"   文章ID: {row['article_id']}")
        print(f"   错误类型: {row['error_type'] or 'N/A'}")
        print(f"   重试次数: {row['retry_count'] or 0}")
        print(f"   创建: {row['created_at']}")
        print(f"   完成: {row['completed_at']}")
        if row['error_message']:
            print(f"   错误详情:")
            print(f"   {row['error_message'][:500]}")

# 按平台统计失败率
print()
print("=" * 100)
print("各平台发布统计")
print("=" * 100)
cur.execute("""
    SELECT platform, 
           COUNT(*) as total,
           SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) as success,
           SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed,
           SUM(CASE WHEN status='pending' OR status='processing' THEN 1 ELSE 0 END) as pending
    FROM publish_logs 
    GROUP BY platform 
    ORDER BY total DESC
""")
for row in cur.fetchall():
    total = row['total'] or 0
    success = row['success'] or 0
    rate = (success / total * 100) if total > 0 else 0
    print(f"  {row['platform']:15s}: 总数{total:3d} 成功{success:3d} 失败{row['failed'] or 0:3d} 成功率 {rate:5.1f}%")

conn.close()
