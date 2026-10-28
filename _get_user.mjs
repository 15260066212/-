import Database from 'better-sqlite3';
const db = new Database('/home/ubuntu/geo-assistant-clean/apps/data/geo-assistant.db', { readonly: true });
const users = db.prepare('SELECT id, username, display_name, role FROM users').all();
console.log(JSON.stringify(users, null, 2));
db.close();
