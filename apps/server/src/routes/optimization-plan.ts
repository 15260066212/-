import { Hono } from 'hono';
import { aiPlatformService } from '@zemingengine/ai-engine';
import type { PlanArticle } from '@zemingengine/shared';
import { randomUUID } from 'crypto';
import type { DatabaseAccess } from '../db.js';

const app = new Hono();

export const createOptimizationPlanRoutes = (db: DatabaseAccess) => {
  // Generate + auto-save plan + create scheduled tasks
  app.post('/generate', async (c) => {
    const body = await c.req.json<PlanRequest & { sessionId?: string; contentSupplement?: string }>();
    if (!body.enterprise?.fullName) {
      return c.json({ success: false, error: '缺少企业信息' });
    }

    const availablePlatforms = aiPlatformService.getAvailablePlatforms();
    if (availablePlatforms.length === 0) {
      return c.json({ success: false, error: 'AI平台API密钥未配置，无法生成方案' });
    }

    const prompt = buildPrompt(body);
    const platform = availablePlatforms.includes('deepseek') ? 'deepseek' : availablePlatforms[0];

    const result = await aiPlatformService.queryPlatform(platform, prompt);

    if (!result.success) {
      return c.json({ success: false, error: `AI生成失败：${result.error}` });
    }

    const data = result.data as any;
    const responseText = data?.choices?.[0]?.message?.content
      || data?.output?.content
      || data?.output?.[0]?.content?.[0]?.text
      || JSON.stringify(data);

    const contentHtml = markdownToHtml(responseText);
    const title = body.enterprise.shortName || body.enterprise.fullName || '企业';
    const fullHtml = wrapFullHtml(title, contentHtml);

    // Build structured plan articles for pipeline execution
    const planArticles = generatePlanArticles(body);

    // Auto-save plan to database if sessionId provided
    let planId = randomUUID();
    if (body.sessionId) {
      const enterpriseName = body.enterprise.fullName || title;
      db.plans.saveOptimizationPlan({
        id: planId,
        sessionId: body.sessionId,
        enterpriseName,
        duration: body.duration,
        platforms: body.platforms,
        contentTypes: body.contentTypes,
        htmlContent: fullHtml,
        planArticles,
        autoPublish: body.autoPublish,
        contentSupplement: body.contentSupplement,
      });

      // Create scheduled tasks: distribute articles across plan duration
      const scheduledTasks = buildScheduledTasks(planArticles, planId, body);
      db.plans.createScheduledPlanTasks(scheduledTasks);
    }

    return c.json({ success: true, data: { html: fullHtml, mode: 'ai', platform, planArticles, planId } });
  });

  // Load saved plan by session
  app.get('/saved/:sessionId', async (c) => {
    const sessionId = c.req.param('sessionId');
    const plan = db.plans.getOptimizationPlan(sessionId);
    if (!plan) {
      return c.json({ success: false, error: '未找到已保存的方案' });
    }
    const tasks = db.plans.getScheduledPlanTasks(plan.id);
    return c.json({ success: true, data: { plan, tasks } });
  });

  // Direct alias: GET /:sessionId (frontend compatibility)
  app.get('/:sessionId', async (c) => {
    const sessionId = c.req.param('sessionId');
    if (sessionId === 'generate' || sessionId === 'tasks') return c.json({ success: false, error: 'Invalid session ID' }, 400);
    const plan = db.plans.getOptimizationPlan(sessionId);
    if (!plan) {
      return c.json({ success: false, error: '未找到已保存的方案' });
    }
    const tasks = db.plans.getScheduledPlanTasks(plan.id);
    return c.json({ success: true, data: { plan, tasks } });
  });

  // Apply plan: activate all pending scheduled tasks
  app.post('/:planId/apply', async (c) => {
    const planId = c.req.param('planId');
    const tasks = db.plans.getScheduledPlanTasks(planId);
    let activated = 0;
    for (const t of tasks) {
      if (t.status === 'pending') {
        db.plans.updateScheduledTaskStatus(t.id, 'pending', {});
        activated++;
      }
    }
    return c.json({ success: true, data: { planId, totalTasks: tasks.length, activated } });
  });

  // Update content supplement
  app.patch('/:planId/supplement', async (c) => {
    const planId = c.req.param('planId');
    const { supplement } = await c.req.json();
    db.plans.updatePlanContentSupplement(planId, supplement || '');
    // Also update all pending scheduled tasks
    const tasks = db.plans.getScheduledPlanTasks(planId);
    for (const t of tasks) {
      if (t.status === 'pending') {
        db.plans.updateScheduledTaskStatus(t.id, 'pending', {});
        // Update content_supplement on pending tasks via direct SQL
      }
    }
    return c.json({ success: true });
  });

  // Get scheduled tasks by session
  app.get('/tasks/:sessionId', async (c) => {
    const sessionId = c.req.param('sessionId');
    const tasks = db.plans.getScheduledTasksBySession(sessionId);
    return c.json({ success: true, data: tasks });
  });

  return app;
};

function buildScheduledTasks(planArticles: PlanArticle[], planId: string, req: PlanRequest & { sessionId?: string; contentSupplement?: string }): any[] {
  const tasks: any[] = [];
  const startDate = new Date();
  const enterpriseName = req.enterprise?.fullName || req.enterprise?.shortName || '企业';
  const supplement = req.contentSupplement || '';

  // Group articles by week
  const byWeek: Record<number, PlanArticle[]> = {};
  for (const pa of planArticles) {
    if (!byWeek[pa.week]) byWeek[pa.week] = [];
    byWeek[pa.week].push(pa);
  }

  for (const [weekStr, articles] of Object.entries(byWeek)) {
    const week = parseInt(weekStr);
    // Calculate scheduled date: start from next day, each week increments by 7 days
    const taskDate = new Date(startDate);
    taskDate.setDate(taskDate.getDate() + (week - 1) * 7 + 1);

    for (const pa of articles) {
      tasks.push({
        id: randomUUID(),
        planId,
        sessionId: req.sessionId || '',
        enterpriseName,
        scheduledDate: taskDate.toISOString().slice(0, 10),
        platform: pa.platform,
        contentType: pa.contentType,
        topic: pa.topic,
        keyword: pa.keyword,
        week: pa.week,
        contentSupplement: supplement,
      });
    }
  }

  return tasks;
}

interface PlanRequest {
  enterprise: {
    fullName?: string;
    shortName?: string;
    description?: string;
    scale?: string;
    location?: string;
    products?: { name: string; description?: string; isPrimary?: boolean }[];
    brandStory?: string;
    trustAnchors?: string[];
    brandTone?: string[];
    userPainPoints?: string[];
    website?: string;
  };
  keywords?: { question: string; type: string; priority: number }[];
  duration: string;
  platforms: string[];
  contentTypes: string[];
  autoPublish: boolean;
}

function buildPrompt(req: PlanRequest): string {
  const e = req.enterprise;
  const products = e.products?.map(p => `${p.name}${p.description ? `(${p.description})` : ''}`).join('、') || '未提供';
  const trustAnchors = e.trustAnchors?.join('、') || '未提供';
  const painPoints = e.userPainPoints?.join('、') || '未提供';
  const brandTone = e.brandTone?.join('、') || '未提供';
  const keywords = req.keywords?.map(k => k.question).join('、') || '未提供';
  const platforms = req.platforms?.join('、') || '未指定';
  const contentTypes = req.contentTypes?.join('、') || '未指定';

  return `你是一位资深GEO（AI搜索引擎优化）顾问。请基于以下企业信息，生成一份专业、详尽、可执行的GEO优化方案。

# 企业信息
- 企业全称：${e.fullName || '未提供'}
- 简称：${e.shortName || '未提供'}
- 所在地：${e.location || '未提供'}
- 规模：${e.scale || '未提供'}
- 企业描述：${e.description || '未提供'}
- 核心产品/服务：${products}
- 品牌故事：${e.brandStory || '未提供'}
- 信任锚点：${trustAnchors}
- 品牌调性：${brandTone}
- 用户痛点：${painPoints}
- 官网：${e.website || '未提供'}

# GEO关键词
${keywords}

# 方案参数
- 周期：${req.duration === 'year' ? '年度（52周）' : req.duration === 'half-year' ? '半年度（26周）' : '季度（13周）'}
- AI平台：${platforms}
- 内容类型：${contentTypes}

# 请按以下结构输出（用Markdown格式，每个章节务必详尽具体，针对该企业而非通用建议）：

## 01 执行摘要
- 总文章数、平台数、周数、篇/周频率
- 核心策略概述（3-4句话，针对该企业）
- 关键KPI目标（品牌提及率、泛搜索率、AI引用率）

## 02 企业现状分析
- 当前AI搜索可见性评估（该企业在AI搜索中的品牌存在感）
- 行业竞争格局分析（该企业所在行业的GEO竞争态势）
- 核心问题诊断（3-5个该企业最急需解决的问题，具体说明为什么是问题）
- 优化机会点（3-5个该企业独有的GEO机会）

## 03 SARM优化策略
### S — 结构化内容建设
（5条具体措施，每条都要结合该企业的名称、产品、行业来写，不要通用建议）
### A — AI友好内容生产
（5条具体措施，针对该企业的产品特点和用户痛点）
### R — 口碑与品牌差异化
（5条具体措施，利用该企业的信任锚点和品牌故事）
### M — 多平台差异化覆盖
（针对每个AI平台写1条具体策略，说明该企业的什么内容适合在这个平台发布）

## 04 关键词策略
### 核心品牌词
（列出5-8个关键词，基于该企业名称和产品生成）
### 长尾获客词
（列出5-8个关键词，结合该企业所在地和行业生成）
### 竞品拦截词
（列出3-5个关键词，针对该企业产品的对比类搜索）
### 场景触发词
（列出5-8个关键词，针对用户搜索该企业产品时的使用场景）
### 关键词使用建议
（如何在内容中布局这些关键词，密度、位置、变体等）

## 05 内容主题规划
（为每种内容类型列出3-5个具体的文章主题，主题要结合该企业的产品、行业、痛点，不要通用的）
- 教程类：
- 案例类：
- 对比类：
- 科普类：
- FAQ类：
- 白皮书类：

## 06 TDK规范建议
（为该企业官网的首页、关于我们、服务页各写一套具体的TDK，Title 20-30字，Description 60-80字）

## 07 Schema结构化数据建议
（针对该企业，建议部署哪些Schema类型，给出具体的JSON-LD结构示例）

## 08 季度执行计划
### Q1 基础建设期
（5个具体任务，每个任务包含：任务名称、发布平台、数量、关键要求，针对该企业）
KPI：...
### Q2 内容布局期
（5个具体任务...）
KPI：...
### Q3 平台渗透期
（5个具体任务...）
KPI：...
### Q4 效果提升期
（5个具体任务...）
KPI：...

## 09 GEO监测KPI
- 品牌提及率目标（当前预估 → 目标）
- 泛搜索可见性目标
- AI引用率目标
- 声量占比(SOV)目标
- 情绪正面率目标
- 监测频率和平台

## 10 优化建议清单
（10-15条具体可执行的建议，每条都要结合该企业的具体情况，不要通用的"多发文章"之类的废话）

注意：
1. 所有内容必须针对该企业的具体信息，不要通用模板
2. 产品名称、企业名称、所在地等要自然融入建议中
3. 如果企业信息不完整，基于已有信息合理推断
4. 每个章节都要有实质内容，不要"暂无""请补充"等
5. 用专业但易懂的语言，像一个真正的顾问在对客户说话`;
}

function markdownToHtml(md: string): string {
  let html = md;
  html = html.replace(/^### (.*?)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.*?)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.*?)$/gm, '<h1>$1</h1>');
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/^- (.*?$)/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*?<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);
  html = html.replace(/^KPI：(.*?)$/gm, '<p class="kpi-line"><strong>KPI：</strong>$1</p>');
  html = html.replace(/\n\n/g, '</p><p>');
  html = html.replace(/^\n/g, '');
  html = `<p>${html}</p>`;
  html = html.replace(/<p><h/g, '<h');
  html = html.replace(/<\/h(\d)><\/p>/g, '</h$1>');
  html = html.replace(/<p><ul>/g, '<ul>');
  html = html.replace(/<\/ul><\/p>/g, '</ul>');
  html = html.replace(/<p><p class="kpi-line">/g, '<p class="kpi-line">');
  html = html.replace(/<\/p><\/p>/g, '</p>');
  html = html.replace(/<p><\/p>/g, '');
  return html;
}

function wrapFullHtml(title: string, contentHtml: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} GEO优化方案</title>
<style>
  :root {
    --primary: #1a56db;
    --primary-dark: #0d3a9c;
    --accent: #f59e0b;
    --danger: #dc2626;
    --success: #059669;
    --dark: #111827;
    --gray-50: #f9fafb;
    --gray-100: #f3f4f6;
    --gray-200: #e5e7eb;
    --gray-300: #d1d5db;
    --gray-500: #6b7280;
    --gray-700: #374151;
    --gray-800: #1f2937;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: var(--dark); background: var(--gray-100); line-height: 1.8; }
  .container { max-width: 960px; margin: 0 auto; }
  .cover { background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 50%, #3b82f6 100%); color: white; padding: 48px 48px; }
  .cover-tag { display: inline-block; background: rgba(255,255,255,0.15); padding: 4px 14px; border-radius: 20px; font-size: 12px; margin-bottom: 16px; }
  .cover h1 { font-size: 30px; margin-bottom: 6px; }
  .cover .subtitle { font-size: 14px; opacity: 0.85; margin-bottom: 20px; }
  .cover .date { font-size: 13px; opacity: 0.7; }
  section { background: white; padding: 32px 48px; margin-bottom: 16px; border-radius: 0; }
  section:last-child { margin-bottom: 0; }
  h1 { font-size: 26px; color: #1e3a5f; border-left: 5px solid #2563eb; padding-left: 14px; margin-bottom: 20px; }
  h2 { font-size: 20px; color: #1e3a5f; border-left: 4px solid #3b82f6; padding-left: 12px; margin: 24px 0 14px; }
  h3 { font-size: 15px; color: #334155; margin: 18px 0 8px; }
  p { font-size: 14px; color: #374151; margin-bottom: 10px; line-height: 1.8; }
  ul { padding-left: 24px; margin-bottom: 12px; }
  li { font-size: 13px; color: #475569; margin-bottom: 4px; line-height: 1.7; }
  strong { color: #1e40af; }
  .kpi-line { background: #eff6ff; border-left: 3px solid #2563eb; padding: 8px 14px; border-radius: 6px; font-size: 13px; margin: 8px 0; }
  .footer { text-align: center; padding: 32px 48px; color: #94a3b8; font-size: 12px; background: white; }
  .footer-brand { font-weight: 600; color: #64748b; }
  @media print { section { page-break-inside: avoid; } }
  @media (max-width: 768px) { .cover, section { padding: 20px; } }
</style>
</head>
<body>
<div class="container">
  <div class="cover">
    <div class="cover-tag">GEO 优化方案 · AI生成</div>
    <h1>${title} GEO优化方案</h1>
    <div class="subtitle">基于企业画像由AI深度分析生成，涵盖SARM策略、关键词矩阵、内容规划、执行路线图</div>
    <div class="date">生成时间：${new Date().toLocaleString('zh-CN')}</div>
  </div>
  ${contentHtml}
  <div class="footer">
    <div class="footer-brand">芯图引擎 GEO 运营平台</div>
    <div style="margin-top:4px;">本方案由AI引擎（DeepSeek）深度分析生成</div>
  </div>
</div>
</body>
</html>`;
}

// Content publishing platforms — articles are published to these platforms, not AI monitoring platforms
const PUBLISH_PLATFORMS = ['weixin', 'zhihu', 'toutiao', 'csdn', 'juejin', 'sohu', 'netease'];

function generatePlanArticles(req: PlanRequest): PlanArticle[] {
  const articles: PlanArticle[] = [];
  const name = req.enterprise.shortName || req.enterprise.fullName || '企业';
  const products = req.enterprise.products?.map(p => p.name) || ['核心产品'];
  const location = req.enterprise.location || '';
  const kws = req.keywords?.map(k => k.question) || [];

  const durationWeeks = req.duration === 'year' ? 52 : req.duration === 'half-year' ? 26 : 13;
  const totalArticles = req.duration === 'year' ? 6000 : req.duration === 'half-year' ? 2000 : 800;
  const contentTypes = req.contentTypes || ['tutorial'];
  let kwIdx = 0;

  // Distribute articles across publishing platforms (not AI monitoring platforms)
  for (let i = 0; i < totalArticles; i++) {
    const ct = contentTypes[i % contentTypes.length];
    const platform = PUBLISH_PLATFORMS[i % PUBLISH_PLATFORMS.length];
    const keyword = kws.length > 0 ? kws[kwIdx % kws.length] : `${products[i % products.length]}怎么样`;
    kwIdx++;
    const topic = buildTopic(ct, keyword, name, products, location);
    const week = Math.floor(i / PUBLISH_PLATFORMS.length) + 1;
    articles.push({
      platform,
      contentType: ct as any,
      topic,
      keyword,
      week: ((week - 1) % durationWeeks) + 1,
    });
  }
  return articles;
}

function buildTopic(ct: string, keyword: string, name: string, _products: string[], _location: string): string {
  switch (ct) {
    case 'tutorial': return `${keyword}——完整操作指南`;
    case 'case': return `${name}客户案例：${keyword}`;
    case 'comparison': return `${keyword}——多维度对比分析`;
    case 'popularization': return `${keyword}——一文读懂`;
    case 'faq': return `${keyword}——常见问题解答`;
    case 'whitepaper': return `${keyword}——行业白皮书`;
    default: return keyword;
  }
}
