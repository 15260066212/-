const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'apps', 'data', 'geo-assistant.db');
const db = new sqlite3.Database(dbPath);

// 查看所有表
db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
  if (err) { console.error('Tables error:', err); db.close(); return; }
  console.log('=== 数据库表列表 ===');
  tables.forEach(t => console.log('  ' + t.name));
  
  // 查询所有文章，过滤新途科技相关
  db.all(`
    SELECT id, title, status, content_plain, word_count, platform, publish_url, created_at
    FROM articles 
    WHERE title LIKE '%新途%' OR title LIKE '%XTAUTO%' OR title LIKE '%GEO优化%' OR title LIKE '%自动化发布%'
    ORDER BY created_at DESC
    LIMIT 20
  `, (err2, rows) => {
    if (err2) { console.error('Query error:', err2); db.close(); return; }
    
    console.log('\n=== 新途科技相关文章 ===');
    console.log(`共 ${rows.length} 篇\n`);
    
    rows.forEach((r, i) => {
      const len = r.content_plain ? r.content_plain.length : (r.word_count || 0);
      console.log(`${i+1}. [${r.id}] ${r.title?.substring(0, 60)}`);
      console.log(`   状态: ${r.status} | 字数: ${len} | 平台: ${r.platform}`);
      console.log(`   发布URL: ${r.publish_url || '未发布'}`);
      console.log('');
    });
    
    db.close();
  });
});
