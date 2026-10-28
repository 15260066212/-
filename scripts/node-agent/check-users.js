const { Database } = require('./apps/server/dist/db.js');
const db = new Database('./data/geo-assistant.db');

const users = db.users.listUsers();
console.log('现有用户:', JSON.stringify(users.map(u => ({ id: u.id, username: u.username, role: u.role, apiKey: u.apiKey.slice(0, 10) + '...' })), null, 2));

// 找一个普通用户
const normalUser = users.find(u => u.role === 'user');
const adminUser = users.find(u => u.role === 'admin');

if (normalUser) {
  console.log('\n=== 普通用户访问节点列表 (应 403) ===');
  console.log('user:', normalUser.username, 'role:', normalUser.role);
} else {
  console.log('\n没有普通用户，创建一个测试用户...');
  const newUser = db.users.createUser({
    username: 'testuser',
    passwordHash: 'test',
    displayName: '测试普通用户',
    role: 'user',
  });
  console.log('已创建:', newUser.username, 'role:', newUser.role, 'apiKey:', newUser.apiKey);
}

console.log('\n=== admin 用户 apiKey (前15位) ===');
if (adminUser) {
  console.log(adminUser.username + ':', adminUser.apiKey.slice(0, 15) + '...');
}
