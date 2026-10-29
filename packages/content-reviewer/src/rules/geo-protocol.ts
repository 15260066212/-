/**
 * GEO 文章写作协议 v2.1 审核规则（checkGeoProtocol）。
 *
 * 依据 geo_article_writing_protocol_v2.1.yaml，检查现有 9 维度无法覆盖的协议条款，
 * 问题按语义映射到已有维度（不新增维度，避免 DB/前端 schema 变更）：
 *
 *   协议条款                          → 维度 / 严重度
 *   word_count.floor（低于800不许交付）→ quality / high（触发 veto）
 *   word_count.hard_cap（5000 上限）   → quality / high（触发 veto）
 *   word_count.rules 每节 ≥150 字      → quality / medium
 *   output_format 禁 H1               → quality / medium
 *   output_format 必含 FAQ ≥2 组       → quality / high（缺失触发 veto）
 *   output_format FAQ 顺序 / 尾块     → quality / medium
 *   ek_reference.mandatory（无引用重写）→ truthfulness / high（触发 veto）
 *   EK-M2 文末参考资料区块             → truthfulness / high（缺失触发 veto）
 *   EK-M6 引用文档须在知识库中         → truthfulness / medium
 *   mandatory_references: claims      → truthfulness / high（penalty: reject）
 *   red_lines RL-P2 不以公司历程开场   → brand / medium
 *   forbidden_phrases（P3 反自夸）     → compliance / medium
 *   capability_boundary 禁承诺        → compliance / high|medium
 *
 * EK-M3/M4/M5（逐字段一致、限定条件保留、降格为观点）依赖语义理解，
 * 规则引擎无法可靠判定，由生成端 prompt 与人工审核兜底。
 */
import type { Article, ReviewIssue, SessionData } from '@zemingengine/shared';
import {
  DEFAULT_GEO_PROTOCOL,
  phraseToRegExp,
  type GeoProtocolConfig,
} from '../protocol/protocol-config.js';

const PROTOCOL_TAG = '[协议v2.1]';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface MdSection {
  heading: string;
  body: string;
}

/** 按 "## " 二级标题切分 Markdown；开头无标题的引言段 heading 为空。 */
function splitSections(markdown: string): MdSection[] {
  const lines = markdown.split(/\r?\n/);
  const sections: MdSection[] = [];
  let current: MdSection = { heading: '', body: '' };
  let inCodeBlock = false;

  for (const line of lines) {
    if (/^```/.test(line.trim())) inCodeBlock = !inCodeBlock;
    const headingMatch = inCodeBlock ? null : line.match(/^##\s+(.*)$/);
    if (headingMatch) {
      if (current.heading || current.body.trim()) sections.push(current);
      current = { heading: headingMatch[1].trim(), body: '' };
    } else {
      current.body += `${line}\n`;
    }
  }
  if (current.heading || current.body.trim()) sections.push(current);
  return sections;
}

/** 去除 Markdown 语法后的近似纯文本（用于字数/词句检测）。 */
function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*`~|_-]/g, ' ')
    .replace(/\s+/g, ' ');
}

/** 收集知识库中可作为"自画像主张"的短语（claims，L2/L3）。 */
function collectClaimPhrases(session: SessionData): string[] {
  const kb = session.knowledgeBase;
  const phrases: string[] = [];
  for (const s of kb.sources ?? []) {
    phrases.push(...(s.keyFacts ?? []));
    for (const e of s.evidence ?? []) phrases.push(e.claim);
  }
  for (const d of kb.documents ?? []) {
    phrases.push(...(d.keyFacts ?? []));
    for (const e of d.evidence ?? []) phrases.push(e.claim);
  }
  return phrases
    .map((p) => (p ?? '').trim())
    .filter((p) => p.length >= 4 && p.length <= 80);
}

/** 收集知识库全部可引用文档标题（sources + documents）。 */
function collectKbTitles(session: SessionData): string[] {
  const kb = session.knowledgeBase;
  const titles: string[] = [];
  for (const s of kb.sources ?? []) titles.push(s.title);
  for (const d of kb.documents ?? []) titles.push(d.title);
  return titles.filter((t) => t && t.trim().length > 0);
}

export function checkGeoProtocol(
  article: Article,
  session: SessionData,
  config: GeoProtocolConfig = DEFAULT_GEO_PROTOCOL,
): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const markdown = (article.contentMarkdown ?? '').trim()
    || (article.contentPlain ?? '').trim();
  const plain = article.contentPlain ?? stripMarkdown(markdown);
  const fullText = `${article.title}\n${plain}`;
  const sections = splitSections(markdown);
  const bodySections = sections.filter(
    (s) => !/^FAQ/i.test(s.heading) && !s.heading.includes('参考资料'),
  );
  const faqSection = sections.find((s) => /^FAQ/i.test(s.heading));
  const refsSection = sections.find((s) => s.heading.includes('参考资料'));

  // === 1. 字数（word_count）===
  if (article.wordCount < config.wordFloor) {
    issues.push({
      dimension: 'quality',
      severity: 'high',
      description: `${PROTOCOL_TAG} 正文 ${article.wordCount} 字，低于协议下限 ${config.wordFloor} 字，不允许交付（宁短勿假，须扩写用户场景）`,
      suggestion: `扩充内容至 ${config.wordFloor}-${config.wordHardCap} 字：补充用户真实场景、方法细节与案例（案例须来自知识库）`,
    });
  } else if (article.wordCount > config.wordHardCap) {
    issues.push({
      dimension: 'quality',
      severity: 'high',
      description: `${PROTOCOL_TAG} 正文 ${article.wordCount} 字，超过协议硬性上限 ${config.wordHardCap} 字`,
      suggestion: `压缩正文至 ${config.wordHardCap} 字以内，删除注水段落，保持每节把方法/证据讲透即可`,
    });
  }

  // 每节不少于 150 字（FAQ/参考资料区块除外）
  const shortSections = bodySections.filter(
    (s) => stripMarkdown(s.body).replace(/\s/g, '').length < config.sectionMinChars,
  );
  if (shortSections.length > 0) {
    issues.push({
      dimension: 'quality',
      severity: 'medium',
      description: `${PROTOCOL_TAG} ${shortSections.length} 个小节少于 ${config.sectionMinChars} 字（如：${shortSections.slice(0, 3).map((s) => `「${s.heading}」`).join('、')}），内容碎片化`,
      suggestion: `每节把方法/机制/证据讲透，不少于 ${config.sectionMinChars} 字，避免碎片化段落`,
    });
  }

  // === 2. 输出格式（output_format / structure）===
  if (/^#\s+\S+/m.test(markdown)) {
    issues.push({
      dimension: 'quality',
      severity: 'medium',
      description: `${PROTOCOL_TAG} 正文包含 H1 一级标题，协议要求从 ## 二级标题开始`,
      suggestion: '删除 H1 标题（选题标题由平台字段承载），正文从 ## 二级标题开始',
    });
  }

  if (!faqSection) {
    issues.push({
      dimension: 'quality',
      severity: 'high',
      description: `${PROTOCOL_TAG} 缺少 "## FAQ" 区块（必须存在，且位于参考资料之前），匹配 AI 引用逻辑`,
      suggestion: `文末前补充 "## FAQ" 区块，包含至少 ${config.faqMinPairs} 组来自知识库的用户真实问答`,
    });
  } else {
    const questionCount = (faqSection.body.match(/[?？]/g) ?? []).length;
    if (questionCount < config.faqMinPairs) {
      issues.push({
        dimension: 'quality',
        severity: 'medium',
        description: `${PROTOCOL_TAG} FAQ 区块仅 ${questionCount} 组问答，协议要求至少 ${config.faqMinPairs} 组`,
        suggestion: `补充至 ${config.faqMinPairs} 组以上问答，问题须来自自画像 FAQ（知识库 faq 信源）`,
      });
    }
    if (refsSection) {
      const faqIdx = sections.findIndex((s) => /^FAQ/i.test(s.heading));
      const refsIdx = sections.findIndex((s) => s.heading.includes('参考资料'));
      if (faqIdx > refsIdx) {
        issues.push({
          dimension: 'quality',
          severity: 'medium',
          description: `${PROTOCOL_TAG} FAQ 区块须位于 "参考资料" 区块之前`,
          suggestion: '调整区块顺序：正文 → FAQ → 参考资料（芯图EK）',
        });
      }
    }
  }

  // === 3. EK 引用（ek_reference，mandatory: true）===
  const inlineCitationCount = (
    fullText.match(new RegExp(escapeRegExp(config.citationInlinePrefix), 'g')) ?? []
  ).length;

  if (inlineCitationCount === 0) {
    issues.push({
      dimension: 'truthfulness',
      severity: 'high',
      description: `${PROTOCOL_TAG} 正文没有任何 ${config.knowledgeBaseName} 引用（格式 ${config.citationInlinePrefix}doc》§section]），违反 EK 强制引用要求：无引用即重写`,
      suggestion: `为每处事实性断言（数字、案例、客户、资质、方法结论）补充行内引用 ${config.citationInlinePrefix}文档名》§小节]，或删除无据论点`,
    });
  }

  if (!refsSection) {
    issues.push({
      dimension: 'truthfulness',
      severity: 'high',
      description: `${PROTOCOL_TAG} 缺少 "${config.footerHeading}" 区块（EK-M2：文末须列出引用的 document_id 与 chunk_id）`,
      suggestion: `文末固定添加 "${config.footerHeading}" 区块，按 [n] 文档名（document_id: xx，引用位置: chunk_xx）逐条列出引用`,
    });
  } else {
    const lastSection = sections[sections.length - 1];
    if (lastSection && !lastSection.heading.includes('参考资料')) {
      issues.push({
        dimension: 'quality',
        severity: 'medium',
        description: `${PROTOCOL_TAG} 文末最后一个区块须固定为 "${config.footerHeading}"`,
        suggestion: '将参考资料区块移到文末',
      });
    }

    // EK-M6：参考资料列出的文档须真实存在于知识库
    const kbTitles = collectKbTitles(session);
    if (kbTitles.length > 0) {
      const itemLines = refsSection.body.split(/\r?\n/).filter((l) => /\[\d+\]/.test(l));
      if (itemLines.length === 0) {
        issues.push({
          dimension: 'truthfulness',
          severity: 'medium',
          description: `${PROTOCOL_TAG} 参考资料区块没有 [n] 编号的引用条目（EK-M2）`,
          suggestion: '按 [1][2][3] 顺序列出全部引用文档及其 document_id 与 chunk_id',
        });
      } else {
        const unknownDocs = itemLines
          .map((l) => {
            const m = l.match(/\[\d+\]\s*([^（(]+)/);
            return m ? m[1].trim() : '';
          })
          .filter((name) => {
            if (!name) return false;
            return !kbTitles.some((t) => name.includes(t) || t.includes(name));
          });
        if (unknownDocs.length > 0) {
          issues.push({
            dimension: 'truthfulness',
            severity: 'medium',
            description: `${PROTOCOL_TAG} 参考资料中的文档不在知识库中：${unknownDocs.slice(0, 3).join('、')}，疑似编造引用（EK-M6）`,
            suggestion: '只引用知识库中真实存在的文档，引用信息（document_id/chunk_id）须与知识库一致',
          });
        }
      }
    }
  }

  // === 4. 自画像主张覆盖（mandatory_references: claims，penalty: reject）===
  const claimPhrases = collectClaimPhrases(session);
  if (claimPhrases.length > 0) {
    const matched = claimPhrases.filter((p) => plain.includes(p)).length;
    if (matched < config.minClaims) {
      issues.push({
        dimension: 'truthfulness',
        severity: 'high',
        description: `${PROTOCOL_TAG} 正文未使用任何自画像主张（知识库 claims/L2-L3 共 ${claimPhrases.length} 条可用，协议要求 ≥${config.minClaims} 条，缺失即 reject）`,
        suggestion: '从知识库 L2/L3 信源中选取与主题相关的主张原文写入正文并引用，禁止自行扩写',
      });
    }
  }

  // === 5. RL-P2：不以主体公司历程开场 ===
  const opener = bodySections[0]?.body ?? sections[0]?.body ?? plain.slice(0, 300);
  const brandNames = [session.enterprise.fullName, session.enterprise.shortName]
    .filter((s): s is string => !!s && s.trim().length > 0);
  if (brandNames.some((b) => opener.includes(b)) && /成立|始于|发展历程|深耕?多年|多年深耕/.test(opener)) {
    issues.push({
      dimension: 'brand',
      severity: 'medium',
      description: `${PROTOCOL_TAG} 文章以公司历程开场（RL-P2：不以主体公司历程开场），主体应是解题工具而非主角`,
      suggestion: '开头一两句直接回应用户问题，把品牌放在解题环节自然带出',
    });
  }

  // === 6. 禁用词（forbidden_phrases，P3 反营销自夸）===
  const foundPhrases = new Set<string>();
  for (const phrase of config.forbiddenPhrases) {
    if (!phrase) continue;
    const re = phraseToRegExp(phrase);
    if (re.test(fullText)) foundPhrases.add(phrase);
  }
  if (foundPhrases.size > 0) {
    issues.push({
      dimension: 'compliance',
      severity: 'medium',
      description: `${PROTOCOL_TAG} 命中协议禁用词：${[...foundPhrases].join('、')}`,
      suggestion: '删除或改写禁用词；数据表述须可溯源到知识库，禁止无据夸大',
    });
  }

  // === 7. 能力边界（capability_boundary.must_not_promise）===
  if (config.aiPromisePattern.test(fullText)) {
    issues.push({
      dimension: 'compliance',
      severity: 'high',
      description: `${PROTOCOL_TAG} 检测到"保证/承诺 AI 推荐、保证收录排名"类表述，违反能力边界（不得承诺 AI 必然推荐）`,
      suggestion: '删除承诺性表述，改为"提升被 AI 引用的可能性"等中性描述；GEO 无法保证收录与排名',
    });
  }
  if (config.oneShotPattern.test(fullText)) {
    issues.push({
      dimension: 'compliance',
      severity: 'medium',
      description: `${PROTOCOL_TAG} 检测到"GEO 一次性优化/一劳永逸"类表述，违反能力边界（GEO 非一次性优化）`,
      suggestion: '删除一次性承诺，说明 GEO 是持续运营过程',
    });
  }

  return issues;
}
