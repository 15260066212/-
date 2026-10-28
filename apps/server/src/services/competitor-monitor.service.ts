import {
  aiPlatformService,
  resultParserService,
  visibilityAnalysisService,
  sentimentAnalysisService,
  citationAnalysisService,
} from '@zemingengine/ai-engine';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlatformResult {
  platform: string;
  platformName: string;
  responseText: string;
  responseTime: number;
  visibility: any;
  sentiment: any;
  citations: any;
  error?: string;
}

export interface CompetitorData {
  name: string;
  website: string;
  aiMentionScore: number;
  searchVisibility: number;
  contentCoverage: number;
  brandConsistency: number;
  trustSignals: number;
  platformPresence: Record<string, number>;
  geoKeywords: string[];
  strengths: string[];
  weaknesses: string[];
  summary: string;
}

export interface CompetitorReportResult {
  html: string;
  result: any;
  mode: 'real' | 'mock';
}

// ---------------------------------------------------------------------------
// Query & platform analysis
// ---------------------------------------------------------------------------

function buildQueryQuestion(target: string, competitors: string[]): string {
  const compList = competitors.join('、');
  return `请从消费者视角，详细介绍并比较以下品牌：${target} 和 ${compList}。

请从以下维度逐一分析每个品牌：
1. 品牌知名度与市场口碑
2. 产品/服务特点与核心优势
3. 用户评价与常见反馈
4. 价格定位与性价比
5. 信任度与推荐意愿

请对每个品牌分别给出评价，并明确指出你更推荐哪个品牌以及原因。`;
}

async function queryAndAnalyze(target: string, competitors: string[]): Promise<PlatformResult[]> {
  const availablePlatforms = aiPlatformService.getAvailablePlatforms();
  if (availablePlatforms.length === 0) return [];

  const question = buildQueryQuestion(target, competitors);
  const brand = { name: target };
  const compObjs = competitors.map((name) => ({ name }));

  const queryPlatforms = availablePlatforms.slice(0, 3);
  const results = await aiPlatformService.queryMultiplePlatforms(queryPlatforms, question);

  return results.map((r) => {
    const platformName = aiPlatformService.platforms[r.platform]?.name || r.platform;
    if (!r.success) {
      return {
        platform: r.platform,
        platformName,
        responseText: '',
        responseTime: r.responseTime || 0,
        visibility: null,
        sentiment: { sentiment: 'neutral', reason: '查询失败', risk_terms: [] },
        citations: { sources: [], citation_count: 0, owned_citation_count: 0, competitor_citation_count: 0 },
        error: r.error,
      };
    }

    const responseText = resultParserService.extractResponseText(r.data);
    const visibility = visibilityAnalysisService.analyzeResponse({ responseText, brand, competitors: compObjs });
    const citations = citationAnalysisService.extractSources({ responseText, aiResponse: r.data, brand, competitors: compObjs });

    return {
      platform: r.platform,
      platformName,
      responseText,
      responseTime: r.responseTime || 0,
      visibility,
      sentiment: null,
      citations,
    };
  });
}

async function enrichWithSentiment(results: PlatformResult[], target: string, competitors: string[]): Promise<PlatformResult[]> {
  const brand = { name: target };
  const compObjs = competitors.map((name) => ({ name }));
  for (const r of results) {
    if (r.responseText) {
      r.sentiment = await sentimentAnalysisService.analyzeWithDeepSeek({ responseText: r.responseText, brand, competitors: compObjs });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function aggregateResults(results: PlatformResult[], target: string, competitors: string[]) {
  const validResults = results.filter((r) => r.visibility);
  if (validResults.length === 0) return null;

  let totalMentions = 0;
  let totalRecommended = 0;
  let totalScore = 0;
  let totalSOV = 0;
  let SOVCount = 0;
  const competitorAgg: Record<string, { mentions: number; score: number; count: number }> = {};
  let positiveCount = 0;
  let negativeCount = 0;
  let neutralCount = 0;
  let totalCitations = 0;
  let ownedCitations = 0;
  let competitorCitations = 0;

  for (const r of validResults) {
    const v = r.visibility;
    if (v.brand_mentioned) totalMentions++;
    if (v.brand_recommended) totalRecommended++;
    totalScore += v.visibility_score || 0;
    if (v.share_of_voice > 0) {
      totalSOV += v.share_of_voice;
      SOVCount++;
    }
    for (const cm of v.competitor_mentions || []) {
      if (!competitorAgg[cm.name]) competitorAgg[cm.name] = { mentions: 0, score: 0, count: 0 };
      if (cm.mentioned) competitorAgg[cm.name].mentions++;
      competitorAgg[cm.name].score += cm.visibility_score || 0;
      competitorAgg[cm.name].count++;
    }
    const s = r.sentiment;
    if (s) {
      if (s.sentiment === 'positive') positiveCount++;
      else if (s.sentiment === 'negative') negativeCount++;
      else neutralCount++;
    }
    totalCitations += r.citations?.citation_count || 0;
    ownedCitations += r.citations?.owned_citation_count || 0;
    competitorCitations += r.citations?.competitor_citation_count || 0;
  }

  const n = validResults.length;
  const brandMentionRate = n > 0 ? Math.round((totalMentions / n) * 100) : 0;
  const brandRecommendRate = n > 0 ? Math.round((totalRecommended / n) * 100) : 0;
  const avgScore = n > 0 ? Number((totalScore / n).toFixed(2)) : 0;
  const avgSOV = SOVCount > 0 ? Number((totalSOV / SOVCount).toFixed(2)) : 0;
  const sentimentDist = { positive: positiveCount, negative: negativeCount, neutral: neutralCount };
  const dominantSentiment = positiveCount > negativeCount && positiveCount > neutralCount ? 'positive'
    : negativeCount > positiveCount && negativeCount > neutralCount ? 'negative' : 'neutral';

  const competitorSummary = competitors.map((name) => {
    const agg = competitorAgg[name] || { mentions: 0, score: 0, count: 0 };
    const mentionRate = agg.count > 0 ? Math.round((agg.mentions / agg.count) * 100) : 0;
    const avgCScore = agg.count > 0 ? Number((agg.score / agg.count).toFixed(2)) : 0;
    return { name, mentionRate, avgScore: avgCScore, mentions: agg.mentions };
  });

  const overallScore = Math.min(100, Math.round(
    brandMentionRate * 0.3 + avgScore * 5 + avgSOV * 0.3 + brandRecommendRate * 0.2
  ));

  return {
    platformCount: n,
    brandMentionRate,
    brandRecommendRate,
    avgScore,
    avgSOV,
    sentimentDist,
    dominantSentiment,
    overallScore,
    totalCitations,
    ownedCitations,
    competitorCitations,
    competitorSummary,
    platforms: validResults.map((r) => ({
      name: r.platformName,
      brandMentioned: r.visibility?.brand_mentioned,
      brandPosition: r.visibility?.brand_position,
      brandRecommended: r.visibility?.brand_recommended,
      visibilityScore: r.visibility?.visibility_score,
      shareOfVoice: r.visibility?.share_of_voice,
      sentiment: r.sentiment?.sentiment,
      sentimentReason: r.sentiment?.reason,
      citationCount: r.citations?.citation_count,
      responseTime: r.responseTime,
    })),
  };
}

// ---------------------------------------------------------------------------
// Real report HTML
// ---------------------------------------------------------------------------

function buildRealReportHtml(target: string, competitors: string[], agg: any): string {
  const slides: string[] = [];
  const platIcons: Record<string, string> = {
    deepseek: 'https://brandlogos.sgp1.digitaloceanspaces.com/png/logos/deepseek-400.png',
    kimi: 'https://aka.doubaocdn.com/s/DkoTkuKQOD',
    doubao: 'https://aka.doubaocdn.com/s/PPg55cnPjq',
    qianwen: 'https://aka.doubaocdn.com/s/PjIVxqYtuc',
    hunyuan: '',
  };

  slides.push(`<section class="slide cover">
    <h1>${target} GEO 监测报告</h1>
    <p class="subtitle">对比竞品：${competitors.join(' vs ')}</p>
    <p class="date">${new Date().toLocaleDateString('zh-CN')}</p>
  </section>`);

  const sentimentLabel = agg.dominantSentiment === 'positive' ? '正面' : agg.dominantSentiment === 'negative' ? '负面' : '中性';
  const sentimentColor = agg.dominantSentiment === 'positive' ? '#10b981' : agg.dominantSentiment === 'negative' ? '#ef4444' : '#6b7280';
  slides.push(`<section class="slide">
    <h2>执行摘要</h2>
    <div class="summary-grid">
      <div class="metric"><span class="big">${agg.overallScore}</span><span class="label">综合GEO得分</span></div>
      <div class="metric"><span class="big">${agg.brandMentionRate}%</span><span class="label">品牌提及率</span></div>
      <div class="metric"><span class="big">${agg.avgSOV}%</span><span class="label">声量占比(SOV)</span></div>
      <div class="metric"><span class="big">${agg.platformCount}</span><span class="label">监测平台数</span></div>
    </div>
    <div class="sentiment-badge" style="border-color:${sentimentColor};color:${sentimentColor}">
      AI情绪判定：${sentimentLabel}（正面${agg.sentimentDist.positive}/中性${agg.sentimentDist.neutral}/负面${agg.sentimentDist.negative}）
    </div>
    <p class="note">在 ${agg.platformCount} 个AI平台中，${target} 的品牌提及率为 ${agg.brandMentionRate}%，声量占比 ${agg.avgSOV}%，被推荐率 ${agg.brandRecommendRate}%。引用来源 ${agg.totalCitations} 个，其中自有来源 ${agg.ownedCitations} 个。</p>
  </section>`);

  const platBars = agg.platforms.map((p: any) => {
    const icon = platIcons[p.name?.toLowerCase()] || '';
    const mentionColor = p.brandMentioned ? '#10b981' : '#ef4444';
    return `<div class="bar-group">
      <div class="bar-label">${icon ? `<img src="${icon}" style="width:18px;height:18px;vertical-align:middle;margin-right:6px;object-fit:contain"/>` : ''}${p.name}</div>
      <div class="bar-row">
        <span class="bar-name">提及</span>
        <div class="bar-track"><div class="bar-fill ${p.brandMentioned ? 'target' : 'competitor'}" style="width:${p.brandMentioned ? '100' : '0'}%"></div></div>
        <span class="bar-val" style="color:${mentionColor}">${p.brandMentioned ? '是' : '否'}</span>
      </div>
      <div class="bar-row">
        <span class="bar-name">可见度</span>
        <div class="bar-track"><div class="bar-fill target" style="width:${Math.min(100, (p.visibilityScore || 0) * 10)}%"></div></div>
        <span class="bar-val">${p.visibilityScore || 0}</span>
      </div>
      <div class="bar-row">
        <span class="bar-name">SOV</span>
        <div class="bar-track"><div class="bar-fill competitor" style="width:${p.shareOfVoice || 0}%"></div></div>
        <span class="bar-val">${p.shareOfVoice || 0}%</span>
      </div>
    </div>`;
  }).join('');
  slides.push(`<section class="slide">
    <h2>各AI平台监测详情</h2>
    <div class="chart">${platBars}</div>
  </section>`);

  const compBars = agg.competitorSummary.map((c: any) => {
    return `<div class="bar-group">
      <div class="bar-label">${c.name}</div>
      <div class="bar-row">
        <span class="bar-name">提及率</span>
        <div class="bar-track"><div class="bar-fill competitor" style="width:${c.mentionRate}%"></div></div>
        <span class="bar-val">${c.mentionRate}%</span>
      </div>
      <div class="bar-row">
        <span class="bar-name">可见度</span>
        <div class="bar-track"><div class="bar-fill competitor" style="width:${Math.min(100, c.avgScore * 10)}%"></div></div>
        <span class="bar-val">${c.avgScore}</span>
      </div>
    </div>`;
  }).join('');
  slides.push(`<section class="slide">
    <h2>竞品可见度对比</h2>
    <div class="chart">${compBars}</div>
    <div class="legend"><span class="dot target"></span>${target}<span class="dot competitor"></span>竞品</div>
  </section>`);

  const recs = [
    agg.brandMentionRate < 50 ? `品牌提及率仅${agg.brandMentionRate}%，需加强AI平台内容布局` : `品牌提及率${agg.brandMentionRate}%，表现良好`,
    agg.avgSOV < 30 ? `声量占比${agg.avgSOV}%偏低，需提升品牌在AI回答中的占比` : `声量占比${agg.avgSOV}%，处于合理区间`,
    agg.dominantSentiment === 'negative' ? 'AI情绪判定偏负面，需优化品牌口碑内容' : agg.dominantSentiment === 'positive' ? 'AI情绪判定正面，品牌口碑良好' : 'AI情绪判定中性，需增加正面推荐内容',
    agg.ownedCitations === 0 ? '缺乏自有引用来源，需建设官网和品牌内容资产' : `自有引用${agg.ownedCitations}个，需持续扩充`,
    '定期监测各AI平台品牌表现，及时调整内容策略',
  ];
  const recList = recs.map((r, i) => `<li><span class="num">${i + 1}</span>${r}</li>`).join('');
  slides.push(`<section class="slide">
    <h2>GEO 优化建议</h2>
    <ul class="rec-list">${recList}</ul>
  </section>`);

  slides.push(`<section class="slide end-slide">
    <h1>感谢阅读</h1>
    <p>本报告由芯图引擎 GEO 监测系统自动生成</p>
    <p class="date">${new Date().toLocaleString('zh-CN')}</p>
  </section>`);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${target} GEO监测报告</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; background: #1a1a2e; }
  .slide { width: 100%; min-height: 100vh; padding: 60px 80px; display: flex; flex-direction: column; justify-content: center; background: white; page-break-after: always; position: relative; }
  .slide:last-child { page-break-after: auto; }
  .cover { background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); color: white; text-align: center; }
  .cover h1 { font-size: 42px; margin-bottom: 16px; }
  .cover .subtitle { font-size: 20px; opacity: 0.9; margin-bottom: 12px; }
  .cover .date { font-size: 14px; opacity: 0.7; }
  h2 { font-size: 28px; color: #1e3a5f; border-left: 5px solid #2563eb; padding-left: 16px; margin-bottom: 24px; }
  .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin-bottom: 24px; }
  .metric { text-align: center; padding: 20px; background: #f0f4ff; border-radius: 12px; }
  .metric .big { display: block; font-size: 36px; font-weight: 700; color: #2563eb; }
  .metric .label { font-size: 13px; color: #666; margin-top: 4px; display: block; }
  .sentiment-badge { display: inline-block; padding: 8px 16px; border: 2px solid; border-radius: 8px; font-size: 14px; font-weight: 600; margin-bottom: 16px; }
  .note { font-size: 14px; color: #555; line-height: 1.8; margin-top: 12px; padding: 12px 16px; background: #fffbeb; border-radius: 8px; }
  .chart { space-y: 12px; }
  .bar-group { margin-bottom: 16px; }
  .bar-label { font-size: 14px; font-weight: 600; color: #333; margin-bottom: 6px; }
  .bar-row { display: flex; align-items: center; gap: 12px; margin-bottom: 4px; }
  .bar-name { width: 80px; font-size: 12px; color: #666; text-align: right; }
  .bar-track { flex: 1; height: 20px; background: #f1f5f9; border-radius: 10px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 10px; transition: width 0.5s; }
  .bar-fill.target { background: linear-gradient(90deg, #2563eb, #3b82f6); }
  .bar-fill.competitor { background: linear-gradient(90deg, #f59e0b, #fbbf24); }
  .bar-val { width: 60px; font-size: 13px; font-weight: 600; color: #333; }
  .legend { display: flex; gap: 20px; justify-content: center; margin-top: 16px; font-size: 13px; color: #666; }
  .dot { display: inline-block; width: 12px; height: 12px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }
  .dot.target { background: #2563eb; }
  .dot.competitor { background: #f59e0b; }
  .rec-list { list-style: none; }
  .rec-list li { display: flex; align-items: flex-start; gap: 12px; padding: 10px 0; font-size: 15px; color: #333; border-bottom: 1px solid #f1f5f9; }
  .rec-list .num { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 50%; background: #2563eb; color: white; font-size: 14px; font-weight: 600; flex-shrink: 0; }
  .end-slide { background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); color: white; text-align: center; }
  .end-slide h1 { font-size: 36px; margin-bottom: 16px; }
  .end-slide p { font-size: 16px; opacity: 0.8; margin-bottom: 8px; }
  .end-slide .date { font-size: 13px; opacity: 0.6; }
  @media print { .slide { page-break-after: always; } }
</style>
</head>
<body>
${slides.join('\n')}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Mock report generation
// ---------------------------------------------------------------------------

function generateCompanyData(name: string, isTarget: boolean): CompetitorData {
  const seed = name.length + (isTarget ? 100 : 0);
  const rand = (min: number, max: number) => {
    const x = Math.sin(seed + min * 10 + max) * 10000;
    return Math.floor((x - Math.floor(x)) * (max - min + 1)) + min;
  };

  const platforms = ['微信公众号', '知乎', '百家号', '今日头条', 'CSDN', '哔哩哔哩', '搜狐号'];
  const platformPresence: Record<string, number> = {};
  for (const p of platforms) {
    platformPresence[p] = rand(0, 100);
  }

  const allKeywords = [
    `${name}怎么样`, `${name}靠谱吗`, `${name}价格`, `${name}哪家好`,
    `${name}和哪家对比`, `${name}口碑`, `${name}评价`, `${name}服务`,
    `${name}产品`, `${name}怎么样？值得买吗`,
  ];

  const strengthPool = [
    '品牌知名度较高，在多个平台有内容布局',
    'AI搜索中品牌提及率较好，用户认知度高',
    '知乎等知识平台有深度内容覆盖',
    '官方账号矩阵完善，内容更新频率稳定',
    'SEO基础优化到位，官网权重较好',
    '用户口碑内容丰富，有大量真实评价',
    '行业白皮书/专业内容布局较完整',
    '社交媒体活跃度高，用户互动频繁',
  ];

  const weaknessPool = [
    '部分消费决策平台内容覆盖不足',
    'AI搜索品牌提及率较低，存在感弱',
    '缺乏FAQ类内容，用户常见问题覆盖不全',
    '对比类内容较少，在竞品对比中不占优',
    'B站视频内容缺失，年轻用户触达不足',
    '内容更新频率不稳定，部分平台已停更',
    '品牌调性不一致，各平台内容质量参差不齐',
    '缺乏信任锚点内容（资质、案例、背书）',
  ];

  const strengths = strengthPool.sort(() => Math.random() - 0.5).slice(0, rand(2, 4));
  const weaknesses = weaknessPool.sort(() => Math.random() - 0.5).slice(0, rand(2, 4));

  const aiMentionScore = rand(30, 85);
  const searchVisibility = rand(20, 80);
  const contentCoverage = rand(25, 90);
  const brandConsistency = rand(30, 85);
  const trustSignals = rand(20, 75);

  return {
    name,
    website: `www.${name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'company'}.com`,
    aiMentionScore,
    searchVisibility,
    contentCoverage,
    brandConsistency,
    trustSignals,
    platformPresence,
    geoKeywords: allKeywords.slice(0, rand(3, 6)),
    strengths,
    weaknesses,
    summary: `${name}在AI搜索引擎中的综合GEO表现为${Math.round((aiMentionScore + searchVisibility + contentCoverage) / 3)}分，${aiMentionScore > 60 ? '品牌提及率较好' : '品牌提及率有待提升'}，${contentCoverage > 60 ? '内容覆盖面较广' : '内容覆盖面需扩展'}。`,
  };
}

function generateMonitorReport(target: string, competitors: string[]) {
  const targetData = generateCompanyData(target, true);
  const competitorData = competitors.map((c) => generateCompanyData(c, false));

  const dimensions = [
    { key: 'aiMentionScore', label: 'AI搜索品牌提及率' },
    { key: 'searchVisibility', label: '搜索可见度' },
    { key: 'contentCoverage', label: '内容覆盖度' },
    { key: 'brandConsistency', label: '品牌一致性' },
    { key: 'trustSignals', label: '信任信号' },
  ];

  const comparison = dimensions.map((dim) => {
    const targetVal = targetData[dim.key as keyof CompetitorData] as number;
    const compVals = competitorData.map((c) => c[dim.key as keyof CompetitorData] as number);
    const compAvg = compVals.reduce((a, b) => a + b, 0) / compVals.length;
    return {
      dimension: dim.label,
      target: targetVal,
      competitors: compVals,
      advantage: (targetVal > compAvg + 5 ? 'target' : targetVal < compAvg - 5 ? 'competitor' : 'tie') as 'target' | 'competitor' | 'tie',
    };
  });

  const overallScore = Math.round(
    (targetData.aiMentionScore + targetData.searchVisibility + targetData.contentCoverage +
     targetData.brandConsistency + targetData.trustSignals) / 5,
  );

  const recommendations: string[] = [
    `重点提升${comparison.filter((c) => c.advantage === 'competitor').map((c) => c.dimension).join('、') || '核心维度'}的表现`,
    '加强知乎、百家号等知识平台的内容深度布局',
    '补充FAQ类内容，覆盖用户常见搜索问题',
    '增加竞品对比类内容，在用户决策中抢占位置',
    '定期更新内容，保持平台活跃度',
    '完善信任锚点（资质认证、客户案例、行业背书）',
  ].slice(0, 5);

  return {
    targetCompany: targetData,
    competitors: competitorData,
    comparison,
    overallScore,
    recommendations,
  };
}

function buildMockPptHtml(target: string, competitors: string[], result: ReturnType<typeof generateMonitorReport>): string {
  const slides: string[] = [];

  slides.push(`<section class="slide cover">
    <h1>${target} 竞品 GEO 监测报告</h1>
    <p class="subtitle">对比竞品：${competitors.join(' vs ')}</p>
    <p class="date">${new Date().toLocaleDateString('zh-CN')}</p>
  </section>`);

  const advantageCount = result.comparison.filter((c) => c.advantage === 'target').length;
  const disadvantageCount = result.comparison.filter((c) => c.advantage === 'competitor').length;
  slides.push(`<section class="slide">
    <h2>执行摘要</h2>
    <div class="summary-grid">
      <div class="metric"><span class="big">${result.overallScore}</span><span class="label">综合GEO得分</span></div>
      <div class="metric"><span class="big">${advantageCount}</span><span class="label">领先维度</span></div>
      <div class="metric"><span class="big">${disadvantageCount}</span><span class="label">落后维度</span></div>
      <div class="metric"><span class="big">${competitors.length}</span><span class="label">对比竞品数</span></div>
    </div>
    <p class="note">${result.targetCompany.summary}</p>
  </section>`);

  const chartBars = result.comparison.map((c) => {
    const compAvg = c.competitors.reduce((a, b) => a + b, 0) / c.competitors.length;
    return `<div class="bar-group">
      <div class="bar-label">${c.dimension}</div>
      <div class="bar-row">
        <span class="bar-name">${target}</span>
        <div class="bar-track"><div class="bar-fill target" style="width:${c.target}%"></div></div>
        <span class="bar-val">${c.target}</span>
      </div>
      <div class="bar-row">
        <span class="bar-name">竞品均值</span>
        <div class="bar-track"><div class="bar-fill competitor" style="width:${compAvg.toFixed(0)}%"></div></div>
        <span class="bar-val">${compAvg.toFixed(0)}</span>
      </div>
    </div>`;
  }).join('');
  slides.push(`<section class="slide">
    <h2>核心维度对比</h2>
    <div class="chart">${chartBars}</div>
    <div class="legend"><span class="dot target"></span>${target}<span class="dot competitor"></span>竞品均值</div>
  </section>`);

  const platforms = Object.keys(result.targetCompany.platformPresence);
  const platformRows = platforms.map((p) => {
    const targetVal = result.targetCompany.platformPresence[p];
    const compVals = result.competitors.map((c) => c.platformPresence[p] || 0);
    const compAvg = compVals.reduce((a, b) => a + b, 0) / compVals.length;
    const maxVal = Math.max(targetVal, compAvg, 1);
    return `<tr>
      <td>${p}</td>
      <td><div class="bar-fill target" style="width:${(targetVal / maxVal) * 100}%"></div></td>
      <td>${targetVal}</td>
      <td><div class="bar-fill competitor" style="width:${(compAvg / maxVal) * 100}%"></div></td>
      <td>${compAvg.toFixed(0)}</td>
    </tr>`;
  }).join('');
  slides.push(`<section class="slide">
    <h2>各平台内容覆盖对比</h2>
    <table class="platform-table">
      <thead><tr><th>平台</th><th>${target}</th><th>得分</th><th>竞品均值</th><th>得分</th></tr></thead>
      <tbody>${platformRows}</tbody>
    </table>
  </section>`);

  for (const comp of result.competitors) {
    const strengthList = comp.strengths.map((s) => `<li class="good">${s}</li>`).join('');
    const weaknessList = comp.weaknesses.map((s) => `<li class="bad">${s}</li>`).join('');
    slides.push(`<section class="slide">
      <h2>${comp.name} 分析</h2>
      <div class="two-col">
        <div class="col"><h3>优势</h3><ul class="analysis-list">${strengthList}</ul></div>
        <div class="col"><h3>不足</h3><ul class="analysis-list">${weaknessList}</ul></div>
      </div>
      <p class="note">${comp.summary}</p>
    </section>`);
  }

  const targetStrengths = result.targetCompany.strengths.map((s) => `<li class="good">${s}</li>`).join('');
  const targetWeaknesses = result.targetCompany.weaknesses.map((s) => `<li class="bad">${s}</li>`).join('');
  slides.push(`<section class="slide">
    <h2>${target} 优劣势分析</h2>
    <div class="two-col">
      <div class="col"><h3>优势</h3><ul class="analysis-list">${targetStrengths}</ul></div>
      <div class="col"><h3>不足</h3><ul class="analysis-list">${targetWeaknesses}</ul></div>
    </div>
  </section>`);

  const recList = result.recommendations.map((r, i) => `<li><span class="num">${i + 1}</span>${r}</li>`).join('');
  slides.push(`<section class="slide">
    <h2>GEO 优化建议</h2>
    <ul class="rec-list">${recList}</ul>
  </section>`);

  const allKeywords = [...result.targetCompany.geoKeywords, ...result.competitors.flatMap((c) => c.geoKeywords)];
  const uniqueKeywords = [...new Set(allKeywords)];
  const keywordTags = uniqueKeywords.map((k) => `<span class="keyword-tag">${k}</span>`).join('');
  slides.push(`<section class="slide">
    <h2>GEO 核心关键词</h2>
    <div class="keyword-cloud">${keywordTags}</div>
  </section>`);

  slides.push(`<section class="slide end-slide">
    <h1>感谢阅读</h1>
    <p>本报告由芯图引擎 GEO 监测系统自动生成</p>
    <p class="date">${new Date().toLocaleString('zh-CN')}</p>
  </section>`);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${target} 竞品GEO监测报告</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; background: #1a1a2e; }
  .slide { width: 100%; min-height: 100vh; padding: 60px 80px; display: flex; flex-direction: column; justify-content: center; background: white; page-break-after: always; position: relative; }
  .slide:last-child { page-break-after: auto; }
  .cover { background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); color: white; text-align: center; }
  .cover h1 { font-size: 42px; margin-bottom: 16px; }
  .cover .subtitle { font-size: 20px; opacity: 0.9; margin-bottom: 12px; }
  .cover .date { font-size: 14px; opacity: 0.7; }
  h2 { font-size: 28px; color: #1e3a5f; border-left: 5px solid #2563eb; padding-left: 16px; margin-bottom: 24px; }
  h3 { font-size: 18px; color: #333; margin-bottom: 12px; }
  .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin-bottom: 24px; }
  .metric { text-align: center; padding: 20px; background: #f0f4ff; border-radius: 12px; }
  .metric .big { display: block; font-size: 36px; font-weight: 700; color: #2563eb; }
  .metric .label { font-size: 13px; color: #666; margin-top: 4px; display: block; }
  .note { font-size: 14px; color: #555; line-height: 1.8; margin-top: 12px; padding: 12px 16px; background: #fffbeb; border-radius: 8px; }
  .chart { space-y: 12px; }
  .bar-group { margin-bottom: 16px; }
  .bar-label { font-size: 14px; font-weight: 600; color: #333; margin-bottom: 6px; }
  .bar-row { display: flex; align-items: center; gap: 12px; margin-bottom: 4px; }
  .bar-name { width: 80px; font-size: 12px; color: #666; text-align: right; }
  .bar-track { flex: 1; height: 20px; background: #f1f5f9; border-radius: 10px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 10px; transition: width 0.5s; }
  .bar-fill.target { background: linear-gradient(90deg, #2563eb, #3b82f6); }
  .bar-fill.competitor { background: linear-gradient(90deg, #f59e0b, #fbbf24); }
  .bar-val { width: 40px; font-size: 13px; font-weight: 600; color: #333; }
  .legend { display: flex; gap: 20px; justify-content: center; margin-top: 16px; font-size: 13px; color: #666; }
  .dot { display: inline-block; width: 12px; height: 12px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }
  .dot.target { background: #2563eb; }
  .dot.competitor { background: #f59e0b; }
  .platform-table { width: 100%; border-collapse: collapse; font-size: 14px; }
  .platform-table th { background: #f1f5f9; padding: 10px; text-align: left; color: #475569; border-bottom: 2px solid #e2e8f0; }
  .platform-table td { padding: 8px 10px; border-bottom: 1px solid #f1f5f9; }
  .platform-table .bar-track { height: 14px; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  .col { padding: 16px; background: #f8f9fc; border-radius: 10px; }
  .analysis-list { list-style: none; padding: 0; }
  .analysis-list li { padding: 6px 0 6px 24px; font-size: 13px; color: #444; position: relative; }
  .analysis-list li.good::before { content: "\\2713"; position: absolute; left: 0; color: #10b981; font-weight: bold; }
  .analysis-list li.bad::before { content: "\\2717"; position: absolute; left: 0; color: #ef4444; font-weight: bold; }
  .rec-list { list-style: none; }
  .rec-list li { display: flex; align-items: flex-start; gap: 12px; padding: 10px 0; font-size: 15px; color: #333; border-bottom: 1px solid #f1f5f9; }
  .rec-list .num { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 50%; background: #2563eb; color: white; font-size: 14px; font-weight: 600; flex-shrink: 0; }
  .keyword-cloud { display: flex; flex-wrap: wrap; gap: 10px; }
  .keyword-tag { padding: 8px 16px; background: #e0e7ff; color: #1e40af; border-radius: 20px; font-size: 14px; }
  .end-slide { background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); color: white; text-align: center; }
  .end-slide h1 { font-size: 36px; margin-bottom: 16px; }
  .end-slide p { font-size: 16px; opacity: 0.8; margin-bottom: 8px; }
  .end-slide .date { font-size: 13px; opacity: 0.6; }
  @media print { .slide { page-break-after: always; } }
</style>
</head>
<body>
${slides.join('\n')}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Public API - Application Service
// ---------------------------------------------------------------------------

/**
 * 生成竞品监测报告（核心用例编排）。
 *
 * 流程：
 * 1. 多平台查询品牌对比问题
 * 2. 解析响应，执行可见度分析和引用分析
 * 3. 补充情感分析
 * 4. 跨平台聚合结果
 * 5. 生成 HTML 报告
 * 6. 若无可用平台数据，则回退到 mock 数据
 */
export async function generateCompetitorReport(
  target: string,
  competitors: string[],
): Promise<CompetitorReportResult> {
  const platformResults = await queryAndAnalyze(target, competitors);
  const enriched = await enrichWithSentiment(platformResults, target, competitors);
  const agg = aggregateResults(enriched, target, competitors);

  if (agg) {
    const html = buildRealReportHtml(target, competitors, agg);
    return { html, result: agg, mode: 'real' };
  }

  // Fallback to mock data if no API keys configured
  const mockResult = generateMonitorReport(target, competitors);
  const mockHtml = buildMockPptHtml(target, competitors, mockResult);
  return { html: mockHtml, result: mockResult, mode: 'mock' };
}
