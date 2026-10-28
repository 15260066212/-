// 直接测试 credential repository
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const path = require('path');

process.chdir('/home/ubuntu/geo-assistant-clean/apps/server');

async function main() {
  try {
    const { initDatabase } = await import('./dist/schema.js');
    const { DatabaseAccess } = await import('./dist/db.js');
    
    // 手动初始化数据库
    const Database = require('better-sqlite3');
    const dbPath = path.resolve('/home/ubuntu/geo-assistant-clean/apps/data/geo-assistant.db');
    console.log('DB path:', dbPath);
    
    const db = new Database(dbPath);
    initDatabase(db);
    
    const dbAccess = new DatabaseAccess(db);
    
    console.log('\n=== Testing getAllCredentials ===');
    try {
      const creds = dbAccess.credentials.getAllCredentials('user_default');
      console.log('Success! Count:', creds.length);
      creds.forEach(c => console.log(`  - ${c.platform} | ${c.accountId} | ${c.status}`));
    } catch(e) {
      console.error('getAllCredentials error:', e.message);
      console.error(e.stack);
    }
    
    console.log('\n=== Testing getCredentialsByPlatform(toutiaohao) ===');
    try {
      const creds = dbAccess.credentials.getCredentialsByPlatform('toutiaohao', 'user_default');
      console.log('Success! Count:', creds.length);
    } catch(e) {
      console.error('getCredentialsByPlatform error:', e.message);
      console.error(e.stack);
    }
    
    db.close();
  } catch(e) {
    console.error('Fatal error:', e.message);
    console.error(e.stack);
  }
}

main();
