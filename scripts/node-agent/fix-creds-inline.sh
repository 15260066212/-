#!/bin/bash
# 用 Node.js 脚本替换 withErrorHandler 为内联 try-catch
cat > /tmp/fix-creds.js << 'EOF'
const fs = require('fs');
const path = '/home/ubuntu/geo-assistant-clean/apps/server/dist/routes/credentials.js';
let content = fs.readFileSync(path, 'utf8');

// 找到 GET / 路由的 withErrorHandler 部分
// 把:
//   app.get('/', withErrorHandler((c) => {
//     ...
//   }));
// 替换成:
//   app.get('/', (c) => {
//     try {
//       ...
//     } catch (error) {
//       const message = error instanceof Error ? error.message : 'Unknown error';
//       return c.json({ success: false, error: message }, 500);
//     }
//   });

// 用正则找到 app.get('/', withErrorHandler((c) => { ... }));
// 由于嵌套复杂，我们用更精确的方式

const oldStart = "    app.get('/', withErrorHandler((c) => {";
const newStart = "    app.get('/', (c) => {\n        try {";

// 先验证存在
if (!content.includes(oldStart)) {
  console.error('Cannot find GET / route with withErrorHandler');
  process.exit(1);
}

// 找到起始位置
const startIdx = content.indexOf(oldStart);
console.log('Found GET / route at index:', startIdx);

// 找到对应的结束位置:  withErrorHandler 的闭合
// 模式是: }));
// 我们需要找到匹配的括号

// 从起始位置开始，找到 app.get 的闭合
let depth = 0;
let i = startIdx + oldStart.length;
let foundEnd = -1;

while (i < content.length) {
  if (content[i] === '{') depth++;
  else if (content[i] === '}') {
    depth--;
    if (depth === -2) {
      // 找到了最外层的闭合: })); 中的第一个 }
      // 继续找 ));
      if (content.slice(i, i + 4) === '}));') {
        foundEnd = i + 4;
        break;
      }
    }
  }
  i++;
}

if (foundEnd === -1) {
  console.error('Cannot find end of GET / route');
  process.exit(1);
}

console.log('End of route at index:', foundEnd);
console.log('End snippet:', JSON.stringify(content.slice(foundEnd - 10, foundEnd + 5)));

// 提取中间的 handler body（去掉 withErrorHandler((c) => { 和最后的 }));
const oldFull = content.slice(startIdx, foundEnd);
console.log('\n=== Old full route (first 200 chars) ===');
console.log(oldFull.slice(0, 200));
console.log('...');
console.log(oldFull.slice(-100));

// 构建新代码
// 去掉开头的 "    app.get('/', withErrorHandler((c) => {" 
// 去掉结尾的 "    }));"
// 然后在开头加 try {，在结尾加 catch 块

const bodyStart = startIdx + oldStart.length;
const bodyEnd = foundEnd - 4; // 去掉 "}));"
let body = content.slice(bodyStart, bodyEnd);

// 去掉 body 首尾的空白行
body = body.trim();

// 缩进调整: body 里的内容是 8 空格缩进，try 里需要再加 4 = 12
// 但其实保持原样就行，只需要在前后加 try/catch

const newRoute = `    app.get('/', (c) => {
        try {
${body}
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return c.json({ success: false, error: message }, 500);
        }
    });`;

// 替换
const newContent = content.slice(0, startIdx) + newRoute + content.slice(foundEnd);

fs.writeFileSync(path, newContent);
console.log('\n✅ Fixed! File written.');

// 验证语法
try {
  new Function(newContent);
  console.log('✅ Syntax check passed');
} catch(e) {
  console.error('❌ Syntax error:', e.message);
}
EOF

node /tmp/fix-creds.js
