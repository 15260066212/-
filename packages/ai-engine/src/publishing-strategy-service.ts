/**
 * Publishing Strategy Service — GEO Publishing Strategy Engine
 *
 * Based on citation source weight analysis across 6 major Chinese LLM platforms.
 * Guides users on where to publish content for maximum AI citation visibility.
 *
 * Data sources:
 * - CSDN 2026.03 four-platform field test
 * - xfunnel 250K citation study
 * - Profound 680M citation analysis
 * - Binance cross-check data
 * See: https://fp8.co/articles/AI-Citation-Source-Preferences-GEO-Data-Map
 */

interface PlatformCitationProfile {
  platform: string;
  label: string;
  topSources: { source: string; label: string; weight: number }[];
  freshnessWindow: string;
  walledGarden: boolean;
  contentFormat: string;
}

interface StrategyRecommendation {
  platform: string;
  priority: 'high' | 'medium' | 'low';
  actions: string[];
  rationale: string;
}

interface PublishingStrategy {
  targetPlatforms: StrategyRecommendation[];
  universalActions: string[];
  contentFormatTips: { platform: string; tip: string }[];
  freshnessGuidance: { platform: string; window: string; action: string }[];
}

const PLATFORM_PROFILES: Record<string, PlatformCitationProfile> = {
  doubao: {
    platform: 'doubao',
    label: '豆包',
    topSources: [
      { source: 'toutiao', label: '今日头条', weight: 35 },
      { source: 'douyin', label: '抖音', weight: 25 },
      { source: 'zhihu', label: '知乎', weight: 12 },
      { source: 'sohu_netease', label: '搜狐/网易', weight: 5 },
      { source: 'csdn', label: 'CSDN', weight: 3 },
    ],
    freshnessWindow: '1-2 weeks (drops sharply after 1 month)',
    walledGarden: true,
    contentFormat: 'Video + text; high-follower accounts get 10x weight',
  },
  deepseek: {
    platform: 'deepseek',
    label: 'DeepSeek',
    topSources: [
      { source: 'csdn', label: 'CSDN', weight: 20 },
      { source: 'zhihu', label: '知乎', weight: 15 },
      { source: 'sohu_netease', label: '搜狐/网易', weight: 15 },
    ],
    freshnessWindow: 'Months (technical content stays relevant)',
    walledGarden: false,
    contentFormat: 'Hands-on technical writing; parses Markdown well; extracts code blocks',
  },
  kimi: {
    platform: 'kimi',
    label: 'Kimi',
    topSources: [
      { source: 'zhihu', label: '知乎', weight: 18 },
      { source: 'sohu_netease', label: '搜狐/网易', weight: 12 },
      { source: 'wechat', label: '微信公众号', weight: 10 },
    ],
    freshnessWindow: 'Moderate (favors deep research content)',
    walledGarden: false,
    contentFormat: 'Academic papers, industry reports, deep research; highest WeChat weight of any model',
  },
  qianwen: {
    platform: 'qianwen',
    label: '千问',
    topSources: [
      { source: 'sohu_netease', label: '搜狐/网易', weight: 30 },
      { source: 'zhihu', label: '知乎', weight: 10 },
      { source: 'csdn', label: 'CSDN', weight: 8 },
    ],
    freshnessWindow: 'Moderate',
    walledGarden: false,
    contentFormat: 'Table-formatted comparisons 47% more cited than paragraphs; structured markup +35% weight',
  },
  ernie: {
    platform: 'ernie',
    label: '文心一言',
    topSources: [
      { source: 'baijiahao', label: '百家号', weight: 35 },
      { source: 'baidu_baike', label: '百度百科', weight: 20 },
      { source: 'zhihu', label: '知乎', weight: 8 },
    ],
    freshnessWindow: 'Moderate',
    walledGarden: true,
    contentFormat: 'Baijiahao first-paragraph definition has 70% chance of being quoted directly',
  },
  hunyuan: {
    platform: 'hunyuan',
    label: '混元',
    topSources: [
      { source: 'zhihu', label: '知乎', weight: 10 },
      { source: 'sohu_netease', label: '搜狐/网易', weight: 10 },
    ],
    freshnessWindow: 'Moderate',
    walledGarden: false,
    contentFormat: 'Multi-turn dialogue; coding and long-text understanding',
  },
};

const UNIVERSAL_ACTIONS = [
  '知乎是所有国内模型的共同信源（8-18%），是跨平台通用布局的第一优先级',
  '垂直行业权威站点 > 综合大站：在细分领域做到头部比在综合平台发一百篇水文更有效',
  '组织认证账号权重约10倍于个人号：优先使用企业/机构认证身份发布',
  '内容时效性至关重要：豆包1-2周内权重最高，保持高频更新',
  '结构化内容（表格、列表）比纯段落获得更高引用率（千问+35%，所有平台均有提升）',
  '避免内容农场和SEO灌水站：豆包L4信源会被过滤，其他平台也在逐步跟进',
];

export class PublishingStrategyService {

  /**
   * Get the citation profile for a specific platform.
   */
  getPlatformProfile(platform: string): PlatformCitationProfile | null {
    return PLATFORM_PROFILES[platform] || null;
  }

  /**
   * Generate publishing strategy recommendations for a set of target platforms.
   */
  generateStrategy(targetPlatforms: string[]): PublishingStrategy {
    const recommendations: StrategyRecommendation[] = [];

    for (const platformId of targetPlatforms) {
      const profile = PLATFORM_PROFILES[platformId];
      if (!profile) continue;

      const actions: string[] = [];
      let priority: 'high' | 'medium' | 'low' = 'medium';

      if (platformId === 'doubao') {
        priority = 'high';
        actions.push('在今日头条发布认证账号文章（35%引用来源）');
        actions.push('布局抖音蓝V内容（25%引用来源，视频+图文多模态）');
        actions.push('维护抖音百科/快懂百科词条（字节高质量数据源L1权威）');
        actions.push('内容需在1-2周内持续更新（时效性要求最严格）');
      } else if (platformId === 'ernie') {
        priority = 'high';
        actions.push('在百家号发布文章（35%引用来源），首段定义有70%概率被直接引用');
        actions.push('维护百度百科词条（20%引用来源）');
        actions.push('优先布局百度系生态内容');
      } else if (platformId === 'deepseek') {
        priority = 'medium';
        actions.push('在CSDN发布技术博客（20%引用来源，技术内容数月不过期）');
        actions.push('使用Markdown格式，代码块带注释会被单独分析');
        actions.push('发布实操型技术内容而非营销文案');
      } else if (platformId === 'kimi') {
        priority = 'medium';
        actions.push('在知乎发布深度研究内容（18%引用来源，Kimi #1信源）');
        actions.push('在微信公众号发布行业报告（10%引用，所有模型中微信公众号权重最高）');
        actions.push('发布学术论文、行业报告等深度内容');
      } else if (platformId === 'qianwen') {
        priority = 'medium';
        actions.push('在搜狐/网易自媒体发布内容（30%引用来源）');
        actions.push('使用表格格式做对比类内容（比段落高47%引用率）');
        actions.push('添加结构化标记（列表+表格提升35%引用权重）');
      } else if (platformId === 'hunyuan') {
        priority = 'low';
        actions.push('在知乎和搜狐/网易布局内容');
        actions.push('关注多轮对话场景和长文理解场景的内容优化');
      }

      recommendations.push({
        platform: platformId,
        priority,
        actions,
        rationale: `${profile.label}: ${profile.topSources.map(s => `${s.label} ${s.weight}%`).join(', ')}. ${profile.walledGarden ? '围墙花园效应显著。' : '无生态偏向。'} 时效性: ${profile.freshnessWindow}`,
      });
    }

    recommendations.sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.priority] - order[b.priority];
    });

    const contentFormatTips = targetPlatforms
      .map(id => PLATFORM_PROFILES[id])
      .filter(Boolean)
      .map(p => ({ platform: p!.platform, tip: p!.contentFormat }));

    const freshnessGuidance = targetPlatforms
      .map(id => PLATFORM_PROFILES[id])
      .filter(Boolean)
      .map(p => ({
        platform: p!.platform,
        window: p!.freshnessWindow,
        action: p!.platform === 'doubao' ? '每周更新' : p!.platform === 'deepseek' ? '技术内容长期有效' : '每2-4周更新',
      }));

    return {
      targetPlatforms: recommendations,
      universalActions: UNIVERSAL_ACTIONS,
      contentFormatTips,
      freshnessGuidance,
    };
  }

  /**
   * Get a quick summary of which platforms to prioritize for a given industry.
   */
  getIndustryPriority(industry: string): { platforms: string[]; reason: string } {
    const industryMap: Record<string, string[]> = {
      finance: ['doubao', 'ernie', 'kimi'],
      tech: ['deepseek', 'kimi', 'qianwen'],
      consumer: ['doubao', 'ernie', 'qianwen'],
      default: ['doubao', 'kimi', 'deepseek'],
    };
    const platforms = industryMap[industry] || industryMap.default;
    const reasons: Record<string, string> = {
      finance: '财经类内容: 豆包(同花顺L2权威) + 文心(百家号35%) + Kimi(深度研究)',
      tech: '技术类内容: DeepSeek(CSDN 20%, Markdown解析) + Kimi(知乎18%) + 千问(表格+35%)',
      consumer: '消费类内容: 豆包(抖音/头条60%) + 文心(百度百科) + 千问(什么值得买L2)',
      default: '通用内容: 豆包(最大市占率32%) + Kimi(知乎最高权重) + DeepSeek(技术内容长效)',
    };
    return { platforms, reason: reasons[industry] || reasons.default };
  }
}

export const publishingStrategyService = new PublishingStrategyService();
