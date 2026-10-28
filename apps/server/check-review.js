import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.resolve(__dirname, '../data/geo-assistant.db');
const db = new Database(dbPath);

// 查看所有 reviewing 状态的文章的 generation_meta
const reviewing = db.prepare(`
  SELECT id, title, status, platform, review_round, generation_round, generation_meta, word_count
  FROM articles 
  WHERE status = 'reviewing'
  ORDER BY id DESC
  LIMIT 15
`).all();

console.log('=== 审核中文章详情 ===\n');
for (const a of reviewing) {
  let meta = {};
  try { meta = JSON.parse(a.generation_meta || '{}'); } catch {}
  console.log(`[${a.platform}] ${a.title.substring(0, 40)}`);
  console.log(`  status: ${a.status}, round: ${a.review_round}/${a.generation_round}`);
  console.log(`  model: ${meta.model || 'unknown'}, words: ${a.word_count}`);
  console.log('');
}

// 查看 failed 状态的文章（最近5个）
const failed = db.prepare(`
  SELECT id, title, status, platform, review_round, generation_round, generation_meta, word_count
  FROM articles 
  WHERE status = 'failed'
  ORDER BY id DESC
  LIMIT 5
`).all();

console.log('=== 失败文章示例 ===\n');
for (const a of failed) {
  let meta = {};
  try { meta = JSON.parse(a.generation_meta || '{}'); } catch {}
  console.log(`[${a.platform}] ${a.title.substring(0, 40)}`);
  console.log(`  status: ${a.status}, round: ${a.review_round}/${a.generation_round}`);
  console.log(`  model: ${meta.model || 'unknown'}, words: ${a.word_count}`);
  
  const reviews = db.prepare('SELECT round, passed, overall_score FROM reviews WHERE article_id = ? ORDER BY round').all(a.id);
  console.log(`  reviews: ${reviews.map(r => `R${r.round}:${r.overall_score}`).join(' → ')}`);
  console.log('');
}

// 检查 AI 是否可用
console.log('=== 检查 AI 可用性 ===');
// 查看环境变量中是否有 API key

db.close();
