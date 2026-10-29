/**
 * GEO 文章写作协议 v2.1 配置加载器。
 *
 * 协议唯一来源：packages/content-reviewer/protocol/geo-article-writing-protocol.yaml
 * （与工作区根目录 geo_article_writing_protocol_v2.1.yaml 保持同步）。
 *
 * 加载顺序：
 *   1. 环境变量 GEO_ARTICLE_PROTOCOL_PATH 指向的外部协议文件（升级协议时无需改代码）；
 *   2. 包内捆绑的 geo-article-writing-protocol.yaml；
 *   3. 任一步失败 → 回退内置默认值（与 v2.1 一致），保证审核链路不中断。
 *
 * 配置进程内缓存，只读一次。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import yaml from 'js-yaml';

export interface GeoProtocolConfig {
  /** 协议版本（meta.version） */
  version: string;
  /** EK 知识库名称（ek_reference.knowledge_base_name） */
  knowledgeBaseName: string;
  /** 行内引用前缀（由 citation_format.inline 提取，如 "[芯图EK《"） */
  citationInlinePrefix: string;
  /** 文末参考资料区块标题（citation_format.footer_heading） */
  footerHeading: string;
  /** 正文字数下限（word_count.floor） */
  wordFloor: number;
  /** 正文字数硬上限（word_count.hard_cap） */
  wordHardCap: number;
  /** 每小节最少字数（word_count.rules："每节不少于150字"） */
  sectionMinChars: number;
  /** FAQ 区块最少问答组数（output_format："至少 2 组问答"） */
  faqMinPairs: number;
  /** 禁用词列表（forbidden_phrases，含 "XX" 占位符的按数字正则匹配） */
  forbiddenPhrases: string[];
  /** 自画像主张最少命中条数（mandatory_references: claims.min_count） */
  minClaims: number;
  /** "承诺 AI 必然推荐 / 保证收录排名" 检测（capability_boundary.must_not_promise） */
  aiPromisePattern: RegExp;
  /** "GEO 一次性优化/一劳永逸" 检测（capability_boundary.must_not_promise） */
  oneShotPattern: RegExp;
}

/** 内置默认值：与协议 v2.1 YAML 保持一致（文件缺失时的兜底）。 */
export const DEFAULT_GEO_PROTOCOL: GeoProtocolConfig = {
  version: '2.1',
  knowledgeBaseName: '芯图EK',
  citationInlinePrefix: '[芯图EK《',
  footerHeading: '## 参考资料（芯图EK）',
  wordFloor: 800,
  wordHardCap: 5000,
  sectionMinChars: 150,
  faqMinPairs: 2,
  forbiddenPhrases: [
    '据统计',
    '数据显示提升XX%',
    '行业第一',
    '彻底解决所有物流难题',
  ],
  minClaims: 1,
  // 不承诺AI必然推荐 / 不承诺GEO保证收录排名（content_protocol.forbidden[1] 同类）
  aiPromisePattern:
    /(?:保证|承诺|确保|百分百|100%)[^。！？\n]{0,12}(?:AI|人工智能|AI搜索|智能搜索|搜索引擎)[^。！？\n]{0,8}(?:推荐|收录|排名|引用)|(?:AI|人工智能)[^。！？\n]{0,4}必[然定][^。！？\n]{0,6}(?:推荐|收录)/,
  // GEO非一次性优化：禁止"一次性优化/一劳永逸"类承诺
  oneShotPattern: /一次(?:性|劳永逸)[^。！？\n]{0,10}(?:优化|排名|收录|效果)/,
};

/** 从 citation_format.inline（"[芯图EK《{doc_name}》§{section}]"）提取固定前缀。 */
function extractInlinePrefix(inline: string): string | null {
  const idx = inline.indexOf('{doc_name}');
  if (idx <= 0) return null;
  const prefix = inline.slice(0, idx);
  return prefix.length > 0 ? prefix : null;
}

/** 把带 "XX" 占位符的禁用词转换为正则（XX → 数字），其余按字面量。 */
export function phraseToRegExp(phrase: string): RegExp {
  if (phrase.includes('XX')) {
    return new RegExp(phrase.replace(/XX/g, '\\d+').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  }
  return new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

const PROTOCOL_FILENAME = 'geo-article-writing-protocol.yaml';

let cached: GeoProtocolConfig | null = null;

/** 解析协议 YAML 并映射为强类型配置；缺失字段沿用默认值。 */
function parseProtocol(text: string): GeoProtocolConfig {
  const doc = yaml.load(text) as Record<string, any> | null;
  if (!doc || typeof doc !== 'object') return DEFAULT_GEO_PROTOCOL;

  const wordCount = (doc.word_count ?? {}) as Record<string, any>;
  const ek = (doc.ek_reference ?? {}) as Record<string, any>;
  const citation = (ek.citation_format ?? {}) as Record<string, any>;
  const forbidden = Array.isArray(doc.forbidden_phrases)
    ? (doc.forbidden_phrases as unknown[]).filter((s): s is string => typeof s === 'string')
    : DEFAULT_GEO_PROTOCOL.forbiddenPhrases;

  const inlinePrefix = typeof citation.inline === 'string' ? extractInlinePrefix(citation.inline) : null;

  return {
    ...DEFAULT_GEO_PROTOCOL,
    version: doc.meta?.version ?? DEFAULT_GEO_PROTOCOL.version,
    knowledgeBaseName: typeof ek.knowledge_base_name === 'string' ? ek.knowledge_base_name : DEFAULT_GEO_PROTOCOL.knowledgeBaseName,
    citationInlinePrefix: inlinePrefix ?? DEFAULT_GEO_PROTOCOL.citationInlinePrefix,
    footerHeading: typeof citation.footer_heading === 'string' ? citation.footer_heading : DEFAULT_GEO_PROTOCOL.footerHeading,
    wordFloor: typeof wordCount.floor === 'number' ? wordCount.floor : DEFAULT_GEO_PROTOCOL.wordFloor,
    wordHardCap: typeof wordCount.hard_cap === 'number' ? wordCount.hard_cap : DEFAULT_GEO_PROTOCOL.wordHardCap,
    forbiddenPhrases: forbidden,
  };
}

/** 加载协议配置（带缓存）。env GEO_ARTICLE_PROTOCOL_PATH 可覆盖内置协议文件。 */
export function loadProtocolConfig(): GeoProtocolConfig {
  if (cached) return cached;

  const candidates: string[] = [];
  const envPath = process.env.GEO_ARTICLE_PROTOCOL_PATH;
  if (envPath) candidates.push(envPath);
  // dist/protocol/protocol-config.js → 包根/protocol/*.yaml
  candidates.push(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../protocol', PROTOCOL_FILENAME),
  );

  for (const p of candidates) {
    try {
      const text = readFileSync(p, 'utf8');
      const cfg = parseProtocol(text);
      cached = cfg;
      return cfg;
    } catch {
      // 尝试下一个候选路径
    }
  }

  console.warn(
    `[GeoProtocol] 协议文件加载失败，使用内置默认值（v${DEFAULT_GEO_PROTOCOL.version}）`,
  );
  cached = DEFAULT_GEO_PROTOCOL;
  return cached;
}

/** 仅供测试：清空配置缓存。 */
export function resetProtocolConfigCache(): void {
  cached = null;
}
