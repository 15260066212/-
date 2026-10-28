import Database from 'better-sqlite3';
const db = new Database('/home/ubuntu/geo-assistant-clean/apps/data/geo-assistant.db', { readonly: true });

// Find sessions with enterprise data
console.log('=== SESSIONS WITH ENTERPRISE DATA ===');
const allSessions = db.prepare('SELECT id, data FROM sessions ORDER BY created_at DESC LIMIT 20').all();
for (const s of allSessions) {
  try {
    const d = JSON.parse(s.data || '{}');
    const hasEnt = d.enterprise && (d.enterprise.fullName || d.enterprise.shortName);
    const hasKw = d.keywords && d.keywords.length > 0;
    if (hasEnt || hasKw) {
      const ent = d.enterprise || {};
      console.log(JSON.stringify({
        id: s.id,
        enterprise: ent.fullName || ent.shortName || '(none)',
        keywordsCount: (d.keywords || []).length,
        hasProducts: !!(ent.products && ent.products.length),
        hasDescription: !!ent.description,
      }, null, 2));
    }
  } catch {}
}

db.close();
