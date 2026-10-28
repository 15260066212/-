import 'dotenv/config';

const key = process.env.DEEPSEEK_API_KEY;
if (!key) {
  console.log('NO_KEY');
  process.exit(1);
}
console.log('KEY_LEN=' + key.length);

const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + key,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'deepseek-chat',
    messages: [{ role: 'user', content: 'Reply with just: PONG' }],
    max_tokens: 10,
  }),
});

console.log('HTTP_STATUS=' + res.status);
const d = await res.json();
console.log('RESPONSE=' + JSON.stringify(d).slice(0, 500));
if (d.choices && d.choices[0]) {
  console.log('CONTENT=' + d.choices[0].message.content.trim());
}
