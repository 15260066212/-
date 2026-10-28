// 直接测试 credential repository
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

async function main() {
  try {
    const schemaPath = path.resolve(__dirname, '../schema.js');
    const dbPath = path.resolve(__dirname, '../../../data/geo-assistant.db');
    
    const { initDatabase } = await import(schemaPath);
    
    const Database = require('better-sqlite3');
    console.log('DB path:', dbPath);
    
    const db = new Database(dbPath);
    initDatabase(db);
    
    // 直接用 raw SQL 测试
    console.log('\n=== Raw SQL: SELECT * FROM platform_credentials LIMIT 3 ===');
    const rows = db.prepare('SELECT * FROM platform_credentials LIMIT 3').all();
    console.log('Row count:', rows.length);
    rows.forEach(r => console.log('  platform:', r.platform, 'account_id:', r.account_id, 'status:', r.status));
    
    // 测试 credential repository
    const { DatabaseAccess } = await import(path.resolve(__dirname, '../db.js'));
    const dbAccess = new DatabaseAccess(db);
    
    console.log('\n=== Testing getAllCredentials ===');
    try {
      const creds = dbAccess.credentials.getAllCredentials('user_default');
      console.log('Success! Count:', creds.length);
      creds.slice(0, 5).forEach(c => console.log(`  - ${c.platform} | ${c.accountId} | ${c.status}`));
    } catch(e) {
      console.error('getAllCredentials error:', e.message);
      console.error(e.stack);
    }
    
    db.close();
    console.log('\nDone.');
  } catch(e) {
    console.error('Fatal error:', e.message);
    console.error(e.stack);
  }
}

main();
