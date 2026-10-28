import type { SessionData, EnterpriseProfile, KeywordType } from '@zemingengine/shared';
import { chatCompletion, isAIAvailable } from './client.js';
import { extractJsonObject } from './json-utils.js';
import { buildProfileSummaryLines } from './summary-utils.js';

const DOCUMENT_ANALYSIS_PROMPT = `你是一个 GEO（AI 搜索引擎优化）专家。分析以下从企业 PPT/Word 文档/介绍材料中提取的文本内容，提取关键信息。

要求：
1. 提取企业全称和简称
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

以 JSON 格式返回，字段：fullName, shortName, description, scale, location, products(数组), brandStory, trustAnchors(数组), brandTone(数组), keywords(数组，每个元素含 question/type/priority)`;

interface DocumentAnalysisResult {
  fullName: string;
  shortName: string;
  description: string;
  scale: string;
  location: string;
  products: string[];
  brandStory: string;
  trustAnchors: string[];
  brandTone: string[];
  keywords: { question: string; type: KeywordType; priority: number }[];
}

type DocumentKind = 'ppt' | 'docx';

const DOCUMENT_META: Record<DocumentKind, { label: string; unit: string; icon: string }> = {
  ppt: { label: 'PPT', unit: '页幻灯片', icon: '📄' },
  docx: { label: 'Word 文档', unit: '段', icon: '📝' },
};

interface DocumentAnalysisOutput {
  summary: string;
  enterprise: Partial<EnterpriseProfile>;
  keywords: { question: string; type: KeywordType; priority: number; geoContext: string }[];
}

export async function analyzePptContent(
  slideTexts: string[],
  fileName: string,
  session: SessionData,
): Promise<DocumentAnalysisOutput> {
  return analyzeDocumentTexts(slideTexts, fileName, session, 'ppt');
}

export async function analyzeDocxContent(
  paragraphTexts: string[],
  fileName: string,
  session: SessionData,
): Promise<DocumentAnalysisOutput> {
  return analyzeDocumentTexts(paragraphTexts, fileName, session, 'docx');
}

async function analyzeDocumentTexts(
  texts: string[],
  fileName: string,
  session: SessionData,
  kind: DocumentKind,
): Promise<DocumentAnalysisOutput> {
  const meta = DOCUMENT_META[kind];
  const combinedText = texts.join('\n\n---\n\n');

  if (!isAIAvailable()) {
    return {
      summary: `已导入 ${meta.label}：${fileName}\n共 ${texts.length} ${meta.unit}\n\n（未配置 AI 服务，已提取原始文本，请手动补充信息。）\n\n提取内容摘要：\n${combinedText.slice(0, 500)}...`,
      enterprise: {},
      keywords: [],
    };
  }

  try {
    const userInput = `文件名: ${fileName}
${meta.label}内容块数: ${texts.length}

内容:
${combinedText.slice(0, 4000)}`;

    const response = await chatCompletion(DOCUMENT_ANALYSIS_PROMPT, userInput, {
      temperature: 0.3,
      maxTokens: 1500,
    });

    const jsonStr = extractJsonObject(response);
    if (!jsonStr) {
      return fallbackDocumentAnalysis(texts, fileName, kind);
    }

    const analysis: DocumentAnalysisResult = JSON.parse(jsonStr);

    const summary = generateDocumentSummary(analysis, fileName, texts.length, kind);

    return {
      summary,
      enterprise: {
        fullName: analysis.fullName || session.enterprise.fullName,
        shortName: analysis.shortName || session.enterprise.shortName,
        description: analysis.description || session.enterprise.description,
        scale: analysis.scale || session.enterprise.scale,
        location: analysis.location || session.enterprise.location,
        products: (analysis.products ?? []).map((name) => ({
          name,
          description: '',
          category: '',
          isPrimary: false,
        })),
        brandStory: analysis.brandStory || session.enterprise.brandStory,
        trustAnchors: analysis.trustAnchors || session.enterprise.trustAnchors,
        brandTone: analysis.brandTone || session.enterprise.brandTone,
      },
      keywords: (analysis.keywords ?? []).map((kw, index) => ({
        question: kw.question,
        type: kw.type || ('core' as const),
        priority: kw.priority || index + 1,
        geoContext: `从 ${meta.label} 提取的关键词`,
      })),
    };
  } catch {
    return fallbackDocumentAnalysis(texts, fileName, kind);
  }
}

function fallbackDocumentAnalysis(texts: string[], fileName: string, kind: DocumentKind) {
  const meta = DOCUMENT_META[kind];
  const combinedText = texts.join('\n');
  return {
    summary: `已导入 ${meta.label}：${fileName}\n共 ${texts.length} ${meta.unit}\n\n（AI 分析不可用，已提取原始文本，请手动补充信息。）\n\n提取内容摘要：\n${combinedText.slice(0, 500)}...`,
    enterprise: {},
    keywords: [],
  };
}

function generateDocumentSummary(
  analysis: DocumentAnalysisResult,
  fileName: string,
  count: number,
  kind: DocumentKind,
): string {
  const meta = DOCUMENT_META[kind];
  const lines = [`${meta.icon} 已分析 ${meta.label}：${fileName}（共 ${count} ${meta.unit}）`, ''];
  lines.push(...buildProfileSummaryLines(analysis));
  lines.push('', `以上信息已从 ${meta.label} 自动提取并填入企业画像，你可以确认或修改。`);
  return lines.join('\n');
}
