import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const edgeCookiePath = 'C:\\Users\\Administrator\\AppData\\Local\\Microsoft\\Edge\\User Data\\Default\\Network\\Cookies';
const tempPath = path.join(os.tmpdir(), `edge_cookies_${Date.now()}.db`);

console.log('复制 Edge Cookie 数据库到临时文件...');
fs.copyFileSync(edgeCookiePath, tempPath);
console.log(`已复制到: ${tempPath}`);

try {
  const db = new Database(tempPath);
  const total = db.prepare('SELECT COUNT(*) as cnt FROM cookies').get();
  console.log(`\nCookie 总数: ${total.cnt}`);
  
  // 查找今日头条相关
  const ttCookies = db.prepare(`SELECT name, host_key, path, expires_utc, is_secure, is_httponly, length(encrypted_value) as enc_len 
    FROM cookies 
    WHERE host_key LIKE '%toutiao%' 
       OR host_key LIKE '%bytedance%'
       OR host_key LIKE '%toutiaohao%'
       OR host_key LIKE '.toutiao%'
    ORDER BY host_key, name`).all();
  
  console.log(`\n今日头条相关 Cookie: ${ttCookies.length} 个`);
  
  if (ttCookies.length > 0) {
    console.log('\nCookie 列表:');
    ttCookies.forEach(c => {
      const expiry = c.expires_utc > 0 
        ? new Date((c.expires_utc - 11644473600000000) / 1000).toISOString().substring(0, 10)
        : 'session';
      const flags = [c.is_secure ? 'S' : '', c.is_httponly ? 'H' : ''].join('');
      console.log(`  [${c.host_key}] ${c.name} [${flags || '-'}] exp: ${expiry} (enc: ${c.enc_len} bytes)`);
    });
    
    // 检查关键认证 Cookie
    const keyNames = ['sessionid', 'sessionid_ss', 'sid_tt', 'uid_tt', 'sid_guard', 'passport_csrf_token', 'tt_scid'];
    console.log('\n关键认证 Cookie:');
    for (const name of keyNames) {
      const found = ttCookies.filter(c => c.name === name);
      if (found.length > 0) {
        found.forEach(f => {
          console.log(`  ✅ ${f.name} @ ${f.host_key} (enc_len: ${f.enc_len})`);
        });
      } else {
        console.log(`  ❌ ${name}`);
      }
    }
  } else {
    console.log('\n未找到今日头条相关 Cookie');
    console.log('\n所有 host_key 列表 (前30):');
    const hosts = db.prepare('SELECT DISTINCT host_key FROM cookies LIMIT 30').all();
    hosts.forEach(h => console.log('  ', h.host_key));
  }
  
  db.close();
} catch (e) {
  console.log('读取失败:', e.message);
} finally {
  // 清理临时文件
  try { fs.unlinkSync(tempPath); } catch(e) {}
}
