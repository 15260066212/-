import { useState, useMemo, useEffect, useRef } from 'react';
import type {
  PlanDuration,
  ArticleContentType,
  SessionData,
} from '@zemingengine/shared';
import { usePipelineStore } from '../stores/pipelineStore.js';
import { useSessionStore } from '../stores/sessionStore.js';
import { generateOptimizationPlan, inferContentTypes, type OptimizationPlan } from '../utils/planGenerator.js';
import {
  Calendar, Target, FileText, TrendingUp, Send,
  CheckCircle2, Clock, Sparkles, ArrowRight,
  Eye, Download, RefreshCw, Building2,
} from 'lucide-react';

interface Props {
  sessionId: string;
  sessionData: SessionData | null;
  onNavigate: (tab: string) => void;
}

const DURATION_OPTIONS: {
  id: PlanDuration;
  label: string;
  weeks: number;
  articlesPerPlatform: number;
  frequency: string;
  icon: typeof Calendar;
  color: string;
}[] = [
  { id: 'quarter', label: '季度方案', weeks: 13, articlesPerPlatform: 160, frequency: '每周约12篇/平台', icon: Calendar, color: 'success' },
  { id: 'half-year', label: '半年度方案', weeks: 26, articlesPerPlatform: 400, frequency: '每周约15篇/平台', icon: Clock, color: 'warning' },
  { id: 'year', label: '年度方案', weeks: 52, articlesPerPlatform: 1200, frequency: '每周约23篇/平台', icon: TrendingUp, color: 'primary' },
];

const AI_PLATFORMS: { id: string; label: string; logo: string }[] = [
  { id: 'deepseek', label: 'DeepSeek', logo: 'https://brandlogos.sgp1.digitaloceanspaces.com/png/logos/deepseek-400.png' },
  { id: 'kimi', label: 'Kimi', logo: 'https://aka.doubaocdn.com/s/DkoTkuKQOD' },
  { id: 'doubao', label: '豆包', logo: 'https://aka.doubaocdn.com/s/PPg55cnPjq' },
  { id: 'yuanbao', label: '元宝', logo: 'https://aka.doubaocdn.com/s/pfJwYGSzOi' },
  { id: 'qianwen', label: '千问', logo: 'https://aka.doubaocdn.com/s/PjIVxqYtuc' },
];

const CONTENT_TYPE_LABELS: Record<ArticleContentType, string> = {
  tutorial: '教程', case: '案例', comparison: '对比',
  popularization: '科普', faq: 'FAQ问答', whitepaper: '白皮书',
};

export function OptimizationPlanPage({ sessionId, sessionData, onNavigate }: Props) {
  const { startPipeline, isRunning, error, clearError } = usePipelineStore();
  const { isComplete } = useSessionStore();

  const [duration, setDuration] = useState<PlanDuration>('quarter');
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(
    new Set(['deepseek', 'kimi', 'doubao', 'yuanbao', 'qianwen']),
  );
  const [autoPublish, setAutoPublish] = useState(true);
  const [plan, setPlan] = useState<OptimizationPlan | null>(null);
  const [planArticles, setPlanArticles] = useState<{ platform: string; contentType: string; topic: string; keyword: string; week: number }[]>([]);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const enterprise = sessionData?.enterprise;
  const selectedDuration = DURATION_OPTIONS.find((d) => d.id === duration)!;

  const togglePlatform = (id: string) => {
    setSelectedPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setPlan(null);
  };

  const totalArticles = useMemo(() => {
    return selectedPlatforms.size * selectedDuration.articlesPerPlatform;
  }, [selectedPlatforms.size, selectedDuration]);

  const inferredTypes = useMemo(() => {
    if (!enterprise) return [];
    return inferContentTypes(enterprise);
  }, [enterprise]);

  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [supplementText, setSupplementText] = useState('');
  const [savedPlan, setSavedPlan] = useState<any>(null);

  // Load saved plan on mount
  useEffect(() => {
    if (!sessionId) return;
    const apiKey = localStorage.getItem('apiKey') || '';
    fetch(`/api/optimization-plan/saved/${sessionId}`, {
      headers: { 'x-api-key': apiKey },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setSavedPlan(data.data.plan);
          if (data.data.plan.content_supplement) {
            setSupplementText(data.data.plan.content_supplement);
          }
        }
      })
      .catch(() => {});
  }, [sessionId]);

  const handleGeneratePlan = async () => {
    if (!sessionData || selectedPlatforms.size === 0 || inferredTypes.length === 0) return;
    setGenerating(true);
    setGenError(null);
    try {
      const apiKey = localStorage.getItem('apiKey') || '';
      const resp = await fetch('/api/optimization-plan/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({
          sessionId,
          enterprise: sessionData.enterprise,
          keywords: sessionData.keywords,
          duration,
          platforms: Array.from(selectedPlatforms),
          contentTypes: inferredTypes,
          autoPublish,
          contentSupplement: supplementText,
        }),
      });
      const data = await resp.json();
      if (!data.success) {
        setGenError(data.error || '生成方案失败');
        return;
      }
      setPlan({
        html: data.data.html,
        config: { duration, platforms: Array.from(selectedPlatforms), contentTypes: inferredTypes, autoPublish },
        weeks: [],
        totalArticles: totalArticles,
      });
      setPlanArticles(data.data.planArticles || []);
      setShowPlanModal(true);
    } catch (err) {
      setGenError('无法连接到服务器，请稍后重试');
    } finally {
      setGenerating(false);
    }
  };

  const PUBLISH_PLATFORM_IDS = ['weixin', 'zhihu', 'baijia', 'toutiao', 'csdn', 'juejin', 'sohu', 'netease', 'zhidao'];

  const handleLaunchPipeline = () => {
    if (!plan || selectedPlatforms.size === 0 || isRunning) return;
    const hasPlanArticles = planArticles.length > 0;
    startPipeline({
      sessionId,
      platforms: hasPlanArticles
        ? Array.from(new Set(planArticles.map(a => a.platform))) as any
        : PUBLISH_PLATFORM_IDS as any,
      contentType: plan.config.contentTypes[0],
      contentTypes: plan.config.contentTypes,
      autoPublish,
      planDuration: duration,
      planArticles: hasPlanArticles ? planArticles : undefined,
      contentSupplement: supplementText || undefined,
    } as any);
    onNavigate('pipeline');
  };

  const toggleAllPlatforms = () => {
    if (selectedPlatforms.size === AI_PLATFORMS.length) {
      setSelectedPlatforms(new Set());
    } else {
      setSelectedPlatforms(new Set(AI_PLATFORMS.map((p) => p.id)));
    }
    setPlan(null);
  };

  const handleDownloadPlan = () => {
    if (!plan) return;
    const blob = new Blob([plan.html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GEO优化方案_${enterprise?.shortName || '企业'}_${selectedDuration.label}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const configComplete = isComplete || (enterprise?.fullName && enterprise?.products?.length);

  if (!sessionData || !enterprise) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="p-6 max-w-5xl mx-auto">
          <div className="rounded-xl border border-warning/30 bg-warning-bg p-6 text-center">
            <Clock className="w-8 h-8 text-warning mx-auto mb-3" />
            <p className="text-sm text-foreground mb-2">尚未选择企业项目</p>
            <p className="text-xs text-muted-foreground mb-4">请先在「GEO 配置」中选择或新建企业项目，完成基础配置后再生成优化方案。</p>
            <button
              onClick={() => onNavigate('chat')}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Building2 className="w-4 h-4" />
              前往 GEO 配置
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 max-w-5xl mx-auto space-y-5">
        {/* 流程引导 */}
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span className={`flex items-center gap-1 ${configComplete ? 'text-success' : ''}`}>
            <CheckCircle2 className="w-4 h-4" />
            企业配置
          </span>
          <ArrowRight className="w-4 h-4" />
          <span className="flex items-center gap-1 text-primary font-medium">
            <Target className="w-4 h-4" />
            优化方案
          </span>
          <ArrowRight className="w-4 h-4" />
          <span className="flex items-center gap-1">
            <FileText className="w-4 h-4" />
            文章生成
          </span>
          <ArrowRight className="w-4 h-4" />
          <span className="flex items-center gap-1">
            <Send className="w-4 h-4" />
            发布
          </span>
        </div>

        {/* 企业信息摘要 */}
        {enterprise && (
          <div className="bg-card rounded-xl border border-border p-4 shadow-card">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">当前企业</h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">企业名称</div>
                <div className="font-medium text-foreground">{enterprise.fullName || '未设置'}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">所在地</div>
                <div className="font-medium text-foreground">{enterprise.location || '未设置'}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">核心产品</div>
                <div className="font-medium text-foreground">
                  {enterprise.products?.length ? enterprise.products[0].name : '未设置'}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">品牌调性</div>
                <div className="font-medium text-foreground">
                  {enterprise.brandTone?.length ? enterprise.brandTone[0] : '未设置'}
                </div>
              </div>
            </div>
            {!configComplete && (
              <div className="mt-3 flex items-center gap-2 text-xs text-warning">
                <Clock className="w-3 h-3" />
                <span>企业配置尚未完成，建议先完成</span>
                <button
                  onClick={() => onNavigate('chat')}
                  className="text-primary underline underline-offset-2"
                >
                  去配置
                </button>
              </div>
            )}
          </div>
        )}

        {/* 步骤1: 选择方案周期 */}
        <div className="bg-card rounded-xl border border-border p-5 shadow-card">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">1</span>
            <h2 className="text-base font-semibold text-foreground">选择优化方案周期</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {DURATION_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const checked = duration === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => { setDuration(opt.id); setPlan(null); }}
                  className={`rounded-xl border p-4 text-left transition-colors ${
                    checked
                      ? `border-${opt.color} bg-${opt.color}/10`
                      : 'border-border hover:border-border/80 hover:bg-muted/30'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <Icon className={`w-5 h-5 ${checked ? `text-${opt.color}` : 'text-muted-foreground'}`} />
                    {checked && <CheckCircle2 className={`w-4 h-4 text-${opt.color}`} />}
                  </div>
                  <div className="font-medium text-foreground text-sm">{opt.label}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {opt.weeks} 周 · {opt.articlesPerPlatform} 篇/平台
                  </div>
                  <div className="text-xs text-muted-foreground/70 mt-0.5">{opt.frequency}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 步骤2: 选择AI平台 */}
        <div className="bg-card rounded-xl border border-border p-5 shadow-card">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">2</span>
              <h2 className="text-base font-semibold text-foreground">选择 AI 平台</h2>
              <span className="text-xs text-muted-foreground">（GEO 优化目标）</span>
            </div>
            <button
              onClick={toggleAllPlatforms}
              className="text-xs text-primary hover:text-primary/90 transition-colors"
            >
              {selectedPlatforms.size === AI_PLATFORMS.length ? '取消全选' : '全选平台'}
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
            {AI_PLATFORMS.map((platform) => {
              const checked = selectedPlatforms.has(platform.id);
              return (
                <label
                  key={platform.id}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors text-sm ${
                    checked
                      ? 'border-primary bg-primary/10 text-primary/90'
                      : 'border-border hover:border-border/80 text-foreground/70'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => togglePlatform(platform.id)}
                    className="rounded border-border text-primary focus:ring-primary"
                  />
                  <img src={platform.logo} alt={platform.label} className="w-5 h-5 rounded-sm flex-shrink-0 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  <span>{platform.label}</span>
                </label>
              );
            })}
          </div>
        </div>

        {/* 步骤3: 内容类型（自动推断） */}
        <div className="bg-card rounded-xl border border-border p-5 shadow-card">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">3</span>
            <h2 className="text-base font-semibold text-foreground">内容类型</h2>
            <span className="text-xs text-muted-foreground">（根据企业画像自动推断）</span>
          </div>
          {inferredTypes.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {inferredTypes.map((typeId) => (
                <span
                  key={typeId}
                  className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary text-xs px-3 py-1.5 font-medium"
                >
                  <CheckCircle2 className="w-3 h-3" />
                  {CONTENT_TYPE_LABELS[typeId]}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">请先完成企业配置，系统将根据企业信息自动推荐内容类型</p>
          )}
        </div>

        {/* 步骤4: 生成方案 */}
        <div className="bg-card rounded-xl border border-border p-5 shadow-card">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">4</span>
            <h2 className="text-base font-semibold text-foreground">生成优化方案</h2>
          </div>

          {/* 概览 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-center">
              <div className="text-2xl font-bold text-primary">{totalArticles}</div>
              <div className="text-xs text-muted-foreground mt-1">总文章数</div>
            </div>
            <div className="rounded-lg border border-border p-3 text-center">
              <div className="text-2xl font-bold text-foreground">{selectedPlatforms.size}</div>
              <div className="text-xs text-muted-foreground mt-1">AI 平台</div>
            </div>
            <div className="rounded-lg border border-border p-3 text-center">
              <div className="text-2xl font-bold text-foreground">{inferredTypes.length}</div>
              <div className="text-xs text-muted-foreground mt-1">内容类型</div>
            </div>
            <div className="rounded-lg border border-border p-3 text-center">
              <div className="text-2xl font-bold text-foreground">{selectedDuration.weeks}</div>
              <div className="text-xs text-muted-foreground mt-1">周数</div>
            </div>
          </div>

          {/* 自动发布 */}
          <label className="flex items-center gap-2 cursor-pointer mb-4">
            <input
              type="checkbox"
              checked={autoPublish}
              onChange={(e) => { setAutoPublish(e.target.checked); setPlan(null); }}
              className="rounded border-border text-primary focus:ring-primary"
            />
            <span className="text-sm text-foreground/90">自动发布（审核通过后自动发布到对应平台）</span>
          </label>

          {/* 内容补充 */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-foreground/90 mb-2">
              内容补充
              <span className="text-xs text-muted-foreground ml-2">（可选：希望融入文章中的补充内容，如特殊宣传点、联系方式、促销信息等）</span>
            </label>
            <textarea
              value={supplementText}
              onChange={(e) => setSupplementText(e.target.value)}
              placeholder="例如：请在文章中加入品牌联系电话 13107869995，强调10年行业经验，提及免费咨询服务等..."
              maxLength={1000}
              rows={4}
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:ring-1 focus:ring-primary resize-y"
            />
            <div className="flex justify-end mt-1">
              <span className={`text-xs ${supplementText.length >= 900 ? 'text-error' : 'text-muted-foreground'}`}>
                {supplementText.length} / 1000
              </span>
            </div>
          </div>

          {/* 已保存方案提示 */}
          {savedPlan && !plan && (
            <div className="mb-4 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium text-primary">已有保存的方案</span>
                  <span className="text-muted-foreground ml-2">
                    生成于 {new Date(savedPlan.updated_at || savedPlan.created_at).toLocaleDateString('zh-CN')}
                  </span>
                </div>
                <button
                  onClick={() => {
                    const articles = Array.isArray(savedPlan.plan_articles) ? savedPlan.plan_articles : JSON.parse(savedPlan.plan_articles || '[]');
                    setPlan({ html: savedPlan.html_content, config: { duration: savedPlan.duration, platforms: savedPlan.platforms, contentTypes: savedPlan.content_types, autoPublish: savedPlan.auto_publish }, weeks: [], totalArticles: articles.length });
                    setPlanArticles(articles);
                    setShowPlanModal(true);
                  }}
                  className="text-xs text-primary underline"
                >
                  查看已保存方案
                </button>
              </div>
            </div>
          )}

          {/* 生成按钮 */}
          <button
            onClick={handleGeneratePlan}
            disabled={selectedPlatforms.size === 0 || inferredTypes.length === 0 || !sessionData || generating}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary/10 border border-primary/30 px-4 py-2.5 text-sm font-medium text-primary hover:bg-primary/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors mb-4"
          >
            {generating ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            {generating ? '正在生成方案...' : plan ? '重新生成优化方案' : '生成优化方案'}
          </button>

          {/* 生成错误提示 */}
          {genError && (
            <div className="mb-4 rounded-lg border border-error/30 bg-error-bg px-4 py-3 text-sm text-error">
              <div className="flex items-start justify-between">
                <div>
                  <span className="font-medium">生成失败：</span>
                  {genError}
                </div>
                <button onClick={() => setGenError(null)} className="text-xs text-error underline ml-2">关闭</button>
              </div>
            </div>
          )}

          {/* 方案已生成提示 */}
          {plan && (
            <div className="space-y-3 animate-in fade-in duration-300">
              <div className="flex items-center gap-2 text-sm text-success">
                <CheckCircle2 className="w-4 h-4" />
                <span>方案已生成，共 {plan.totalArticles} 篇文章，覆盖 {plan.config.platforms.length} 个平台</span>
              </div>

              {/* 方案操作按钮 */}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setShowPlanModal(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 text-primary px-3 py-2 text-xs font-medium hover:bg-primary/20 transition-colors"
                >
                  <Eye className="w-3.5 h-3.5" />
                  查看方案详情
                </button>
                <button
                  onClick={handleDownloadPlan}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card text-foreground px-3 py-2 text-xs font-medium hover:bg-muted/30 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  下载方案HTML
                </button>
              </div>

              {/* 方案摘要预览 */}
              <div className="rounded-lg border border-border p-4 bg-muted/20">
                <div className="text-sm font-medium text-foreground mb-2">方案摘要</div>
                <div className="text-xs text-muted-foreground space-y-1">
                  <div>· 周期：{selectedDuration.label}（{selectedDuration.weeks} 周）</div>
                  <div>· AI 平台：{plan.config.platforms.map(p => AI_PLATFORMS.find(a => a.id === p)?.label || p).join('、')}</div>
                  <div>· 类型：{plan.config.contentTypes.map(t => CONTENT_TYPE_LABELS[t]).join('、')}</div>
                  <div>· 发布：{autoPublish ? '审核通过后自动发布' : '手动发布'}</div>
                </div>
              </div>
            </div>
          )}

          {/* 错误提示 */}
          {error && (
            <div className="mt-4 rounded-lg border border-error/30 bg-error-bg px-4 py-3 text-sm text-error">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium">启动失败</div>
                  <div className="mt-1">{error}</div>
                </div>
                <button onClick={clearError} className="text-xs text-error underline underline-offset-2">
                  关闭
                </button>
              </div>
            </div>
          )}

          {/* 启动流水线按钮 */}
          {plan && (
            <button
              onClick={handleLaunchPipeline}
              disabled={isRunning}
              className="w-full mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Send className="w-4 h-4" />
              {isRunning ? '正在启动...' : `基于方案启动流水线（${plan.totalArticles} 篇文章）`}
            </button>
          )}
        </div>
      </div>

      {/* 方案预览弹窗 */}
      {showPlanModal && plan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowPlanModal(false)}>
          <div className="bg-card rounded-xl shadow-xl w-full h-[90vh] max-w-5xl flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">GEO 优化方案详情</h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDownloadPlan}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted/30 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  下载
                </button>
                <button
                  onClick={() => setShowPlanModal(false)}
                  className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/30 transition-colors"
                >
                  关闭
                </button>
              </div>
            </div>
            <iframe
              ref={iframeRef}
              srcDoc={plan.html}
              title="GEO优化方案"
              className="flex-1 w-full border-0"
            />
          </div>
        </div>
      )}
    </div>
  );
}
