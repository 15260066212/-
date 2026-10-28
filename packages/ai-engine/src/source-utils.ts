/**
 * Shared source utility — ecosystem classification & URL tracking key constants.
 *
 * Single source of truth for domain-to-ecosystem mapping and tracking parameter
 * detection, used by visibility-analysis, citation-analysis, and result-parser.
 */

interface EcosystemEntry {
  domains: Set<string>;
  ecosystem: string;
  label: string;
}

/**
 * Ecosystem domain sets for source classification.
 * Based on citation analysis: ByteDance 60-85%, Baidu 55%, Zhihu 8-18% cross-platform.
 * See: https://fp8.co/articles/AI-Citation-Source-Preferences-GEO-Data-Map
 */
const ECOSYSTEM_DOMAIN_MAP: EcosystemEntry[] = [
  { domains: new Set(['toutiao.com', 'douyin.com', 'baike.com', 'doubao.com', 'volcengine.com']), ecosystem: 'bytedance', label: '字节系' },
  { domains: new Set(['baidu.com', 'baijiahao.baidu.com', 'wk.baidu.com']), ecosystem: 'baidu', label: '百度系' },
  { domains: new Set(['zhihu.com']), ecosystem: 'zhihu', label: '知乎' },
  { domains: new Set(['csdn.net']), ecosystem: 'csdn', label: 'CSDN' },
  { domains: new Set(['sohu.com', '163.com']), ecosystem: 'sohu_netease', label: '搜狐/网易' },
  { domains: new Set(['weixin.qq.com', 'mp.weixin.qq.com']), ecosystem: 'wechat', label: '微信公众号' },
];

/**
 * Classify a domain into its ecosystem.
 * Returns { ecosystem, label } — ecosystem is a machine key, label is human-readable Chinese.
 */
export function classifyEcosystem(domain: string): { ecosystem: string; label: string } {
  const d = String(domain || '').toLowerCase().replace(/^www\./, '');
  for (const entry of ECOSYSTEM_DOMAIN_MAP) {
    for (const ed of entry.domains) {
      if (d === ed || d.endsWith(`.${ed}`)) {
        return { ecosystem: entry.ecosystem, label: entry.label };
      }
    }
  }
  return { ecosystem: 'independent', label: '独立站' };
}

/**
 * Tracking query parameter keys to strip during URL normalization.
 * Union of all known tracking params across citation-analysis and result-parser.
 */
export const TRACKING_QUERY_KEYS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'spm', 'from', 'source', 'share', 'share_token', 'share_source', 'gclid', 'fbclid', 'msclkid', 'bd_vid',
]);
