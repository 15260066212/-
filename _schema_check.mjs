import Database from 'better-sqlite3';
const db = new Database('/home/ubuntu/geo-assistant-clean/apps/data/geo-assistant.db', { readonly: true });

// Show all tables and their columns
console.log('=== TABLES ===');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log(tables.map(t => t.name).join(', '));

for (const t of tables) {
  const cols = db.prepare("PRAGMA table_info(" + t.name + ")").all();
  console.log("\n--- " + t.name + " ---");
  cols.forEach(c => console.log("  " + c.name + " (" + c.type + ")"));
}

db.close();
