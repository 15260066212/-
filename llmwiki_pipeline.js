/**
 * LLMWiki Pipeline - 基于LLMWiki的完整发布流水线
 *
 * 功能：
 *   - 文章生成 (DeepSeek API)
 *   - 内容审核 (XTAUTO规则)
 *   - 多平台发布 (LLMWikiPublisher + Playwright RPA)
 *   - 反检测模式 (Xvfb + headless:false)
 *   - 结果持久化 (JSON文件)
 *
 * 用法：
 *   node llmwiki_pipeline.js --platforms csdn,juejin --topic "GEO技术" [--brand "新途科技"]
 *   node llmwiki_pipeline.js --config pipeline_config.json
 *
 * API模式（HTTP服务器）：
 *   node llmwiki_pipeline.js --server --port 3100
 *     POST /api/llmwiki/pipeline/start  { platforms, topic, brand, sessionId }
 *     GET  /api/llmwiki/pipeline/status/:runId
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { LLMWikiPublisher } = require('./llmwiki_publisher.js');

// ============================================================
// 配置
// ============================================================

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'sk-f6caae7d4c6b4a0697643832219b7f90';
const CRED_PATH = process.env.CRED_PATH || '/home/ubuntu/geo-assistant-clean/harvester/data/credentials.json';
const RESULTS_DIR = process.env.RESULTS_DIR || '/home/ubuntu/geo-assistant-clean/data/pipeline_results';
const DISPLAY = process.env.DISPLAY || ':99';

// 确保结果目录存在
if (!fs.existsSync(RESULTS_DIR)) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

// 平台反检测列表
const PLATFORM_ANTI_DETECT = ['toutiao', 'baijiahao', 'toutiaohao'];

// 平台风格定义
const PLATFORM_STYLES = {
  juejin: '掘金风格，技术+实战，面向开发者',
  baijiahao: '百家号风格，信息量大，结构清晰',
  csdn: 'CSDN风格，技术性强，代码示例丰富',
  zhihu: '知乎风格，专业深度，有理有据',
  sohuhao: '搜狐号风格，新闻性强，时效性好',
  wangyihao: '网易号风格，观点鲜明，有深度',
  baidu_zhidao: '百度知道风格，问答形式，简洁明了',
  baidu_baike: '百度百科风格，客观中立，百科全书式',
  toutiao: '今日头条风格，标题吸引眼球，正文通俗易懂',
  toutiaohao: '头条号风格，标题吸引眼球，正文通俗易懂',
};

// 公司背景（可从参数覆盖）
const DEFAULT_COMPANY = `漳州新途科技有限公司（www.xingtuyinqing.com）是一家专注于GEO（生成式引擎优化）技术的企业。
公司核心业务：AI搜索优化、品牌口碑管理、搜索引擎优化、内容营销。
品牌调性：专业、技术、务实、创新。
联系电话：13107869995`;

// ============================================================
// 运行时状态
// ============================================================

const activeRuns = new Map();

// ============================================================
// 文章生成
// ============================================================

function generateArticle(platform, topic, brandContext) {
  return new Promise((resolve, reject) => {
    const style = PLATFORM_STYLES[platform] || '通用风格';
    const companyInfo = brandContext || DEFAULT_COMPANY;
    const defaultTopic = platform === 'baidu_zhidao'
      ? '新途科技的GEO技术有什么优势？'
      : 'GEO技术如何赋能企业AI搜索优化';

    const prompt = `你是一位专业的内容创作者，请基于以下信息写一篇文章：

【公司背景】
${companyInfo}

【文章主题】${topic || defaultTopic}
【目标平台】${platform}（${style}）
【关键词】GEO, 生成式引擎优化, 新途科技, AI搜索优化

要求：
1. 标题20-30字，吸引眼球但不标题党
2. 正文800-1500字，分段清晰
3. 自然融入公司名称和业务
4. 适合${platform}平台发布
5. 包含品牌联系电话：13107869995
6. 不要使用Markdown代码块，用纯文本段落

请返回JSON格式：{"title":"标题","content":"正文内容","tags":["标签1","标签2","标签3"],"summary":"摘要50字以内"}`;

    const postData = JSON.stringify({
      model: 'deepseek-flash',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 12000,
    });

    const options = {
      hostname: 'api.deepseek.com',
      port: 443,
      path: '/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
      },
    };

    const req = require('https').request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          const message = result.choices?.[0]?.message || {};
          // DeepSeek Flash/Reasoner models: content has final answer, reasoning_content has thinking
          // Prefer content when available, fall back to reasoning_content for truncated responses
          const content = message.content || message.reasoning_content || '';
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const article = JSON.parse(jsonMatch[0]);
            article.contentMarkdown = article.content || '';
            resolve(article);
          } else {
            resolve({
              title: `${topic || defaultTopic}`,
              contentMarkdown: content,
              content: content,
              tags: ['GEO', '新途科技', 'AI搜索'],
              summary: content.substring(0, 100),
            });
          }
        } catch (e) {
          reject(new Error(`DeepSeek API parse error: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// ============================================================
// 内容审核
// ============================================================

function reviewArticle(article) {
  const issues = [];
  if (!article.title || article.title.length < 10) {
    issues.push({ field: 'title', issue: '标题过短', severity: 'error' });
  }
  if (!article.contentMarkdown || article.contentMarkdown.length < 200) {
    issues.push({ field: 'content', issue: '正文过短', severity: 'error' });
  }
  const hasCompany = (article.title + article.contentMarkdown).includes('新途科技');
  if (!hasCompany) {
    issues.push({ field: 'content', issue: '内容未包含公司名称', severity: 'error' });
  }
  // 敏感词检查
  const sensitiveWords = ['最', '第一', '独家', '绝对', '100%', '保证'];
  for (const word of sensitiveWords) {
    if ((article.title + article.contentMarkdown).includes(word)) {
      issues.push({ field: 'content', issue: `可能包含敏感词: ${word}`, severity: 'warning' });
    }
  }
  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');
  return {
    passed: errors.length === 0,
    errors,
    warnings,
    score: Math.max(0, 100 - errors.length * 20 - warnings.length * 5),
  };
}

// ============================================================
// Wechatsync 扩展桥接（宿主在 harvester 进程内，插件为发布主路径）
// ============================================================

const HARVESTER_PUBLISH_URL =
  process.env.HARVESTER_PUBLISH_URL || 'http://127.0.0.1:3003/api/llmwiki/publish';
const WECHATSYNC_BRIDGE_TIMEOUT = Number(process.env.WECHATSYNC_BRIDGE_TIMEOUT || 360000);
// 必须与 harvester/lib/wechatsync-publisher.js 的 WECHATSYNC_PLATFORMS 保持一致
const WECHATSYNC_PLATFORMS = new Set(
  String(process.env.WECHATSYNC_PLATFORMS || 'zhihu,baijiahao,juejin,sohuhao,bilibili')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);

/**
 * 先走 Wechatsync 扩展桥接；返回 null 表示应当回落 LLMWikiPublisher RPA。
 * 请求体带 wechatsyncOnly:true —— 插件不可用/未登录时 harvester 不会跑 RPA 弱逻辑，
 * 因此这里的 success 一定来自插件本身，不会是假成功。
 */
async function publishViaWechatsync(platform, article, creds) {
  if (!WECHATSYNC_PLATFORMS.has(platform)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WECHATSYNC_BRIDGE_TIMEOUT);
  try {
    const body = JSON.stringify({
      platform,
      article,
      credentials:
        creds && Array.isArray(creds.cookies) && creds.cookies.length
          ? { data: { cookies: creds.cookies } }
          : undefined,
      wechatsyncOnly: true,
    });

    const resp = await fetch(HARVESTER_PUBLISH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    });
    const data = await resp.json().catch(() => null);

    if (!data || !data.success) {
      const reason =
        (data && (data.error || (data.unsupported ? 'platform not enabled for plugin' : ''))) ||
        `HTTP ${resp.status}`;
      console.warn(`[LLMWiki Pipeline] wechatsync bridge miss for ${platform}: ${reason}`);
      return null;
    }

    if (creds) creds.updatedAt = new Date().toISOString();
    console.log(
      `[LLMWiki Pipeline] wechatsync handled ${platform} -> ${data.postUrl || '(no url)'} ` +
        `status=${data.verificationStatus}`
    );

    return {
      success: true,
      url: data.postUrl || '',
      stepsCompleted: 1,
      totalSteps: 1,
      steps: [],
      plugin: 'wechatsync',
      draftOnly: !!data.draftSaved,
      verificationStatus: data.verificationStatus,
      verificationMessage: data.verificationMessage,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// 单平台发布
// ============================================================

async function publishToPlatform(platform, article, creds) {
  // --- Wechatsync 扩展桥接优先（命中白名单即走插件） ---
  try {
    const bridged = await publishViaWechatsync(platform, article, creds);
    if (bridged) return bridged;
  } catch (e) {
    console.warn(
      `[LLMWiki Pipeline] wechatsync bridge error for ${platform}: ${e.message} — falling back to RPA`
    );
  }

  const needAntiDetect = PLATFORM_ANTI_DETECT.includes(platform);
  const headless = needAntiDetect ? false : true;
  const launchArgs = ['--no-sandbox', '--window-size=1280,1024'];

  if (needAntiDetect) {
    launchArgs.push('--disable-blink-features=AutomationControlled');
    launchArgs.push('--no-first-run');
    launchArgs.push('--disable-default-apps');
    if (!process.env.DISPLAY && require('os').platform() === 'linux') {
      process.env.DISPLAY = DISPLAY;
    }
  }

  const browser = await chromium.launch({ headless, args: launchArgs });
  const contextOptions = { viewport: { width: 1280, height: 1024 }, locale: 'zh-CN' };

  if (needAntiDetect) {
    contextOptions.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  }

  const context = await browser.newContext(contextOptions);

  if (needAntiDetect) {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      window.chrome = { runtime: {} };
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
    });
  }

  await context.addCookies(creds.cookies);
  const page = await context.newPage();

  try {
    const publisher = new LLMWikiPublisher();
    const result = await publisher.publish(page, platform, article);

    // 更新cookies
    if (result.success) {
      try {
        const newCookies = await context.cookies();
        creds.cookies = newCookies;
        creds.updatedAt = new Date().toISOString();
      } catch (e) {}
    }

    return result;
  } finally {
    await browser.close();
  }
}

// ============================================================
// 完整流水线执行
// ============================================================

async function executePipeline(config, runId) {
  if (!runId) {
    runId = `llmwiki_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
  const platforms = config.platforms || ['csdn'];
  const topic = config.topic || '';
  const brandContext = config.brandContext || DEFAULT_COMPANY;
  const autoPublish = config.autoPublish !== false;

  const run = {
    id: runId,
    status: 'running',
    platforms,
    topic,
    totalPlatforms: platforms.length,
    completedPlatforms: 0,
    results: {},
    startedAt: new Date().toISOString(),
  };

  activeRuns.set(runId, run);
  saveRun(run);

  // 加载凭证
  let creds = {};
  try {
    if (fs.existsSync(CRED_PATH)) {
      creds = JSON.parse(fs.readFileSync(CRED_PATH, 'utf-8'));
    }
  } catch (e) {
    run.status = 'failed';
    run.error = `Failed to load credentials: ${e.message}`;
    saveRun(run);
    return run;
  }

  try {
    for (let i = 0; i < platforms.length; i++) {
      const platform = platforms[i];
      run.currentPlatform = platform;
      run.currentIndex = i + 1;

      console.log(`\n[Pipeline] [${i + 1}/${platforms.length}] Processing ${platform}...`);

      const platformResult = {
        platform,
        status: 'pending',
      };
      run.results[platform] = platformResult;

      // 检查凭证
      if (!creds[platform]?.cookies || creds[platform].cookies.length === 0) {
        platformResult.status = 'skipped';
        platformResult.error = 'No cookies/credentials found';
        run.completedPlatforms++;
        saveRun(run);
        continue;
      }

      try {
        // 1. 生成文章
        platformResult.status = 'generating';
        saveRun(run);
        const article = await generateArticle(platform, topic, brandContext);
        platformResult.article = { title: article.title, tags: article.tags, summary: article.summary };
        console.log(`[Pipeline] ${platform}: Article generated - ${article.title}`);

        // 2. 审核
        platformResult.status = 'reviewing';
        saveRun(run);
        const review = reviewArticle(article);
        platformResult.review = { passed: review.passed, score: review.score, issues: review.errors };
        console.log(`[Pipeline] ${platform}: Review ${review.passed ? 'PASSED' : 'FAILED'} (score: ${review.score})`);

        if (!review.passed) {
          platformResult.status = 'review_failed';
          platformResult.error = `Review failed: ${review.errors.map(e => e.issue).join(', ')}`;
          run.completedPlatforms++;
          saveRun(run);
          continue;
        }

        // 3. 发布
        if (autoPublish) {
          platformResult.status = 'publishing';
          saveRun(run);
          const publishResult = await publishToPlatform(platform, article, creds[platform]);
          platformResult.publish = {
            success: publishResult.success,
            url: publishResult.url,
            stepsCompleted: publishResult.stepsCompleted,
            totalSteps: publishResult.steps?.length || 0,
            error: publishResult.error,
          };
          console.log(`[Pipeline] ${platform}: Publish ${publishResult.success ? 'SUCCESS' : 'FAILED'}`);
          platformResult.status = publishResult.success ? 'published' : 'publish_failed';
          if (!publishResult.success) {
            platformResult.error = publishResult.error;
          }
        } else {
          platformResult.status = 'approved';
          console.log(`[Pipeline] ${platform}: Approved (autoPublish=false)`);
        }
      } catch (e) {
        platformResult.status = 'failed';
        platformResult.error = e.message;
        console.log(`[Pipeline] ${platform}: ERROR - ${e.message}`);
      }

      run.completedPlatforms++;
      saveRun(run);
    }

    // 保存更新后的凭证
    try {
      fs.writeFileSync(CRED_PATH, JSON.stringify(creds, null, 2));
    } catch (e) {}

    run.status = 'completed';
    run.completedAt = new Date().toISOString();
  } catch (e) {
    run.status = 'failed';
    run.error = e.message;
    run.completedAt = new Date().toISOString();
  }

  saveRun(run);
  activeRuns.delete(runId);
  return run;
}

// ============================================================
// 持久化
// ============================================================

function saveRun(run) {
  const filePath = path.join(RESULTS_DIR, `${run.id}.json`);
  try {
    fs.writeFileSync(filePath, JSON.stringify(run, null, 2));
  } catch (e) {
    console.error('[Pipeline] Failed to save run:', e.message);
  }
}

function getRun(runId) {
  // 先查内存中的活跃运行
  if (activeRuns.has(runId)) {
    return activeRuns.get(runId);
  }
  // 再查文件
  const filePath = path.join(RESULTS_DIR, `${runId}.json`);
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch (e) {}
  return null;
}

// ============================================================
// HTTP API 服务器
// ============================================================

function startServer(port) {
  const server = http.createServer((req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // POST /api/llmwiki/pipeline/start
    if (req.method === 'POST' && req.url === '/api/llmwiki/pipeline/start') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const config = JSON.parse(body);
          const runId = `llmwiki_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          // 异步启动流水线
          setImmediate(() => {
            executePipeline(config, runId).catch(e => {
              console.error('[Pipeline] Execution error:', e.message);
            });
          });
          // 立即返回runId
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, runId, status: 'running' }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: e.message }));
        }
      });
      return;
    }

    // GET /api/llmwiki/pipeline/status/:runId
    if (req.method === 'GET' && req.url.startsWith('/api/llmwiki/pipeline/status/')) {
      const runId = req.url.split('/').pop();
      const run = getRun(runId);
      if (run) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: run }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Run not found' }));
      }
      return;
    }

    // POST /api/llmwiki/publish - 独立发布端点（供主系统调用）
    if (req.method === 'POST' && req.url === '/api/llmwiki/publish') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const { platform, article, credentials } = JSON.parse(body);
          if (!platform || !article) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Missing platform or article' }));
            return;
          }

          // 检查平台是否受支持
          const llmWiki = new LLMWikiPublisher();
          const platformKnowledge = llmWiki.llmwiki.knowledge[platform];
          if (!platformKnowledge) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: `Unsupported platform: ${platform}` }));
            return;
          }

          // 转换凭据格式：主系统可能传 cookie 字符串或 cookies 数组
          let creds = { cookies: [], updatedAt: new Date().toISOString() };
          if (credentials) {
            const credData = credentials.data || credentials;
            if (Array.isArray(credData.cookies)) {
              creds.cookies = credData.cookies;
            } else if (typeof credData.cookie === 'string' && credData.cookie) {
              // 将 cookie 字符串转换为 Playwright cookie 数组
              const cookieStr = credData.cookie;
              const domain = platformKnowledge.domain || '.com';
              creds.cookies = cookieStr.split(';').map(pair => {
                const [name, ...valueParts] = pair.trim().split('=');
                if (!name) return null;
                return {
                  name: name.trim(),
                  value: valueParts.join('=').trim(),
                  domain: domain,
                  path: '/',
                };
              }).filter(c => c && c.name);
            }
          }

          // Phase 3: Auto-load credentials from credentials.json if not provided
          if (creds.cookies.length === 0) {
            try {
              const allCreds = JSON.parse(fs.readFileSync(CRED_PATH, 'utf-8'));
              if (allCreds[platform]?.cookies?.length > 0) {
                creds = allCreds[platform];
                console.log(`[LLMWiki Pipeline] Auto-loaded ${creds.cookies.length} cookies from credentials.json for ${platform}`);
              }
            } catch (e) {
              console.warn('[LLMWiki Pipeline] Failed to auto-load credentials:', e.message);
            }
          }

          if (creds.cookies.length === 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'No valid cookies found for ' + platform }));
            return;
          }

          console.log(`[LLMWiki Pipeline] Standalone publish: platform=${platform}, article=${article.title}, cookies=${creds.cookies.length}`);

          const result = await publishToPlatform(platform, article, creds);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (e) {
          console.error('[LLMWiki Pipeline] Publish error:', e.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: e.message }));
        }
      });
      return;
    }

    // GET /api/llmwiki/platforms - 列出支持的平台
    if (req.method === 'GET' && req.url === '/api/llmwiki/platforms') {
      const platforms = Object.keys(PLATFORM_STYLES);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: platforms }));
      return;
    }

    // 健康检查
    if (req.method === 'GET' && req.url === '/api/llmwiki/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, status: 'ok', timestamp: new Date().toISOString() }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Not found' }));
  });

  server.listen(port, () => {
    console.log(`[LLMWiki Pipeline] Server running on port ${port}`);
    console.log(`[LLMWiki Pipeline] POST /api/llmwiki/pipeline/start`);
    console.log(`[LLMWiki Pipeline] POST /api/llmwiki/publish`);
    console.log(`[LLMWiki Pipeline] GET  /api/llmwiki/pipeline/status/:runId`);
    console.log(`[LLMWiki Pipeline] GET  /api/llmwiki/platforms`);
    console.log(`[LLMWiki Pipeline] GET  /api/llmwiki/health`);
  });

  return server;
}

// ============================================================
// CLI 入口
// ============================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
      result[key] = val;
      if (val !== true) i++;
    }
  }
  return result;
}

async function main() {
  const args = parseArgs();

  // 服务器模式
  if (args.server) {
    const port = parseInt(args.port) || 3100;
    startServer(port);
    return;
  }

  // 配置文件模式
  if (args.config) {
    const config = JSON.parse(fs.readFileSync(args.config, 'utf-8'));
    const result = await executePipeline(config);
    console.log('\n=== Pipeline Complete ===');
    console.log(`Status: ${result.status}`);
    console.log(`Run ID: ${result.id}`);
    for (const [platform, r] of Object.entries(result.results)) {
      console.log(`  ${platform}: ${r.status}${r.error ? ' - ' + r.error : ''}`);
    }
    return;
  }

  // CLI模式
  const platforms = (args.platforms || 'csdn').split(',').map(p => p.trim());
  const topic = args.topic || '';
  const brand = args.brand || '';

  const config = {
    platforms,
    topic,
    brandContext: brand ? `${brand}\n${DEFAULT_COMPANY}` : DEFAULT_COMPANY,
    autoPublish: args.publish !== 'false',
  };

  console.log('=== LLMWiki Pipeline ===');
  console.log(`Platforms: ${platforms.join(', ')}`);
  console.log(`Topic: ${topic || '(default)'}`);
  console.log('');

  const result = await executePipeline(config);

  console.log('\n=== Pipeline Complete ===');
  console.log(`Status: ${result.status}`);
  console.log(`Run ID: ${result.id}`);
  console.log(`Duration: ${((new Date(result.completedAt) - new Date(result.startedAt)) / 1000).toFixed(1)}s`);
  console.log('');
  for (const [platform, r] of Object.entries(result.results)) {
    const icon = r.status === 'published' ? '✅' : r.status === 'approved' ? '📝' : r.status === 'skipped' ? '⏭️' : '❌';
    console.log(`${icon} ${platform}: ${r.status}`);
    if (r.publish?.url) console.log(`   URL: ${r.publish.url}`);
    if (r.error) console.log(`   Error: ${r.error}`);
  }
}

if (require.main === module) {
  main().catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
  });
}

module.exports = {
  executePipeline,
  generateArticle,
  reviewArticle,
  publishToPlatform,
  startServer,
  getRun,
  PLATFORM_STYLES,
};
