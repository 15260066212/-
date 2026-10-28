import Database from 'better-sqlite3';
import { createHash } from 'crypto';

const db = new Database('/home/ubuntu/geo-assistant-clean/apps/data/geo-assistant.db');
const newPassword = 'admin123';
const hash = createHash('sha256').update(newPassword).digest('hex');

db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(hash, 'admin');
console.log(`Reset admin password to "${newPassword}"`);
console.log(`Hash: ${hash}`);

const verify = db.prepare('SELECT username, password_hash FROM users WHERE username = ?').get('admin');
console.log(`Verify: ${verify.password_hash === hash ? 'OK' : 'FAIL'}`);

db.close();
