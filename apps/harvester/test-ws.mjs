import WebSocket from 'ws';

const sessionId = process.argv[2] || 'session_1792051757556_d7k1ka';
const wsUrl = `ws://localhost:3003/ws?session=${sessionId}`;

console.log(`Connecting to: ${wsUrl}`);

const ws = new WebSocket(wsUrl);

ws.on('open', () => {
  console.log('✅ WebSocket connected!');
  console.log('Sending startStream...');
  ws.send(JSON.stringify({ type: 'startStream', mode: 'fast' }));
});

ws.on('message', (data) => {
  if (typeof data === 'string') {
    try {
      const msg = JSON.parse(data);
      console.log('📨 Text message:', JSON.stringify(msg).substring(0, 200));
    } catch {
      console.log('📨 Text (raw):', data.substring(0, 200));
    }
  } else {
    console.log('🖼️  Binary frame received, size:', data.length, 'bytes');
  }
});

ws.on('error', (err) => {
  console.log('❌ WebSocket error:', err.message);
});

ws.on('close', (code, reason) => {
  console.log(`🔌 WebSocket closed: code=${code}, reason=${reason}`);
  process.exit(0);
});

// 5秒后退出
setTimeout(() => {
  console.log('⏱️  Timeout after 5s');
  ws.close();
}, 5000);
