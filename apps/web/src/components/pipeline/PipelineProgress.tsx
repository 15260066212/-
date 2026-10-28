import { useState, useEffect, useMemo } from 'react';
import type { PipelineStatus, PipelineRun, PlatformId } from '@zemingengine/shared';
import {
  Loader2, CheckCircle2, AlertCircle, Clock, Pause, Play,
  FileText, Shield, Send, RefreshCw, Activity, XCircle, MessageSquare, Send as SendIcon,
  Tag, Plus, X,
} from 'lucide-react';

const API_BASE = '/api';

function getApiKey(): string | null {
  try {
    const raw = localStorage.getItem('geo_auth_user');
    if (!raw) return null;
    const user = JSON.parse(raw);
    return user?.apiKey ?? null;
  } catch {
    return null;
  }
}

const PLATFORM_LABELS: Record<string, string> = {
  weixin: '微信公众号', zhihu: '知乎', baijia: '百家号', toutiao: '今日头条',
  csdn: 'CSDN', juejin: '掘金', bilibili: '哔哩哔哩',
  sohu: '搜狐号', netease: '网易号', zhidao: '百度知道',
  deepseek: 'DeepSeek', kimi: 'Kimi', doubao: '豆包', yuanbao: '元宝', qianwen: '千问',
};

const STAGE_STEPS = [
  { key: 'generating', label: '生成文章', icon: FileText, color: 'primary' },
  { key: 'reviewing', label: '智能审核', icon: Shield, color: 'warning' },
  { key: 'publishing', label: '自动发布', icon: Send, color: 'success' },
] as const;

type StageKey = typeof STAGE_STEPS[number]['key'];

interface Props {
  status: PipelineStatus | null;
  isRunning: boolean;
  isPaused?: boolean;
  runId: string | null;
  sessionId: string;
  onCancel?: (runId: string) => void;
  onPause?: (runId: string) => void;
  onResume?: (runId: string) => void;
}

export function PipelineProgress({ status, isRunning, isPaused, runId, sessionId, onCancel, onPause, onResume }: Props) {
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackSending, setFeedbackSending] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [existingFeedback, setExistingFeedback] = useState('');

  // Keyword supplement state
  const [keywordInput, setKeywordInput] = useState('');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordSending, setKeywordSending] = useState(false);

  // Load existing feedback on mount
  useEffect(() => {
    if (!sessionId) return;
    const apiKey = getApiKey();
    fetch(`${API_BASE}/pipeline/feedback/${sessionId}`, {
      headers: apiKey ? { 'x-api-key': apiKey } : {},
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.data?.feedback) {
          setExistingFeedback(data.data.feedback);
        }
      })
      .catch(() => {});
  }, [sessionId]);

  // Load existing supplemented keywords on mount
  useEffect(() => {
    if (!sessionId) return;
    const apiKey = getApiKey();
    fetch(`${API_BASE}/pipeline/keywords/${sessionId}`, {
      headers: apiKey ? { 'x-api-key': apiKey } : {},
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.data?.keywords) {
          setKeywords(data.data.keywords);
        }
      })
      .catch(() => {});
  }, [sessionId]);

  const handleAddKeyword = async () => {
    const text = keywordInput.trim();
    if (!text) return;
    // Support comma-separated input
    const newKeywords = text.split(/[,，]/).map((k) => k.trim()).filter((k) => k.length > 0);
    if (newKeywords.length === 0) return;
    setKeywordSending(true);
    try {
      const apiKey = getApiKey();
      const res = await fetch(`${API_BASE}/pipeline/keywords/${sessionId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'x-api-key': apiKey } : {}),
        },
        body: JSON.stringify({ keywords: newKeywords }),
      });
      const data = await res.json();
      if (data.success) {
        setKeywords(data.data.keywords);
        setKeywordInput('');
      }
    } catch {
      // ignore
    } finally {
      setKeywordSending(false);
    }
  };

  const handleRemoveKeyword = async (kw: string) => {
    const updated = keywords.filter((k) => k !== kw);
    setKeywords(updated);
    const apiKey = getApiKey();
    // Re-submit the full list (without the removed keyword) by clearing and re-adding
    await fetch(`${API_BASE}/pipeline/keywords/${sessionId}`, {
      method: 'DELETE',
      headers: apiKey ? { 'x-api-key': apiKey } : {},
    });
    if (updated.length > 0) {
      await fetch(`${API_BASE}/pipeline/keywords/${sessionId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'x-api-key': apiKey } : {}),
        },
        body: JSON.stringify({ keywords: updated }),
      });
    }
  };

  const handleSubmitFeedback = async () => {
    const text = feedbackText.trim();
    if (!text) return;
    setFeedbackSending(true);
    setFeedbackSent(false);
    try {
      const apiKey = getApiKey();
      const res = await fetch(`${API_BASE}/pipeline/feedback/${sessionId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'x-api-key': apiKey } : {}),
        },
        body: JSON.stringify({ feedback: text }),
      });
      const data = await res.json();
      if (data.success) {
        setExistingFeedback(data.data.feedback);
        setFeedbackText('');
        setFeedbackSent(true);
        setTimeout(() => setFeedbackSent(false), 3000);
      }
    } catch {
      // ignore
    } finally {
      setFeedbackSending(false);
    }
  };
  const [elapsed, setElapsed] = useState(0);
  const [logs, setLogs] = useState<{ time: string; msg: string; type: 'info' | 'success' | 'error' }[]>([]);

  const run = status?.run;

  // Track elapsed time
  useEffect(() => {
    if (!isRunning || !run?.startedAt) return;
    const start = new Date(run.startedAt).getTime();
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [isRunning, run?.startedAt]);

  // Generate activity logs from status changes
  const prevArticlesRef = useMemo(() => ({ count: 0, published: 0, failed: 0 }), []);
  useEffect(() => {
    if (!status) return;
    const newLogs: { time: string; msg: string; type: 'info' | 'success' | 'error' }[] = [];
    const now = new Date().toLocaleTimeString('zh-CN', { hour12: false });

    if (status.articles.length > prevArticlesRef.count) {
      const newCount = status.articles.length - prevArticlesRef.count;
      newLogs.push({ time: now, msg: `新增 ${newCount} 篇文章（共 ${status.articles.length} 篇）`, type: 'info' });
      prevArticlesRef.count = status.articles.length;
    }
    if (status.published > prevArticlesRef.published) {
      const newPub = status.published - prevArticlesRef.published;
      newLogs.push({ time: now, msg: `${newPub} 篇文章发布成功`, type: 'success' });
      prevArticlesRef.published = status.published;
    }
    if (status.failed > prevArticlesRef.failed) {
      const newFail = status.failed - prevArticlesRef.failed;
      newLogs.push({ time: now, msg: `${newFail} 篇文章处理失败`, type: 'error' });
      prevArticlesRef.failed = status.failed;
    }

    if (run?.currentPlatform) {
      newLogs.push({ time: now, msg: `正在处理平台：${PLATFORM_LABELS[run.currentPlatform] ?? run.currentPlatform}`, type: 'info' });
    }

    if (newLogs.length > 0) {
      setLogs((prev) => [...prev, ...newLogs].slice(-20));
    }
  }, [status, run?.currentPlatform]);

  // Reset logs when pipeline starts fresh
  useEffect(() => {
    if (runId && run?.status === 'running' && logs.length === 0 && status?.totalArticles === 0) {
      setLogs([{ time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), msg: '流水线已启动，开始生成文章...', type: 'info' }]);
    }
  }, [runId, run?.status]);

  if (!isRunning && !run) return null;

  const total = run?.totalArticles ?? status?.totalArticles ?? 0;
  const completed = run?.completedArticles ?? 0;
  const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;

  const isCompleted = run?.status === 'completed';
  const isFailed = run?.status === 'failed';
  const isCancelled = run?.status === 'cancelled';
  const actuallyRunning = run?.status === 'running';
  const actuallyPaused = isPaused || run?.status === 'paused';

  const currentStage: StageKey = useMemo(() => {
    if (status && status.reviewing > 0 && status.draft === 0) return 'reviewing';
    if (status && status.publishing > 0) return 'publishing';
    if (status && status.published > 0 && status.draft === 0 && status.reviewing === 0) return 'publishing';
    return 'generating';
  }, [status?.draft, status?.reviewing, status?.publishing, status?.published]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="bg-card rounded-xl border border-border shadow-card overflow-hidden">
      {/* Header */}
      <div className={`px-5 py-4 border-b border-border ${
        isCompleted ? 'bg-success/5'
        : isFailed || isCancelled ? 'bg-error/5'
        : actuallyPaused ? 'bg-warning/5'
        : 'bg-primary/5'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {actuallyRunning ? (
              <Loader2 className="w-5 h-5 text-primary animate-spin" />
            ) : actuallyPaused ? (
              <Pause className="w-5 h-5 text-warning" />
            ) : isCompleted ? (
              <CheckCircle2 className="w-5 h-5 text-success" />
            ) : (
              <AlertCircle className="w-5 h-5 text-error" />
            )}
            <span className="text-sm font-semibold text-foreground">
              {isCompleted ? '流水线已完成' : isFailed ? '流水线失败' : isCancelled ? '流水线已取消' : actuallyPaused ? '流水线已暂停' : '流水线运行中'}
            </span>
            {actuallyPaused && (
              <span className="text-xs text-warning bg-warning/10 px-2 py-0.5 rounded-full">等待恢复</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {(actuallyRunning || actuallyPaused) && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="w-3.5 h-3.5" />
                <span className="tabular-nums">{formatTime(elapsed)}</span>
              </div>
            )}
            {/* Pause / Resume button */}
            {runId && actuallyRunning && onPause && (
              <button
                onClick={() => onPause(runId)}
                className="inline-flex items-center gap-1 rounded-md border border-warning/50 bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning hover:bg-warning/20 transition-colors"
                title="暂停流水线（当前文章完成后暂停）"
              >
                <Pause className="w-3.5 h-3.5" />
                暂停
              </button>
            )}
            {runId && actuallyPaused && onResume && (
              <button
                onClick={() => onResume(runId)}
                className="inline-flex items-center gap-1 rounded-md border border-success/50 bg-success/10 px-2.5 py-1 text-xs font-medium text-success hover:bg-success/20 transition-colors"
                title="恢复流水线"
              >
                <Play className="w-3.5 h-3.5" />
                恢复
              </button>
            )}
            {onCancel && runId && (isRunning || isCompleted || isFailed || isCancelled) && (
              <button
                onClick={() => onCancel(runId)}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                title={isRunning ? '关闭流水线（方案更新后可重新启动）' : '关闭流水线记录'}
              >
                <XCircle className="w-3.5 h-3.5" />
                {isRunning ? '关闭流水线' : '关闭记录'}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* Progress bar */}
        {total > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">整体进度</span>
              <span className="text-xs font-medium text-foreground tabular-nums">
                {completed} / {total} 篇（{progressPercent}%）
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ease-out ${
                  isFailed ? 'bg-error' : isCompleted ? 'bg-success' : 'bg-primary'
                }`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}

        {/* Stage indicators */}
        <div className="flex items-center gap-2">
          {STAGE_STEPS.map((step, idx) => {
            const Icon = step.icon;
            const isActive = currentStage === step.key && isRunning;
            const isDone = STAGE_STEPS.findIndex((s) => s.key === currentStage) > idx || isCompleted;
            return (
              <div key={step.key} className="flex items-center flex-1">
                <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  isActive
                    ? `bg-${step.color}/10 text-${step.color}`
                    : isDone
                    ? 'bg-success/10 text-success'
                    : 'bg-muted text-muted-foreground'
                }`}>
                  {isActive ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : isDone ? (
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  ) : (
                    <Icon className="w-3.5 h-3.5" />
                  )}
                  <span>{step.label}</span>
                </div>
                {idx < STAGE_STEPS.length - 1 && (
                  <div className={`flex-1 h-px mx-1 ${isDone ? 'bg-success/30' : 'bg-border'}`} />
                )}
              </div>
            );
          })}
        </div>

        {/* Current operation */}
        {(actuallyRunning || actuallyPaused) && (
          <div className={`flex items-center gap-3 rounded-lg border px-4 py-2.5 ${actuallyPaused ? 'border-warning/20 bg-warning/5' : 'border-primary/20 bg-primary/5'}`}>
            {actuallyPaused ? (
              <Pause className="w-4 h-4 text-warning" />
            ) : (
              <Activity className="w-4 h-4 text-primary animate-pulse" />
            )}
            <div className="flex-1 min-w-0 text-sm">
              {actuallyPaused ? (
                <span className="text-warning">流水线已暂停 — 点击「恢复」按钮继续执行</span>
              ) : run?.currentPlatform ? (
                <span className="text-foreground">
                  正在处理 <span className="font-medium text-primary">{PLATFORM_LABELS[run.currentPlatform] ?? run.currentPlatform}</span>
                  {run.currentRound ? <span className="text-muted-foreground"> · 第 {run.currentRound} 轮</span> : null}
                </span>
              ) : status && status.draft > 0 ? (
                <span className="text-foreground">正在生成文章... <span className="text-muted-foreground">（{status.draft} 篇草稿）</span></span>
              ) : status && status.reviewing > 0 ? (
                <span className="text-foreground">正在审核文章... <span className="text-muted-foreground">（{status.reviewing} 篇审核中）</span></span>
              ) : status && status.publishing > 0 ? (
                <span className="text-foreground">正在发布文章... <span className="text-muted-foreground">（{status.publishing} 篇发布中）</span></span>
              ) : (
                <span className="text-muted-foreground">等待流水线启动...</span>
              )}
            </div>
          </div>
        )}

        {/* Quick stats when running */}
        {(actuallyRunning || actuallyPaused) && status && (
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: '草稿', value: status.draft, color: 'text-foreground/70' },
              { label: '审核中', value: status.reviewing, color: 'text-warning' },
              { label: '已发布', value: status.published, color: 'text-success' },
              { label: '失败', value: status.failed, color: 'text-error' },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border border-border bg-background/50 px-3 py-2 text-center">
                <div className={`text-lg font-bold tabular-nums ${s.color}`}>{s.value}</div>
                <div className="text-[10px] text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Activity log */}
        {logs.length > 0 && (
          <div className="rounded-lg border border-border bg-background/50 overflow-hidden">
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/50">
              <RefreshCw className={`w-3 h-3 text-muted-foreground ${isRunning ? 'animate-spin' : ''}`} />
              <span className="text-xs font-medium text-muted-foreground">实时日志</span>
            </div>
            <div className="max-h-32 overflow-y-auto px-3 py-2 space-y-1">
              {logs.map((log, idx) => (
                <div key={idx} className="flex items-start gap-2 text-xs">
                  <span className="text-muted-foreground/60 tabular-nums flex-shrink-0">{log.time}</span>
                  <span className={`flex-shrink-0 ${log.type === 'success' ? 'text-success' : log.type === 'error' ? 'text-error' : 'text-foreground/70'}`}>
                    {log.type === 'success' ? '✓' : log.type === 'error' ? '✗' : '•'}
                  </span>
                  <span className={`min-w-0 ${log.type === 'success' ? 'text-success' : log.type === 'error' ? 'text-error' : 'text-foreground/70'}`}>
                    {log.msg}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Completion summary */}
        {isCompleted && run && (
          <div className="rounded-lg border border-success/20 bg-success/5 px-4 py-3">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="w-4 h-4 text-success" />
              <span className="text-sm font-medium text-success">流水线已完成</span>
            </div>
            <div className="text-xs text-muted-foreground space-y-0.5">
              <div>总文章数：{run.totalArticles} 篇</div>
              <div>已发布：{status?.published ?? 0} 篇 · 仅存草稿：{status?.draft_saved ?? 0} 篇 · 失败：{status?.failed ?? 0} 篇</div>
              {run.completedAt && (
                <div>完成时间：{new Date(run.completedAt).toLocaleString('zh-CN')}</div>
              )}
            </div>
          </div>
        )}

        {/* Error message */}
        {isFailed && run?.errorMessage && (
          <div className="rounded-lg border border-error/20 bg-error/5 px-4 py-3">
            <div className="flex items-center gap-2 mb-1">
              <AlertCircle className="w-4 h-4 text-error" />
              <span className="text-sm font-medium text-error">流水线执行失败</span>
            </div>
            <div className="text-xs text-error/80">{run.errorMessage}</div>
          </div>
        )}

        {/* Keyword supplement */}
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <Tag className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-primary">关键词补充</span>
            <span className="text-xs text-muted-foreground">（提交后立即影响后续文章生成）</span>
          </div>
          {keywords.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {keywords.map((kw) => (
                <span
                  key={kw}
                  className="inline-flex items-center gap-1 rounded-full bg-background/50 border border-primary/20 px-2 py-0.5 text-xs text-foreground/80"
                >
                  {kw}
                  <button
                    onClick={() => handleRemoveKeyword(kw)}
                    className="text-muted-foreground hover:text-error transition-colors"
                    title="移除关键词"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleAddKeyword();
                }
              }}
              placeholder="输入关键词，多个用逗号分隔，如：AI客服, 智能营销"
              className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-ring"
              disabled={keywordSending}
            />
            <button
              onClick={handleAddKeyword}
              disabled={keywordSending || !keywordInput.trim()}
              className="inline-flex items-center gap-1 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {keywordSending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
              添加
            </button>
          </div>
        </div>

        {/* Real-time article feedback */}
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <MessageSquare className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-primary">文章反馈</span>
            <span className="text-xs text-muted-foreground">（提交后立即影响后续文章生成）</span>
          </div>
          {existingFeedback && (
            <div className="mb-2 rounded-md bg-background/50 px-3 py-2 text-xs text-muted-foreground">
              <span className="font-medium">已提交反馈：</span>
              <pre className="mt-1 whitespace-pre-wrap font-sans">{existingFeedback}</pre>
            </div>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmitFeedback();
                }
              }}
              placeholder="输入反馈，如：SEO优化性差、文章长度不够、专业度不足"
              className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-ring"
              disabled={feedbackSending}
            />
            <button
              onClick={handleSubmitFeedback}
              disabled={feedbackSending || !feedbackText.trim()}
              className="inline-flex items-center gap-1 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {feedbackSending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : feedbackSent ? (
                <CheckCircle2 className="w-3.5 h-3.5" />
              ) : (
                <SendIcon className="w-3.5 h-3.5" />
              )}
              {feedbackSent ? '已提交' : '提交反馈'}
            </button>
          </div>
          {feedbackSent && (
            <div className="mt-1.5 text-xs text-success flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              反馈已提交，后续文章将根据此反馈优化
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
