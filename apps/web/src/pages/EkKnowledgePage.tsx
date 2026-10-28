import { useState, useEffect, useCallback } from 'react';
import {
  BookOpen,
  Building2,
  RefreshCw,
  IdCard,
  Layers,
  Boxes,
  Hash,
  ArrowUpDown,
  FileText,
  Lock,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';
import { api, type EkKnowledgeData, type EkCombination } from '../hooks/useApi.js';
import type { KnowledgeSource } from '@zemingengine/shared';

// ---------- 展示映射 ----------

const TYPE_LABELS: Record<string, string> = {
  capability: '产品能力',
  service: '服务矩阵',
  customer: '客户画像',
  brand: '品牌定位',
  proof: '信任背书',
  region: '服务地区',
  case: '行业案例',
  faq: '痛点问答',
  pricing: '价格定位',
  partner: '合作伙伴',
  product: '产品能力',
};

const TYPE_BADGES: Record<string, string> = {
  capability: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30',
  service: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/30',
  customer: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  brand: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
  proof: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/30',
  region: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30',
  case: 'bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/30',
  faq: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30',
  pricing: 'bg-lime-500/10 text-lime-600 dark:text-lime-400 border-lime-500/30',
  partner: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/30',
  product: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/30',
};

const PLATFORM_LABELS: Record<string, string> = {
  wechat: '微信公众号',
  zhihu: '知乎',
  toutiaohao: '今日头条',
  csdn: 'CSDN',
  juejin: '掘金',
  sohuhao: '搜狐号',
  wangyihao: '网易号',
  deepseek: 'DeepSeek',
  kimi: 'Kimi',
  doubao: '豆包',
  yuanbao: '腾讯元宝',
  qianwen: '通义千问',
};

const STATUS_BADGES: Record<string, string> = {
  approved: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  published: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30',
  reviewing: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
  draft: 'bg-muted text-muted-foreground border-border',
  failed: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30',
};

const STATUS_LABELS: Record<string, string> = {
  approved: '审核通过',
  published: '已发布',
  reviewing: '审核中',
  draft: '草稿',
  failed: '失败',
};

const CARD_FIELDS: Array<{ key: string; label: string; render: (v: EkKnowledgeData['aiCard']) => string }> = [
  { key: 'companyName', label: '公司名称', render: (c) => c?.companyName ?? '' },
  { key: 'description', label: '公司简介', render: (c) => c?.description ?? '' },
  { key: 'coreProducts', label: '核心产品', render: (c) => c?.coreProducts?.join('、') ?? '' },
  { key: 'mainServices', label: '主要服务', render: (c) => c?.mainServices?.join('、') ?? '' },
  { key: 'targetCustomers', label: '服务对象', render: (c) => c?.targetCustomers?.join('、') ?? '' },
  { key: 'serviceRegion', label: '服务地区', render: (c) => c?.serviceRegion ?? '' },
  { key: 'address', label: '经营地址', render: (c) => c?.address ?? '' },
  { key: 'website', label: '公司网址', render: (c) => c?.website ?? '' },
  { key: 'phone', label: '咨询电话', render: (c) => c?.phone ?? '' },
  { key: 'email', label: '联系邮箱', render: (c) => c?.email ?? '' },
];

function platformLabel(p: string): string {
  return PLATFORM_LABELS[p] ?? p;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

// ---------- 子组件 ----------

function StatCard({ icon: Icon, label, value, accent }: {
  icon: typeof Hash;
  label: string;
  value: string | number;
  accent: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 relative overflow-hidden">
      <div className={`absolute inset-x-0 bottom-0 h-0.5 ${accent}`} />
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="w-3.5 h-3.5" />
        <span>{label}</span>
      </div>
      <div className="text-2xl font-bold mt-1.5 text-foreground">{value}</div>
    </div>
  );
}

function AiCardSection({ card }: { card: NonNullable<EkKnowledgeData['aiCard']> }) {
  return (
    <div className="rounded-2xl border border-violet-500/30 bg-gradient-to-br from-violet-500/10 to-transparent p-5">
      <div className="flex items-center gap-2 mb-4">
        <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded-md bg-violet-500/20 text-violet-600 dark:text-violet-300 border border-violet-500/35">
          L3
        </span>
        <IdCard className="w-4 h-4 text-violet-500" />
        <h3 className="text-sm font-semibold text-foreground">AI 名片 · 每篇必引</h3>
        <span className="ml-auto text-xs px-2 py-1 rounded-full bg-violet-500/15 text-violet-600 dark:text-violet-300 border border-violet-500/25">
          已引用 <b>{card.usageCount}</b> 次
        </span>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {CARD_FIELDS.map(({ key, label, render }) => {
          const value = render(card);
          return (
            <div key={key} className={`rounded-lg border border-border bg-card/60 p-3 ${key === 'description' ? 'sm:col-span-2' : ''}`}>
              <div className="text-[11px] text-muted-foreground mb-1">{label}</div>
              <div className={`text-sm text-foreground ${key === 'description' ? 'leading-relaxed' : 'font-medium'}`}>
                {value || <span className="text-muted-foreground">未配置</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SourceCard({ source, maxUsage }: { source: KnowledgeSource; maxUsage: number }) {
  const badge = TYPE_BADGES[source.type] ?? TYPE_BADGES.product;
  const usage = source.usageCount ?? 0;
  const pct = maxUsage > 0 ? Math.min(100, Math.round((usage / maxUsage) * 100)) : 0;
  return (
    <div className={`rounded-xl border bg-card p-4 transition-colors ${source.enabled ? 'border-border hover:border-sky-500/40' : 'border-border/60 opacity-55'}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-600 dark:text-sky-300 border border-sky-500/30">L2</span>
        <span className={`text-[11px] px-2 py-0.5 rounded-md border ${badge}`}>{TYPE_LABELS[source.type] ?? source.type}</span>
        {!source.enabled && (
          <span className="text-[11px] px-2 py-0.5 rounded-md border border-border bg-muted text-muted-foreground">已停用</span>
        )}
        <span className="ml-auto font-mono text-xs text-sky-600 dark:text-sky-300">{usage} 次引用</span>
      </div>
      <h4 className="text-sm font-semibold text-foreground mt-2.5">{source.title}</h4>
      {source.keyFacts?.length > 0 && (
        <ul className="mt-2 space-y-1">
          {source.keyFacts.slice(0, 3).map((fact, i) => (
            <li key={i} className="text-xs text-muted-foreground flex gap-1.5">
              <span className="text-sky-500/70 flex-shrink-0">◆</span>
              <span className="line-clamp-1">{fact}</span>
            </li>
          ))}
          {source.keyFacts.length > 3 && (
            <li className="text-[11px] text-muted-foreground/70 pl-4">…共 {source.keyFacts.length} 条事实</li>
          )}
        </ul>
      )}
      <div className="mt-3 h-1 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full bg-gradient-to-r from-sky-500 to-cyan-400" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function CombinationCard({ combo, index, sourceMap }: {
  combo: EkCombination;
  index: number;
  sourceMap: Map<string, KnowledgeSource>;
}) {
  const l3Members = combo.memberIds.filter((id) => id === 'l3-ai-card' || sourceMap.get(id)?.layer === 3);
  const l2Members = combo.memberIds.filter((id) => !l3Members.includes(id));
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="absolute left-0 top-0 bottom-0 w-0.5 invisible" aria-hidden />
      {/* 卡头 */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border bg-muted/30 flex-wrap">
        <span className="font-mono text-xs font-bold text-foreground">
          组合 #{String(index + 1).padStart(2, '0')}
        </span>
        <span className="text-[11px] text-muted-foreground font-mono truncate max-w-[280px]" title={combo.key}>
          {combo.memberIds.length} 条信源
        </span>
        <span className={`ml-auto text-xs font-semibold px-2.5 py-1 rounded-full border ${
          combo.count > 0
            ? 'bg-sky-500/10 text-sky-600 dark:text-sky-300 border-sky-500/30'
            : 'bg-muted text-muted-foreground border-border'
        }`}>
          引用 {combo.count} 次
        </span>
      </div>
      <div className="p-4">
        {/* 成员信源 chips */}
        <div className="flex flex-wrap gap-1.5">
          {l3Members.length > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-300 font-mono">
              <Lock className="w-3 h-3" /> L3 · AI 名片
            </span>
          )}
          {l2Members.map((id) => {
            const src = sourceMap.get(id);
            return (
              <span
                key={id}
                className="text-[11px] px-2 py-1 rounded-md border border-sky-500/25 bg-sky-500/8 text-foreground/90"
                title={src?.title ?? id}
              >
                {src ? `${TYPE_LABELS[src.type] ?? src.type} · ${src.title}` : id}
                {src && <span className="ml-1 text-sky-600 dark:text-sky-300 font-mono">{src.usageCount}</span>}
              </span>
            );
          })}
        </div>

        {/* 关联文章 */}
        {combo.articles.length > 0 && (
          <div className="mt-3.5 space-y-1.5">
            {combo.articles.map((a) => (
              <div key={a.id} className="flex items-center gap-2 text-xs rounded-lg border border-border/70 bg-background/50 px-2.5 py-1.5 flex-wrap">
                <FileText className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                <span className="text-foreground truncate flex-1 min-w-[140px]" title={a.title}>{a.title}</span>
                <span className="text-[11px] text-muted-foreground flex-shrink-0">{platformLabel(a.platform)}</span>
                <span className={`text-[11px] px-1.5 py-0.5 rounded border flex-shrink-0 ${STATUS_BADGES[a.status] ?? STATUS_BADGES.draft}`}>
                  {STATUS_LABELS[a.status] ?? a.status}
                </span>
                <span className="text-[11px] text-muted-foreground font-mono flex-shrink-0">{formatDate(a.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- 主页面 ----------

export function EkKnowledgePage({ sessionId }: { sessionId: string }) {
  const [data, setData] = useState<EkKnowledgeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await api.getEkKnowledge(sessionId);
      setData(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载芯图EK数据失败');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  if (loading && !data) {
    return (
      <div className="h-full overflow-y-auto p-6">
        <div className="max-w-6xl mx-auto flex items-center justify-center py-24 text-muted-foreground text-sm gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" /> 正在加载企业知识库…
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="h-full overflow-y-auto p-6">
        <div className="max-w-6xl mx-auto rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { stats, l2Sources, aiCard, combinations } = data;
  const sourceMap = new Map<string, KnowledgeSource>(l2Sources.map((s) => [s.id, s]));
  const usageGap = stats.maxUsage - stats.minUsage;
  const enabledSources = l2Sources.filter((s) => s.enabled);

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* 头部 */}
        <div className="flex items-start gap-3 flex-wrap">
          <div>
            <div className="inline-flex items-center gap-2 text-[11px] font-semibold tracking-widest uppercase text-sky-600 dark:text-sky-400 border border-sky-500/30 bg-sky-500/8 rounded-full px-3 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-500 shadow-[0_0_8px_rgba(56,189,248,.9)]" />
              芯图EK · Enterprise Knowledge
            </div>
            <h2 className="text-lg font-semibold text-foreground mt-2 flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-primary" />
              企业知识库 · 三层架构与信源引用
            </h2>
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5 flex-wrap">
              <Building2 className="w-3.5 h-3.5" />
              {data.enterprise.fullName || '未命名企业'}
              <span className="font-mono text-[10px] opacity-70">({data.sessionId})</span>
            </p>
          </div>
          <button
            onClick={() => void fetchData()}
            disabled={loading}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>

        {/* 统计 */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard icon={Layers} label="L2 可引用信源" value={stats.l2Count} accent="bg-sky-500/60" />
          <StatCard icon={IdCard} label="L3 名片引用" value={stats.l3Usage} accent="bg-violet-500/60" />
          <StatCard icon={Boxes} label="信源组合数" value={stats.combinationCount} accent="bg-emerald-500/60" />
          <StatCard icon={Hash} label="L2 总引用次数" value={stats.totalCitations} accent="bg-cyan-500/60" />
          <StatCard icon={ArrowUpDown} label="引用差额" value={`${usageGap} 次`} accent="bg-amber-500/60" />
        </div>

        {/* 未记录提示 */}
        {stats.untrackedArticles > 0 && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-2.5 text-xs text-amber-700 dark:text-amber-400 flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            {stats.untrackedArticles} 篇文章生成于组合记录功能上线前，未记录引用信源集合，不计入组合统计。
          </div>
        )}

        {/* 知识库未编译 */}
        {!data.kbReady && (
          <div className="rounded-xl border border-border bg-card p-8 text-center">
            <Sparkles className="w-8 h-8 text-muted-foreground/50 mx-auto mb-3" />
            <p className="text-sm font-medium text-foreground">知识库尚未编译</p>
            <p className="text-xs text-muted-foreground mt-1">请先在「GEO 配置」完成企业资料并保存，系统会自动编译出 L2 信源与 L3 AI 名片。</p>
          </div>
        )}

        {/* L3 AI 名片 */}
        {aiCard && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="font-mono text-[11px] text-violet-500 border border-violet-500/35 rounded px-1.5 py-0.5">03 · L3</span>
              <h3 className="text-sm font-semibold text-foreground">AI 名片</h3>
              <span className="text-xs text-muted-foreground">每篇文章必引 1 条 · 独占名额</span>
            </div>
            <AiCardSection card={aiCard} />
          </section>
        )}

        {/* L2 信源 */}
        {l2Sources.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <span className="font-mono text-[11px] text-sky-500 border border-sky-500/35 rounded px-1.5 py-0.5">02 · L2</span>
              <h3 className="text-sm font-semibold text-foreground">可引用信源</h3>
              <span className="text-xs text-muted-foreground">
                共 {l2Sources.length} 条 · 可用 {enabledSources.length} 条 · 每篇取 5–8 条（usageCount 少用先用）
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {l2Sources.map((s) => (
                <SourceCard key={s.id} source={s} maxUsage={stats.maxUsage} />
              ))}
            </div>
          </section>
        )}

        {/* 信源组合 · 各组合隔离展示 */}
        <section>
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span className="font-mono text-[11px] text-emerald-500 border border-emerald-500/35 rounded px-1.5 py-0.5">01 · 组合</span>
            <h3 className="text-sm font-semibold text-foreground">信源组合引用次数</h3>
            <span className="text-xs text-muted-foreground">每个组合 = 一次文章生成的引用集合（L3 必引 + 5–8 条 L2）· 仅审核通过计入次数</span>
          </div>
          {combinations.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-8 text-center">
              <Boxes className="w-8 h-8 text-muted-foreground/50 mx-auto mb-3" />
              <p className="text-sm font-medium text-foreground">暂无引用组合记录</p>
              <p className="text-xs text-muted-foreground mt-1">新版本起，每次文章生成都会记录其实际引用的信源集合，并在本页按组合隔离展示。</p>
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {combinations.map((combo, i) => (
                <CombinationCard key={combo.key} combo={combo} index={i} sourceMap={sourceMap} />
              ))}
            </div>
          )}
        </section>

        {/* 页脚 */}
        <footer className="pt-2 pb-4 border-t border-border text-[11px] text-muted-foreground flex flex-wrap gap-x-5 gap-y-1">
          <span>文章总数 {stats.articleCount}</span>
          <span>审核通过 {stats.approvedCount}</span>
          <span>组合记录自 v19 迁移起生效</span>
          <span className="ml-auto font-mono">数据时间 {formatDate(data.generatedAt)}</span>
        </footer>
      </div>
    </div>
  );
}
