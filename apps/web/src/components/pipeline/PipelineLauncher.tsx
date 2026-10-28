import { useState, useEffect } from 'react';
import type { PlatformId, ArticleContentType, SessionData } from '@zemingengine/shared';
import { usePipelineStore } from '../../stores/pipelineStore.js';
import { Building2, Send, Sparkles } from 'lucide-react';

interface Props {
  sessionId: string;
  sessionData: SessionData | null;
}

const ALL_PLATFORMS: { id: PlatformId; label: string }[] = [
  { id: 'weixin', label: '微信公众号' },
  { id: 'zhihu', label: '知乎' },
  { id: 'toutiao', label: '今日头条' },
  { id: 'csdn', label: 'CSDN' },
  { id: 'juejin', label: '掘金' },
  { id: 'sohu', label: '搜狐号' },
  { id: 'netease', label: '网易号' },
];

const CONTENT_TYPES: { id: ArticleContentType; label: string }[] = [
  { id: 'tutorial', label: '教程' },
  { id: 'case', label: '案例' },
  { id: 'comparison', label: '对比' },
  { id: 'popularization', label: '科普' },
  { id: 'faq', label: 'FAQ问答' },
  { id: 'whitepaper', label: '白皮书' },
];

export function PipelineLauncher({ sessionId, sessionData }: Props) {
  const { startPipeline, isRunning, error, clearError } = usePipelineStore();
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<PlatformId>>(
    new Set(['weixin', 'zhihu']),
  );
  const [contentType, setContentType] = useState<ArticleContentType>('tutorial');
  const [autoPublish, setAutoPublish] = useState(false);
  const [scheduledPublish, setScheduledPublish] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  /** 每个平台定制的篇数，未设置的平台在后端会使用 planDuration 默认值 */
  const [perPlatformCounts, setPerPlatformCounts] = useState<Partial<Record<PlatformId, number>>>({});

  // 当选中平台变化时，自动为新选中的平台设默认篇数，移除未选中的
  useEffect(() => {
    setPerPlatformCounts((prev) => {
      const next: Partial<Record<PlatformId, number>> = {};
      selectedPlatforms.forEach((p) => {
        next[p] = prev[p] ?? 1;
      });
      return next;
    });
  }, [selectedPlatforms]);

  const enterprise = sessionData?.enterprise;
  const enterpriseName = enterprise?.fullName || '未命名企业';
  const enterpriseLocation = enterprise?.location || '未设置';
  const enterpriseProduct = enterprise?.products?.length ? enterprise.products[0].name : '未设置';
  const enterpriseTone = enterprise?.brandTone?.length ? enterprise.brandTone[0] : '未设置';

  const togglePlatform = (id: PlatformId) => {
    setSelectedPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const updatePlatformCount = (id: PlatformId, n: number) => {
    const clamped = Math.max(1, Math.min(n, 50));
    setPerPlatformCounts((prev) => ({ ...prev, [id]: clamped }));
  };

  // 计算预览的总篇数
  const previewTotal = Array.from(selectedPlatforms).reduce(
    (sum, p) => sum + (perPlatformCounts[p] ?? 1),
    0,
  );

  const handleStart = () => {
    if (selectedPlatforms.size === 0 || isRunning) return;
    startPipeline({
      sessionId,
      platforms: Array.from(selectedPlatforms),
      contentType,
      autoPublish,
      scheduledAt: scheduledPublish && scheduledAt ? scheduledAt : undefined,
      platformArticleCounts: perPlatformCounts,
    });
  };

  const toggleAll = () => {
    if (selectedPlatforms.size === ALL_PLATFORMS.length) {
      setSelectedPlatforms(new Set());
    } else {
      setSelectedPlatforms(new Set(ALL_PLATFORMS.map((p) => p.id)));
    }
  };

  return (
    <div className="bg-card rounded-xl border border-border p-5 shadow-card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-foreground">流水线启动器</h2>
        <button
          onClick={toggleAll}
          className="text-xs text-primary hover:text-primary/90 transition-colors"
        >
          {selectedPlatforms.size === ALL_PLATFORMS.length ? '取消全选' : '全选平台'}
        </button>
      </div>

      {/* 当前企业信息（只读展示） */}
      <div className="mb-5 rounded-lg border border-primary/20 bg-primary/5 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Building2 className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium text-foreground">当前企业</span>
          <span className="text-xs text-muted-foreground/70">（来自 GEO 配置）</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">企业名称</div>
            <div className="font-medium text-foreground">{enterpriseName}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">所在地</div>
            <div className="font-medium text-foreground">{enterpriseLocation}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">核心产品</div>
            <div className="font-medium text-foreground">{enterpriseProduct}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">品牌调性</div>
            <div className="font-medium text-foreground">{enterpriseTone}</div>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground/70">
          文章将使用该企业的账号凭据和品牌信息进行生成与分发
        </p>
      </div>

      {/* 平台选择（带每平台篇数定制） */}
      <div className="mb-5">
        <label className="block text-sm font-medium text-foreground/70 mb-2">
          选择平台（可定制每个平台的篇数）
        </label>
        <div className="space-y-2">
          {ALL_PLATFORMS.map((platform) => {
            const checked = selectedPlatforms.has(platform.id);
            const count = perPlatformCounts[platform.id] ?? 1;
            return (
              <div
                key={platform.id}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                  checked
                    ? 'border-primary bg-primary/10 text-primary/90'
                    : 'border-border hover:border-border/80 text-foreground/70'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => togglePlatform(platform.id)}
                  className="rounded border-border text-primary focus:ring-primary flex-shrink-0"
                />
                <span className="flex-1 text-sm">{platform.label}</span>
                {checked && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs text-muted-foreground">篇数</span>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={count}
                      onChange={(e) => updatePlatformCount(platform.id, parseInt(e.target.value, 10) || 1)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-16 rounded border border-border bg-background px-2 py-0.5 text-sm text-center text-foreground focus:border-primary focus:ring-1 focus:ring-primary"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {selectedPlatforms.size > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            预计共生成 <span className="font-medium text-primary">{previewTotal}</span> 篇文章
          </p>
        )}
      </div>

      {/* 内容类型选择 */}
      <div className="mb-5">
        <label className="block text-sm font-medium text-foreground/70 mb-2">
          内容类型
        </label>
        <div className="flex flex-wrap gap-2">
          {CONTENT_TYPES.map((type) => {
            const checked = contentType === type.id;
            return (
              <button
                key={type.id}
                onClick={() => setContentType(type.id)}
                className={`rounded-lg border px-4 py-1.5 text-sm transition-colors ${
                  checked
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-foreground/70 hover:border-border/80'
                }`}
              >
                {type.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 自动发布 */}
      <div className="mb-5">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={autoPublish}
            onChange={(e) => setAutoPublish(e.target.checked)}
            className="rounded border-border text-primary focus:ring-primary"
          />
          <span className="text-sm text-foreground/90">
            自动发布（审核通过后自动发布到对应平台）
          </span>
        </label>
      </div>

      {/* 定时发布 */}
      {autoPublish && (
        <div className="mb-5 pl-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={scheduledPublish}
              onChange={(e) => setScheduledPublish(e.target.checked)}
              className="rounded border-border text-primary focus:ring-primary"
            />
            <span className="text-sm text-foreground/90">定时发布</span>
          </label>
          {scheduledPublish && (
            <div className="mt-2">
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground/90 focus:border-primary focus:ring-1 focus:ring-primary"
              />
              {!scheduledAt && (
                <p className="mt-1 text-xs text-muted-foreground/70">请选择定时发布时间</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <div className="mb-4 rounded-lg border border-error/30 bg-error-bg px-4 py-3 text-sm text-error">
          <div className="flex items-start justify-between">
            <div>
              <div className="font-medium">启动失败</div>
              <div className="mt-1">{error}</div>
            </div>
            <button
              onClick={clearError}
              className="text-xs text-error underline underline-offset-2"
            >
              关闭
            </button>
          </div>
        </div>
      )}

      {/* 启动按钮 */}
      <button
        onClick={handleStart}
        disabled={selectedPlatforms.size === 0 || isRunning}
        className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isRunning ? (
          <>
            <Sparkles className="w-4 h-4 animate-pulse" />
            正在运行流水线...
          </>
        ) : (
          <>
            <Send className="w-4 h-4" />
            启动流水线 — {enterpriseName}（{selectedPlatforms.size} 个平台）
          </>
        )}
      </button>

      {selectedPlatforms.size === 0 && (
        <p className="mt-2 text-center text-xs text-muted-foreground/70">
          请至少选择一个平台
        </p>
      )}
    </div>
  );
}
