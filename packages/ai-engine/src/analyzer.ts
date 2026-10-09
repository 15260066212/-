import type { ScrapeResult, SessionData, EnterpriseProfile, KeywordType } from '@zemingengine/shared';
import { chatCompletion, isAIAvailable } from './client.js';
import { extractJsonObject } from './json-utils.js';
import { buildProfileSummaryLines } from './summary-utils.js';

const ANALYSIS_PROMPT = `你是一个 GEO（AI 搜索引擎优化）专家。分析以下企业官网的抓取结果，提取关键信息。

重要：提取的是该网站所推广的品牌名称，不是技术提供方、建站平台或母公司。
- 品牌名通常出现在：页面标题（title标签）、网站LOGO文字、首页大标题（hero section）、导航栏品牌名
- 忽略页面底部/版权信息中的技术提供方（如"Powered by"、"技术支持"、"建站平台"等）
- 如果页面标题是"膜一姐"，则品牌名就是"膜一姐"，即使页面底部写着"芯图引擎技术支持"

要求：
1. 提取品牌全称和简称（从页面标题或LOGO提取，不是技术提供方）
2. 提取一句话业务描述（20-50字）
3. 推断公司规模（如：50人、100-500人）
4. 推断所在地
5. 提取核心产品/服务列表（最多5个）
6. 提炼品牌故事（3-5句话）
7. 提取信任锚点（客户数量、奖项、认证等）
8. 推断品牌调性关键词（3-5个）
9. 生成 GEO 关键词（8-15个，必须是"问题形式"），每个关键词包含：
   - question: 完整的问题形式
   - type: "core"（核心品牌问题）| "question"（信息查询）| "comparison"（对比决策）| "longtail"（长尾场景）
   - priority: 1-10（数字越小越重要）

GEO 关键词原则：
- 必须是用户会向 AI 提问的自然语言问题
- 覆盖不同搜索意图：了解品牌、查询信息、对比决策、场景需求
- 关键词必须围绕该网站推广的品牌，不要围绕技术提供方

以 JSON 格式返回，字段：fullName, shortName, description, scale, location, products(数组), brandStory, trustAnchors(数组), brandTone(数组), keywords(数组，每个元素含 question/type/priority)`;

interface AnalysisKeyword {
  question: string;
  type: KeywordType;
  priority: number;
}

interface AnalysisResult {
  fullName: string;
  shortName: string;
  description: string;
  scale: string;
  location: string;
  products: string[];
  brandStory: string;
  trustAnchors: string[];
  brandTone: string[];
  keywords: (string | AnalysisKeyword)[];
}

export async function analyzeWebsite(
  scrapeResult: ScrapeResult,
  session: SessionData
): Promise<{ analysis: AnalysisResult; summary: string; enterprise: Partial<EnterpriseProfile>; keywords: { question: string; type: KeywordType; priority: number; geoContext: string }[] }> {
  if (!isAIAvailable()) {
    return fallbackAnalysis(scrapeResult);
  }

  const userInput = `URL: ${scrapeResult.url}
标题: ${scrapeResult.title}
描述: ${scrapeResult.description}
主要标题: ${scrapeResult.headings.slice(0, 10).join(', ')}
已提取关键词: ${scrapeResult.keywords.join(', ')}
已提取产品: ${scrapeResult.products.map(p => p.name).join(', ')}
关于我们: ${scrapeResult.aboutUs || '未找到'}
联系方式: ${scrapeResult.contactInfo.phone || ''} ${scrapeResult.contactInfo.email || ''} ${scrapeResult.contactInfo.address || ''}
正文摘要: ${scrapeResult.textContent.slice(0, 2000)}`;

  try {
    const response = await chatCompletion(ANALYSIS_PROMPT, userInput, {
      temperature: 0.3,
      maxTokens: 1500,
    });

    // Try to parse JSON from response
    const jsonStr = extractJsonObject(response);
    if (!jsonStr) {
      return fallbackAnalysis(scrapeResult);
    }

    const analysis: AnalysisResult = JSON.parse(jsonStr);

    const summary = generateSummary(analysis, scrapeResult.url);

    return {
      analysis,
      summary,
      enterprise: {
        fullName: analysis.fullName || scrapeResult.title || '',
        shortName: analysis.shortName || '',
        description: analysis.description || '',
        scale: analysis.scale || '',
        location: analysis.location || '',
        website: scrapeResult.url,
        products: analysis.products.map((name) => ({
          name,
          description: '',
          category: '',
          isPrimary: false,
        })),
        brandStory: analysis.brandStory || scrapeResult.aboutUs || '',
        trustAnchors: analysis.trustAnchors || [],
        brandTone: analysis.brandTone || [],
      },
      keywords: analysis.keywords.map((kw, index) => {
        if (typeof kw === 'object' && kw.question) {
          return {
            question: kw.question,
            type: kw.type || 'core' as const,
            priority: kw.priority || index + 1,
            geoContext: `AI 分析提取的${kw.type === 'comparison' ? '对比' : kw.type === 'question' ? '查询' : kw.type === 'longtail' ? '长尾' : '核心'}关键词`,
          };
        }
        return {
          question: String(kw),
          type: 'core' as const,
          priority: index + 1,
          geoContext: `AI 分析提取的关键词`,
        };
      }),
    };
  } catch {
    return fallbackAnalysis(scrapeResult);
  }
}

function fallbackAnalysis(scrapeResult: ScrapeResult) {
  const analysis: AnalysisResult = {
    fullName: scrapeResult.title,
    shortName: '',
    description: scrapeResult.description,
    scale: '',
    location: scrapeResult.contactInfo.address || '',
    products: scrapeResult.products.map(p => p.name),
    brandStory: scrapeResult.aboutUs || '',
    trustAnchors: [],
    brandTone: [],
    keywords: scrapeResult.keywords,
  };

  return {
    analysis,
    summary: `已抓取官网：${scrapeResult.url}\n标题：${scrapeResult.title}\n描述：${scrapeResult.description}\n\n（AI 分析不可用，已使用基础提取。请手动补充信息。）`,
    enterprise: {
      fullName: scrapeResult.title,
      description: scrapeResult.description,
      website: scrapeResult.url,
      location: scrapeResult.contactInfo.address || '',
      products: scrapeResult.products.map(p => ({
        name: p.name,
        description: p.description,
        category: '',
        isPrimary: false,
      })),
      brandStory: scrapeResult.aboutUs || '',
    },
    keywords: scrapeResult.keywords.map((kw, index) => ({
      question: kw,
      type: 'core' as const,
      priority: index + 1,
      geoContext: `从官网提取的关键词`,
    })),
  };
}

function generateSummary(analysis: AnalysisResult, url: string): string {
  const lines = [`🔍 已深度分析官网：${url}`, ''];
  lines.push(...buildProfileSummaryLines(analysis));
  lines.push('', '以上信息已自动填入企业画像，你可以确认或修改。');
  return lines.join('\n');
}
