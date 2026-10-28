-- 清理脏数据：platform 包含冒号的错误记录（第一次同步时的遗留）
DELETE FROM platform_credentials WHERE platform LIKE '%:%' AND account_id = 'node-dc91b9a42895';

-- 查看清理后的结果
.headers on
.mode column
.width 15 25 20 10
SELECT platform, account_id, account_name, status 
FROM platform_credentials 
ORDER BY platform, account_id;

-- 统计每个平台的账号数
SELECT '--- 各平台账号统计 ---' as '';
SELECT platform, COUNT(*) as account_count 
FROM platform_credentials 
GROUP BY platform 
ORDER BY platform;
