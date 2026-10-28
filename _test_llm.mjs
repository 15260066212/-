// Direct test: call chatCompletion and dump the raw response
import 'dotenv/config';
import { chatCompletion, getActiveModel, isAIAvailable } from '@zemingengine/ai-engine';

console.log('isAIAvailable:', isAIAvailable());
console.log('activeModel:', getActiveModel());

const systemPrompt = `你是一位GEO（生成式引擎优化）内容专家。请严格按照以下 JSON 格式输出一篇关于企业GEO优化的FAQ文章，不要包含任何其他内容：

{
  "title": "文章标题",
  "summary": "文章摘要（100-200字）",
  "content": "文章正文（使用 Markdown）",
  "tags": ["标签1", "标签2", "标签3"],
  "coverImageDesc": "封面图片描述"
}

content 字段请使用 Markdown 格式，包含 5-6 个问答。确保 JSON 格式合法。`;

const userMessage = `请为「漳州新途科技有限公司」（主营GEO优化服务）生成一篇FAQ类型的GEO科普文章，目标平台今日头条。用行业观察者视角，品牌作为解法之一。`;

console.log('\n=== Calling chatCompletion... ===');
const start = Date.now();
try {
  const response = await chatCompletion(systemPrompt, userMessage, {
    temperature: 0.7,
    maxTokens: 2048,
  });
  const dur = Date.now() - start;
  console.log(`Duration: ${dur}ms`);
  console.log('\n=== RAW RESPONSE ===');
  console.log(response);
  console.log('\n=== RESPONSE LENGTH ===');
  console.log(response.length);
  console.log('\n=== CHAR CODE CHECK ===');
  // Check for any problematic chars
  for (let i = 0; i < Math.min(response.length, 200); i++) {
    const code = response.charCodeAt(i);
    if (code < 32 && code !== 10 && code !== 13 && code !== 9) {
      console.log(`Position ${i}: charCode=${code} (${JSON.stringify(response[i])})`);
    }
  }
  console.log('\n=== TRY JSON PARSE DIRECT ===');
  try {
    const parsed = JSON.parse(response);
    console.log('SUCCESS direct parse! Keys:', Object.keys(parsed));
  } catch (e) {
    console.log('FAILED direct parse:', e.message?.slice(0, 200));
  }
  console.log('\n=== TRY STRIP FENCE + PARSE ===');
  const stripped = response.replace(/^```(?:json|JSON)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
  try {
    const parsed = JSON.parse(stripped);
    console.log('SUCCESS fence-stripped parse! Keys:', Object.keys(parsed));
  } catch (e) {
    console.log('FAILED fence-stripped parse:', e.message?.slice(0, 200));
  }
  console.log('\n=== TRY BRACE SCAN ===');
  const firstBrace = stripped.indexOf('{');
  const lastBrace = stripped.lastIndexOf('}');
  console.log(`firstBrace=${firstBrace} lastBrace=${lastBrace}`);
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = stripped.slice(firstBrace, lastBrace + 1);
    try {
      const parsed = JSON.parse(candidate);
      console.log('SUCCESS brace-scan parse! Keys:', Object.keys(parsed));
    } catch (e) {
      console.log('FAILED brace-scan parse:', e.message?.slice(0, 200));
      // Show around error position
      const match = e.message?.match(/position (\d+)/);
      if (match) {
        const pos = parseInt(match[1]);
        console.log(`Context around position ${pos}:`, JSON.stringify(candidate.slice(Math.max(0, pos - 20), pos + 20)));
      }
    }
  }
} catch (err) {
  const dur = Date.now() - start;
  console.log(`FAILED after ${dur}ms:`, err.message);
}
