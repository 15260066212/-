/**
 * GEO 文章写作协议加载与注入。
 *
 * 协议文件：packages/content-generator/protocols/geo_article_writing_protocol_v2.1.yaml
 * （与仓库根目录 geo_article_writing_protocol_v2.1.yaml 保持同源，更新时两边同步）
 *
 * 加载失败时返回空数组，不阻塞文章生成（降级为无协议约束的旧行为）。
 */
import fs from 'node:fs';
import yaml from 'js-yaml';

interface ProtocolRedLine {
  id: string;
  ref: string;
  statement: string;
}

interface ProtocolCitationRule {
  id: string;
  statement: string;
}

interface WritingProtocol {
  meta?: { protocol?: string; version?: string; language?: string };
  governing_directive?: string;
  role?: string;
  red_lines?: ProtocolRedLine[];
  structure?: Record<string, unknown>;
  word_count?: { target?: string; floor?: number; rules?: string[] };
  data_integrity?: string[];
  ek_reference?: {
    knowledge_base_name?: string;
    mandatory?: boolean;
    statement?: string;
    citation_rules?: ProtocolCitationRule[];
    citation_format?: { inline?: string; footer_heading?: string };
    violation_action?: string;
  };
  forbidden_phrases?: string[];
  capability_boundary?: { only_say?: string[]; must_not_promise?: string[] };
  style?: Record<string, unknown>;
  self_check?: string;
  output_format?: string;
}

let cached: WritingProtocol | null | undefined;

export function loadWritingProtocol(): WritingProtocol | null {
  if (cached !== undefined) return cached;
  try {
    // dist/writing-protocol.js → 包根/protocols/
    const url = new URL('../protocols/geo_article_writing_protocol_v2.1.yaml', import.meta.url);
    const raw = fs.readFileSync(url, 'utf8');
    cached = yaml.load(raw) as WritingProtocol;
  } catch (error) {
    console.warn(
      '[writing-protocol] 协议文件加载失败，降级为无协议约束:',
      error instanceof Error ? error.message : error,
    );
    cached = null;
  }
  return cached;
}

/**
 * 把协议渲染为 system prompt 行。返回空数组表示协议未加载。
 */
export function buildProtocolLines(): string[] {
  const p = loadWritingProtocol();
  if (!p) return [];

  const lines: string[] = [];
  lines.push(`=== GEO 文章写作协议 v${p.meta?.version ?? '?'}（强制性约束，违反按 reject/rewrite 处理） ===`);
  lines.push('');

  if (p.governing_directive) {
    lines.push('【治理指令】');
    lines.push(p.governing_directive.trim());
    lines.push('');
  }

  if (p.role) {
    lines.push(`【角色定位】${p.role}`);
    lines.push('');
  }

  if (p.red_lines && p.red_lines.length > 0) {
    lines.push('【红线（不得触碰）】');
    p.red_lines.forEach((r) => lines.push(`- [${r.id}] ${r.statement}`));
    lines.push('');
  }

  if (p.word_count) {
    lines.push('【字数要求】');
    lines.push(`- 正文目标 ${p.word_count.target ?? '800-1500'} 字，低于 ${p.word_count.floor ?? 800} 字不许交付`);
    (p.word_count.rules ?? []).forEach((r) => lines.push(`- ${r}`));
    lines.push('');
  }

  if (p.data_integrity && p.data_integrity.length > 0) {
    lines.push('【数据真实性】');
    p.data_integrity.forEach((d) => lines.push(`- ${d}`));
    lines.push('');
  }

  if (p.ek_reference) {
    const ek = p.ek_reference;
    lines.push(`【芯图EK 引用规则（mandatory=${ek.mandatory === true}）】`);
    if (ek.statement) lines.push(ek.statement);
    (ek.citation_rules ?? []).forEach((r) => lines.push(`- [${r.id}] ${r.statement}`));
    if (ek.citation_format?.inline) {
      lines.push(`- 行内引用格式：${ek.citation_format.inline}，文末区块标题：${ek.citation_format.footer_heading ?? '## 参考资料（芯图EK）'}`);
    }
    lines.push('');
  }

  if (p.forbidden_phrases && p.forbidden_phrases.length > 0) {
    lines.push(`【禁用表述】${p.forbidden_phrases.join('、')}`);
    lines.push('');
  }

  if (p.capability_boundary) {
    const cb = p.capability_boundary;
    if (cb.only_say && cb.only_say.length > 0) {
      lines.push(`【能力边界 · 只能说】${cb.only_say.join('、')}`);
    }
    if (cb.must_not_promise && cb.must_not_promise.length > 0) {
      lines.push(`【能力边界 · 不得承诺】${cb.must_not_promise.join('、')}`);
    }
    lines.push('');
  }

  if (p.output_format) {
    lines.push('【协议输出格式】');
    lines.push(p.output_format.trim());
    lines.push('');
  }

  if (p.self_check) {
    lines.push(`【自检】${p.self_check.trim()}`);
    lines.push('');
  }

  return lines;
}
