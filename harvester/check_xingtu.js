const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', '..', 'geo-workspace', 'GEO-assistant-new', 'apps', 'data', 'xingtu.db');
console.log('DB Path:', dbPath);

const db = new sqlite3.Database(dbPath);

// 查看所有表
db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
  if (err) { console.error('Tables error:', err); db.close(); return; }
  console.log('=== 数据库表列表 ===');
  tables.forEach(t => console.log('  ' + t.name));
  
  // 查看article相关表结构
  db.all("PRAGMA table_info(articles)", (err2, cols) => {
    if (err2) { 
      // 试试其他表名
      db.all("PRAGMA table_info(article)", (err3, cols2) => {
        if (err3) { console.log('找不到articles/article表'); db.close(); return; }
        console.log('\n=== article表结构 ===');
        cols2.forEach(c => console.log(`  ${c.name} (${c.type})`));
        queryArticles(db);
      });
      return; 
    }
    console.log('\n=== articles表结构 ===');
    cols.forEach(c => console.log(`  ${c.name} (${c.type})`));
    queryArticles(db);
  });
});

function queryArticles(db) {
  db.all(`
    SELECT * FROM articles 
    WHERE title LIKE '%新途%' OR title LIKE '%XTAUTO%' OR title LIKE '%GEO优化%'
    ORDER BY created_at DESC
    LIMIT 20
  `, (err, rows) => {
    if (err) { console.error('Query error:', err); db.close(); return; }
    
    console.log('\n=== 新途科技相关文章 ===');
    console.log(`共 ${rows.length} 篇\n`);
    
    rows.forEach((r, i) => {
      console.log(`${i+1}. [${r.id}] ${r.title?.substring(0, 60)}`);
      console.log(`   状态: ${r.status} | 品牌: ${r.brand || 'N/A'}`);
      console.log(`   头条URL: ${r.toutiao_url || r.publish_url || '未发布'}`);
      console.log('');
    });
    
    db.close();
  });
}
