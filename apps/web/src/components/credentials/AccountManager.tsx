import { useEffect, useState, useCallback } from 'react';
import type { PlatformId, SessionData } from '@zemingengine/shared';
import { useCredentialStore } from '../../stores/credentialStore.js';
import {
  Cookie, RefreshCw, CheckCircle2, XCircle, Clock, Plus,
  ExternalLink, Building2, AlertTriangle, Bell,
} from 'lucide-react';

const PLATFORM_LABELS: Record<PlatformId, string> = {
  weixin: '微信公众号', zhihu: '知乎', baijia: '百家号', toutiao: '今日头条',
  csdn: 'CSDN', juejin: '掘金', bilibili: '哔哩哔哩',
  sohu: '搜狐号', netease: '网易号', zhidao: '百度知道',
};

const ALL_PLATFORMS: PlatformId[] = [
  'weixin', 'zhihu', 'baijia', 'toutiao', 'csdn', 'juejin', 'bilibili', 'sohu', 'netease', 'zhidao',
];

const PLATFORM_ICONS: Record<PlatformId, string> = {
  weixin: '💬', zhihu: '知', baijia: '百', toutiao: '头',
  csdn: 'C', juejin: '掘', bilibili: 'B',
  sohu: '搜', netease: '网', zhidao: '百',
};

const STATUS_CONFIG: Record<
  string,
  { label: string; className: string; icon: typeof CheckCircle2 }
> = {
  active: { label: '已保存', className: 'bg-success-bg text-success', icon: CheckCircle2 },
  expired: { label: '已过期', className: 'bg-warning-bg text-warning', icon: Clock },
  invalid: { label: '无效', className: 'bg-error-bg text-error', icon: XCircle },
  none: { label: '未采集', className: 'bg-muted text-muted-foreground', icon: Plus },
};

const API_BASE = '/api/cookie-harvester';

const COOKIE_MAX_AGE_DAYS = 14;
const COOKIE_WARN_AGE_DAYS = 7;

interface CookieAgeInfo {
  daysSince: number;
  label: string;
  severity: 'fresh' | 'warning' | 'critical' | 'unknown';
}

function getCookieAge(lastValidatedAt?: string): CookieAgeInfo {
  if (!lastValidatedAt) return { daysSince: 0, label: '未知', severity: 'unknown' };
  const diff = Date.now() - new Date(lastValidatedAt).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days >= COOKIE_MAX_AGE_DAYS) {
    return { daysSince: days, label: `${days}天前`, severity: 'critical' };
  }
  if (days >= COOKIE_WARN_AGE_DAYS) {
    return { daysSince: days, label: `${days}天前`, severity: 'warning' };
  }
  return { daysSince: days, label: days === 0 ? '今天' : `${days}天前`, severity: 'fresh' };
}

interface SessionInfo {
  sessionId: string;
  platform: string;
  platformName: string;
  loginUrl: string;
  noVncUrl: string;
  message: string;
  brandName?: string;
  internalPlatform?: PlatformId;
}

interface Props {
  sessionData: SessionData | null;
}

export function AccountManager({ sessionData }: Props) {
  const { credentials, loading, error, fetchCredentials, clearError } = useCredentialStore();
  const [harvesterHealthy, setHarvesterHealthy] = useState<boolean | null>(null);
  const [activeSession, setActiveSession] = useState<SessionInfo | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => { fetchCredentials(); }, [fetchCredentials]);

  const checkHealth = useCallback(async () => {
    try {
      const resp = await fetch(`${API_BASE}/health`);
      const data = await resp.json();
      setHarvesterHealthy(data.success === true);
    } catch { setHarvesterHealthy(false); }
  }, []);

  useEffect(() => {
    // 健康检查轮询：首次挂载时立即检查一次，之后每 30 秒检查一次
    // 这是必要的副作用模式 —— 从外部服务获取数据并更新本地状态
    // eslint-disable-next-line react-hooks/set-state-in-effect
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, [checkHealth]);

  const enterprise = sessionData?.enterprise;
  const enterpriseName = enterprise?.fullName || '未命名企业';

  const brandCredentials = credentials.filter(
    (c) => c.accountName === enterpriseName,
  );

  const handleStartHarvest = async (platform: PlatformId) => {
    setLocalError(null);
    setStatusMessage(null);
    setActionLoading(platform);
    try {
      const resp = await fetch(`${API_BASE}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, accountName: enterpriseName }),
      });
      const data = await resp.json();
      if (!data.success) { setLocalError(data.error || '启动失败'); return; }
      setActiveSession({
        ...data,
        brandName: enterpriseName,
        internalPlatform: platform,
      });
      setStatusMessage(`已启动 ${data.platformName} 采集会话，正在打开远程浏览器...`);
      if (data.noVncUrl) {
        window.open(data.noVncUrl, '_blank', 'noopener,noreferrer');
      }
    } catch { setLocalError('无法连接到采集服务'); }
    finally { setActionLoading(null); }
  };

  const handleCheckAndSave = async () => {
    if (!activeSession) return;
    setActionLoading('save');
    setStatusMessage('正在检测登录状态...');
    try {
      const statusResp = await fetch(`${API_BASE}/status/${activeSession.sessionId}`);
      const statusData = await statusResp.json();

      if (!statusData.loggedIn) {
        setStatusMessage('未检测到登录，请在远程浏览器中完成登录后再保存');
        setActionLoading(null);
        return;
      }

      setStatusMessage('检测到登录，正在保存 Cookie...');
      const platform = activeSession.internalPlatform;
      const params = new URLSearchParams();
      if (platform) params.set('platform', platform);
      if (activeSession.brandName) params.set('accountName', activeSession.brandName);
      const url = `${API_BASE}/cookies/${activeSession.sessionId}?${params.toString()}`;
      const resp = await fetch(url);
      const data = await resp.json();
      if (!data.success) { setLocalError(data.error || '保存失败'); setActionLoading(null); return; }

      if (data.savedToCredentials) {
        setStatusMessage(`✅ ${activeSession.platformName} Cookie 已保存`);
        fetchCredentials();
      } else if (data.loggedIn) {
        setStatusMessage('检测到登录但 Cookie 未保存，请重试');
      } else {
        setStatusMessage('未检测到登录状态');
      }
    } catch { setLocalError('无法连接到采集服务'); }
    finally { setActionLoading(null); }
  };

  const handleCloseSession = async () => {
    if (!activeSession) return;
    setActionLoading('close');
    try { await fetch(`${API_BASE}/close/${activeSession.sessionId}`, { method: 'POST' }); }
    catch { /* ignore */ }
    finally {
      setActiveSession(null);
      setStatusMessage(null);
      setActionLoading(null);
    }
  };

  const savedCount = brandCredentials.filter((c) => c.status === 'active').length;

  const expiryAlerts = brandCredentials
    .map((c) => ({ cred: c, age: getCookieAge(c.lastValidatedAt) }))
    .filter(({ cred, age }) => cred.status === 'active' && (age.severity === 'warning' || age.severity === 'critical'));

  const staleCount = expiryAlerts.filter((a) => a.age.severity === 'critical').length;
  const warningCount = expiryAlerts.filter((a) => a.age.severity === 'warning').length;

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="p-4 md:p-6 max-w-none space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-foreground">账号管理</h2>
            <p className="text-sm text-muted-foreground">
              查看各平台 Cookie 保存状态，通过 noVNC 远程浏览器采集登录态
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
              harvesterHealthy === true ? 'bg-success-bg text-success' :
              harvesterHealthy === false ? 'bg-error-bg text-error' : 'bg-muted text-muted-foreground'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${harvesterHealthy ? 'bg-success' : 'bg-error'}`} />
              {harvesterHealthy === true ? '采集服务在线' : harvesterHealthy === false ? '采集服务离线' : '检测中'}
            </span>
            <button
              onClick={() => { fetchCredentials(); checkHealth(); }}
              disabled={loading}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground/90 hover:bg-muted/50 disabled:opacity-50"
            >
              {loading ? '刷新中...' : '刷新'}
            </button>
          </div>
        </div>

        {/* Error banner */}
        {(error || localError) && (
          <div className="rounded-lg border border-error/30 bg-error-bg px-4 py-3 text-sm text-error">
            <div className="flex items-center justify-between">
              <span>{localError || error}</span>
              <div className="flex items-center gap-3">
                <button onClick={() => { fetchCredentials(); setLocalError(null); }} className="text-xs underline">重试</button>
                <button onClick={() => { clearError(); setLocalError(null); }} className="text-xs underline">关闭</button>
              </div>
            </div>
          </div>
        )}

        {/* Current enterprise info */}
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
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
              <div className="font-medium text-foreground">{enterprise?.location || '未设置'}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">核心产品</div>
              <div className="font-medium text-foreground">
                {enterprise?.products?.length ? enterprise.products[0].name : '未设置'}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">品牌调性</div>
              <div className="font-medium text-foreground">
                {enterprise?.brandTone?.length ? enterprise.brandTone[0] : '未设置'}
              </div>
            </div>
          </div>
        </div>

        {/* Cookie expiry reminder banner */}
        {expiryAlerts.length > 0 && (
          <div className={`rounded-xl border px-4 py-3 ${
            staleCount > 0
              ? 'border-error/30 bg-error-bg'
              : 'border-warning/30 bg-warning-bg'
          }`}>
            <div className="flex items-start gap-3">
              <Bell className={`w-5 h-5 mt-0.5 ${staleCount > 0 ? 'text-error' : 'text-warning'}`} />
              <div className="flex-1">
                <div className={`text-sm font-medium ${staleCount > 0 ? 'text-error' : 'text-warning'}`}>
                  Cookie 过期提醒
                </div>
                <div className="mt-1 text-xs text-foreground/80 space-y-1">
                  {staleCount > 0 && (
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle className="w-3 h-3 text-error" />
                      <span>{staleCount} 个平台 Cookie 已超过 {COOKIE_MAX_AGE_DAYS} 天，可能已失效，请尽快重新采集</span>
                    </div>
                  )}
                  {warningCount > 0 && (
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3 h-3 text-warning" />
                      <span>{warningCount} 个平台 Cookie 已超过 {COOKIE_WARN_AGE_DAYS} 天，建议近期重新采集</span>
                    </div>
                  )}
                </div>
                {/* Detail list */}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {expiryAlerts.map(({ cred, age }) => (
                    <span
                      key={cred.platform}
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                        age.severity === 'critical'
                          ? 'bg-error/15 text-error'
                          : 'bg-warning/15 text-warning'
                      }`}
                    >
                      {PLATFORM_LABELS[cred.platform]} · {age.label}
                    </span>
                  ))}
                </div>
                <button
                  onClick={() => {
                    const first = expiryAlerts[0];
                    if (first) handleStartHarvest(first.cred.platform);
                  }}
                  disabled={actionLoading !== null}
                  className="mt-2 inline-flex items-center gap-1 rounded-md border border-primary/50 bg-card px-3 py-1 text-xs font-medium text-primary/90 hover:bg-primary/10 disabled:opacity-50"
                >
                  <Cookie className="w-3 h-3" />
                  立即重新采集
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Active session banner */}
        {activeSession && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Cookie className="w-5 h-5 text-primary" />
                <div>
                  <div className="text-sm font-medium text-primary">{activeSession.platformName} 采集会话</div>
                  <div className="text-xs text-primary/80">为「{enterpriseName}」采集</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={activeSession.noVncUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  打开浏览器
                </a>
                <button
                  onClick={handleCheckAndSave}
                  disabled={actionLoading !== null}
                  className="rounded-md border border-primary/50 bg-card px-3 py-1.5 text-xs font-medium text-primary/90 hover:bg-primary/10 disabled:opacity-50"
                >
                  {actionLoading === 'save' ? '处理中...' : '检查并保存Cookie'}
                </button>
                <button
                  onClick={handleCloseSession}
                  disabled={actionLoading !== null}
                  className="rounded-md border border-error/50 bg-card px-3 py-1.5 text-xs font-medium text-error hover:bg-error-bg disabled:opacity-50"
                >
                  关闭
                </button>
              </div>
            </div>
            <div className="mt-2 text-xs text-primary/70 border-t border-primary/20 pt-2">
              操作步骤：点击「打开浏览器」进入远程浏览器 → 完成平台登录 → 回到此页面点击「检查并保存Cookie」
            </div>
          </div>
        )}

        {/* Status message */}
        {statusMessage && !activeSession && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary">
            {statusMessage}
          </div>
        )}
        {statusMessage && activeSession && (
          <div className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground">
            {statusMessage}
          </div>
        )}

        {/* Platform list - only cookie status and harvest button */}
        <div className="space-y-2">
          {ALL_PLATFORMS.map((platform) => {
            const cred = brandCredentials.find((c) => c.platform === platform);
            const status = cred?.status ?? 'none';
            const statusConfig = STATUS_CONFIG[status];
            const StatusIcon = statusConfig.icon;
            const isThisLoading = actionLoading === platform;
            const ageInfo = cred ? getCookieAge(cred.lastValidatedAt) : null;
            const rowHighlight = ageInfo?.severity === 'critical'
              ? 'border-error/30'
              : ageInfo?.severity === 'warning'
                ? 'border-warning/30'
                : 'border-border';

            return (
              <div
                key={platform}
                className={`rounded-xl border ${rowHighlight} bg-card shadow-card flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors`}
              >
                {/* Platform icon */}
                <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center text-lg font-bold text-foreground/70">
                  {PLATFORM_ICONS[platform]}
                </div>

                {/* Platform name + age */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground">{PLATFORM_LABELS[platform]}</div>
                  <div className="text-xs text-muted-foreground/70">
                    {cred
                      ? `采集于 ${ageInfo?.label}${ageInfo?.severity === 'critical' ? ' · 可能已失效' : ageInfo?.severity === 'warning' ? ' · 建议更新' : ''}`
                      : '点击右侧按钮采集登录态'}
                  </div>
                </div>

                {/* Age badge (only when credential exists) */}
                {ageInfo && ageInfo.severity !== 'unknown' && (
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                    ageInfo.severity === 'critical' ? 'bg-error/15 text-error' :
                    ageInfo.severity === 'warning' ? 'bg-warning/15 text-warning' :
                    'bg-success/15 text-success'
                  }`}>
                    {ageInfo.severity === 'critical' ? <AlertTriangle className="w-3 h-3" /> :
                     ageInfo.severity === 'warning' ? <Clock className="w-3 h-3" /> :
                     <CheckCircle2 className="w-3 h-3" />}
                    {ageInfo.label}
                  </span>
                )}

                {/* Cookie status badge */}
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${statusConfig.className}`}>
                  <StatusIcon className="w-3 h-3" />
                  {statusConfig.label}
                </span>

                {/* Harvest button */}
                <button
                  onClick={() => handleStartHarvest(platform)}
                  disabled={actionLoading !== null || harvesterHealthy === false}
                  title="启动 noVNC 采集 Cookie"
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground/80 hover:bg-muted/50 disabled:opacity-50"
                >
                  {isThisLoading ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : ageInfo?.severity === 'critical' ? (
                    <RefreshCw className="w-3.5 h-3.5 text-error" />
                  ) : (
                    <Cookie className="w-3.5 h-3.5" />
                  )}
                  {isThisLoading ? '启动中...' : ageInfo?.severity === 'critical' ? '重新采集' : '采集'}
                </button>
              </div>
            );
          })}
        </div>

        {/* Summary footer */}
        <div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3 shadow-card">
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted-foreground">{enterpriseName}</span>
            <span className="inline-flex items-center gap-1 text-foreground/80">
              <CheckCircle2 className="w-3.5 h-3.5 text-success" /> {savedCount} 个已保存
            </span>
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Plus className="w-3.5 h-3.5" /> {ALL_PLATFORMS.length - savedCount} 个未采集
            </span>
            {staleCount > 0 && (
              <span className="inline-flex items-center gap-1 text-error">
                <AlertTriangle className="w-3.5 h-3.5" /> {staleCount} 个可能已失效
              </span>
            )}
            {warningCount > 0 && (
              <span className="inline-flex items-center gap-1 text-warning">
                <Clock className="w-3.5 h-3.5" /> {warningCount} 个建议更新
              </span>
            )}
          </div>
          <span className="text-xs text-muted-foreground/70">Cookie 有效期：{COOKIE_WARN_AGE_DAYS}天建议更新，{COOKIE_MAX_AGE_DAYS}天需重新采集</span>
        </div>
      </div>
    </div>
  );
}
