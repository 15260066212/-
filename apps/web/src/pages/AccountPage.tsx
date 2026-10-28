import { useEffect, useState, useCallback } from 'react';
import { useCredentialStore } from '../stores/credentialStore.js';
import { useSessionStore } from '../stores/sessionStore.js';
import { RefreshCw, Trash2, CheckCircle, XCircle, AlertCircle, Clock, Globe, Cookie, Building2 } from 'lucide-react';
import type { PlatformId, PlatformCredentials } from '@zemingengine/shared';

const API_BASE = '/api/cookie-harvester';

const PLATFORM_LABELS: Record<PlatformId, string> = {
  weixin: '微信公众号',
  zhihu: '知乎',
  baijia: '百家号',
  toutiao: '今日头条',
  csdn: 'CSDN',
  juejin: '掘金',
  sohu: '搜狐号',
  netease: '网易号',
  zhidao: '百度知道',
};

// Harvester 内部 platform key -> 前端 PlatformId 映射
const HARVESTER_PLATFORM_MAP: Record<string, PlatformId> = {
  wechat: 'weixin',
  zhihu: 'zhihu',
  baijiahao: 'baijia',
  toutiaohao: 'toutiao',
  csdn: 'csdn',
  juejin: 'juejin',
  sohuhao: 'sohu',
  wangyihao: 'netease',
  zhidao: 'zhidao',
};

const ALL_PLATFORMS: PlatformId[] = [
  'weixin', 'zhihu', 'baijia', 'toutiao',
  'sohu', 'netease', 'zhidao',
];

const STATUS_CONFIG: Record<
  PlatformCredentials['status'] | 'none',
  { label: string; className: string; icon: typeof CheckCircle }
> = {
  active: { label: '已激活', className: 'bg-success-bg text-success', icon: CheckCircle },
  expired: { label: '已过期', className: 'bg-warning-bg text-warning', icon: AlertCircle },
  invalid: { label: '无效', className: 'bg-error-bg text-error', icon: XCircle },
  none: { label: '未配置', className: 'bg-muted text-muted-foreground', icon: Clock },
};

interface SessionInfo {
  sessionId: string;
  platform: string;
  platformName: string;
  loginUrl: string;
  noVncUrl: string;
  message: string;
}

interface StatusInfo {
  loggedIn: boolean;
  cookieCount: number;
  elapsed: number;
}

interface CookieResult {
  loggedIn: boolean;
  cookieString: string;
  cookieCount: number;
  savedToCredentials?: boolean;
  savedPlatform?: string;
}

export function AccountPage() {
  // === 从 sessionStore 获取当前会话 ===
  const { sessionId, sessionData } = useSessionStore();
  const accountId = sessionId || '';
  const enterpriseName = sessionData?.enterprise?.fullName || sessionData?.enterprise?.shortName || '当前企业';

  // === Cookie 采集状态 ===
  const [harvesterHealthy, setHarvesterHealthy] = useState<boolean | null>(null);
  const [activeSession, setActiveSession] = useState<SessionInfo | null>(null);
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [cookieResult, setCookieResult] = useState<CookieResult | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showVnc, setShowVnc] = useState(false);

  // === Cookie 状态显示 ===
  const { credentials, loading: credLoading, error: credError, fetchCredentials, deleteCredential, clearError } = useCredentialStore();

  const checkHealth = useCallback(async () => {
    try {
      const resp = await fetch(`${API_BASE}/health`);
      const data = await resp.json();
      setHarvesterHealthy(data.success === true);
    } catch {
      setHarvesterHealthy(false);
    }
  }, []);

  useEffect(() => {
    checkHealth();
    fetchCredentials();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, [checkHealth, fetchCredentials]);

  // === Cookie 采集操作 ===
  const handleStart = async (platform: PlatformId) => {
    setError(null);
    setCookieResult(null);
    setStatus(null);
    setLoading('start');
    try {
      const resp = await fetch(`${API_BASE}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, sessionId: accountId }),
      });
      const data = await resp.json();
      if (!data.success) {
        setError(data.error || '启动失败');
        return;
      }
      setActiveSession(data);
      setShowVnc(true);
    } catch {
      setError('无法连接到采集服务，请确认服务已启动');
    } finally {
      setLoading(null);
    }
  };

  const handleCheckStatus = async () => {
    if (!activeSession) return;
    setError(null);
    setLoading('status');
    try {
      const resp = await fetch(`${API_BASE}/status/${activeSession.sessionId}`);
      const data = await resp.json();
      if (!data.success) {
        setError(data.error || '查询失败');
        return;
      }
      setStatus({
        loggedIn: data.loggedIn,
        cookieCount: data.cookieCount,
        elapsed: data.elapsed,
      });
      if (data.loggedIn) {
        await handleExtractCookies();
      }
    } catch {
      setError('无法连接到采集服务');
    } finally {
      setLoading(null);
    }
  };

  const handleExtractCookies = async () => {
    if (!activeSession) return;
    setError(null);
    setLoading('extract');
    try {
      // 优先使用 harvester 内部 platform key 映射，fallback 到中文名查找
      const platform = (HARVESTER_PLATFORM_MAP[activeSession.platform]
        ?? HARVESTER_PLATFORM_MAP[activeSession.platformName]
        ?? Object.entries(PLATFORM_LABELS).find(
          ([, name]) => name === activeSession.platformName,
        )?.[0]) as PlatformId | undefined;
      const url = platform
        ? `${API_BASE}/cookies/${activeSession.sessionId}?platform=${platform}&accountId=${activeSession.sessionId}`
        : `${API_BASE}/cookies/${activeSession.sessionId}`;
      const resp = await fetch(url);
      const data = await resp.json();
      if (!data.success) {
        setError(data.error || '提取失败');
        return;
      }
      setCookieResult(data);
      // 总是刷新凭据列表，使用当前 harvester 会话 ID
      await fetchCredentials();
    } catch {
      setError('无法连接到采集服务');
    } finally {
      setLoading(null);
    }
  };

  const handleClose = async () => {
    if (!activeSession) return;
    const currentSessionId = activeSession.sessionId;
    setError(null);
    setLoading('close');
    try {
      await fetch(`${API_BASE}/close/${currentSessionId}`, { method: 'POST' });
    } catch {
      // Ignore errors on close
    } finally {
      setActiveSession(null);
      setStatus(null);
      setCookieResult(null);
      setShowVnc(false);
      setLoading(null);
      // 关闭会话后重新加载凭据列表，使用当前 harvester 会话 ID
      await fetchCredentials();
    }
  };

  // === Cookie 状态显示操作 ===
  const handleDeleteCred = async (platform: PlatformId) => {
    if (!window.confirm(`确定要删除「${PLATFORM_LABELS[platform]}」的 Cookie 吗？`)) return;
    await deleteCredential(platform, accountId);
  };

  const credentialMap = new Map<PlatformId, PlatformCredentials>(
    credentials.map((c) => [c.platform, c]),
  );

  // 如果没有选择会话，显示提示
  if (!accountId) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <Building2 className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">请先选择企业会话</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="p-4 md:p-6 space-y-6">
        {/* === Cookie 采集区域 === */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Cookie className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-bold text-foreground">Cookie 采集</h2>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  harvesterHealthy === true
                    ? 'bg-success-bg text-success'
                    : harvesterHealthy === false
                    ? 'bg-error-bg text-error'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {harvesterHealthy === true ? '采集服务在线' : harvesterHealthy === false ? '采集服务离线' : '检测中...'}
              </span>
              <button
                onClick={checkHealth}
                className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground/90 hover:bg-muted/50"
              >
                刷新
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-error/30 bg-error-bg px-4 py-3 text-sm text-error mb-4">
              <div className="flex items-center justify-between">
                <span>{error}</span>
                <button onClick={() => setError(null)} className="text-xs underline">关闭</button>
              </div>
            </div>
          )}

          {/* 当前企业会话信息条 */}
          {!activeSession && (
            <div className="flex items-center justify-between rounded-xl border border-primary/30 bg-primary/10 px-4 py-2.5 mb-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-primary">当前企业:</span>
                <span className="text-sm text-foreground">{enterpriseName}</span>
              </div>
            </div>
          )}

          {/* 平台网格 */}
          {!activeSession && (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {ALL_PLATFORMS.map((platform) => (
                <button
                  key={platform}
                  onClick={() => handleStart(platform)}
                  disabled={loading !== null || harvesterHealthy === false}
                  className="flex flex-col items-center gap-1.5 rounded-xl border border-border bg-card p-3 hover:border-primary/50 hover:bg-primary/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-card"
                >
                  <Globe className="w-5 h-5 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground">{PLATFORM_LABELS[platform]}</span>
                </button>
              ))}
            </div>
          )}

          {/* 活跃会话 */}
          {activeSession && (
            <div className="space-y-3">
              <div className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-primary">{activeSession.platformName} - 登录会话</div>
                    <div className="text-xs text-primary mt-0.5">Session: {activeSession.sessionId}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleCheckStatus}
                      disabled={loading !== null}
                      className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                      {loading === 'status' ? '检测中...' : '检查登录'}
                    </button>
                    <button
                      onClick={handleExtractCookies}
                      disabled={loading !== null}
                      className="rounded-md border border-primary/50 bg-card px-3 py-1.5 text-xs font-medium text-primary/90 hover:bg-primary/10 disabled:opacity-50"
                    >
                      {loading === 'extract' ? '提取中...' : '提取Cookie'}
                    </button>
                    <button
                      onClick={handleClose}
                      disabled={loading !== null}
                      className="rounded-md border border-error/50 bg-card px-3 py-1.5 text-xs font-medium text-error hover:bg-error-bg disabled:opacity-50"
                    >
                      {loading === 'close' ? '关闭中...' : '关闭会话'}
                    </button>
                  </div>
                </div>
              </div>

              {/* 状态显示 */}
              {status && (
                <div className="rounded-xl border border-border bg-card px-4 py-2.5 shadow-card">
                  <div className="flex items-center gap-4 text-sm">
                    {status.loggedIn ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2.5 py-0.5 text-xs font-medium text-success">
                        <CheckCircle className="w-3 h-3" />已登录
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-warning-bg px-2.5 py-0.5 text-xs font-medium text-warning">
                        <Clock className="w-3 h-3" />未登录
                      </span>
                    )}
                    <span className="text-muted-foreground">Cookie: {status.cookieCount} 条</span>
                    <span className="text-muted-foreground/70">{Math.floor(status.elapsed / 1000)}秒</span>
                  </div>
                </div>
              )}

              {/* Cookie 结果 */}
              {cookieResult && cookieResult.cookieString && (
                <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-card">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-foreground/90">Cookie 提取结果:</span>
                    {cookieResult.savedToCredentials ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2.5 py-0.5 text-xs font-medium text-success">
                        已保存到凭据
                      </span>
                    ) : cookieResult.loggedIn ? (
                      <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary/90">已提取</span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-error-bg px-2.5 py-0.5 text-xs font-medium text-error">未检测到登录</span>
                    )}
                  </div>
                  <code className="text-xs text-foreground/60 break-all">
                    {cookieResult.cookieString.slice(0, 200)}{cookieResult.cookieString.length > 200 ? '...' : ''}
                  </code>
                </div>
              )}

              {/* noVNC iframe */}
              {showVnc && activeSession && (
                <div className="rounded-xl border border-border overflow-hidden shadow-card">
                  <div className="bg-foreground/90 px-3 py-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-white font-medium">远程浏览器 - {activeSession.platformName}</span>
                      <span className="text-xs text-muted-foreground/60">正在连接...</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          const iframe = document.querySelector('iframe[title="noVNC Remote Browser"]') as HTMLIFrameElement;
                          if (iframe) {
                            if (document.fullscreenElement) {
                              document.exitFullscreen();
                            } else {
                              iframe.requestFullscreen();
                            }
                          }
                        }}
                        className="text-xs text-muted-foreground/70 hover:text-white transition-colors"
                      >
                        全屏
                      </button>
                      <button
                        onClick={() => setShowVnc(false)}
                        className="text-xs text-muted-foreground/70 hover:text-white transition-colors"
                      >
                        收起
                      </button>
                    </div>
                  </div>
                  <iframe
                    src={activeSession.noVncUrl}
                    className="w-full"
                    style={{ height: '780px', minHeight: '600px' }}
                    title="noVNC Remote Browser"
                    allow="fullscreen"
                    frameBorder="0"
                  />
                </div>
              )}

              {!showVnc && (
                <button onClick={() => setShowVnc(true)} className="text-sm text-primary hover:text-primary/90">重新打开远程浏览器</button>
              )}
            </div>
          )}

          {/* 使用说明 */}
          {!activeSession && (
            <div className="rounded-xl border border-border bg-card p-3 mt-3 shadow-card">
              <p className="text-xs text-muted-foreground">
                点击平台卡片启动远程浏览器，在 noVNC 窗口中完成登录后，系统自动提取并保存 Cookie
              </p>
            </div>
          )}
        </div>

        {/* === Cookie 状态显示区域 === */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-bold text-foreground">Cookie 状态 - {enterpriseName}</h2>
            </div>
            <button
              onClick={() => fetchCredentials()}
              disabled={credLoading}
              className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground/90 hover:bg-muted/50 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${credLoading ? 'animate-spin' : ''}`} />
              {credLoading ? '刷新中...' : '刷新'}
            </button>
          </div>

          {credError && (
            <div className="rounded-xl border border-error/30 bg-error-bg px-4 py-3 text-sm text-error mb-4">
              <div className="flex items-center justify-between">
                <span>{credError}</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => fetchCredentials()} className="text-xs underline">重试</button>
                  <button onClick={clearError} className="text-xs underline">关闭</button>
                </div>
              </div>
            </div>
          )}

          {/* 状态表格 */}
          <div className="rounded-xl border border-border bg-card shadow-card overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">平台</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">状态</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Cookie数量</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">最后验证</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">操作</th>
                </tr>
              </thead>
              <tbody>
                {ALL_PLATFORMS.map((platform) => {
                  const cred = credentialMap.get(platform);
                  const statusKey = cred?.status ?? 'none';
                  const statusConfig = STATUS_CONFIG[statusKey];
                  const StatusIcon = statusConfig.icon;
                  return (
                    <tr key={platform} className="border-b border-border last:border-b-0 hover:bg-muted/30">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">{PLATFORM_LABELS[platform]}</span>
                          <span className="text-xs text-muted-foreground/70">{platform}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${statusConfig.className}`}>
                          <StatusIcon className="w-3 h-3" />
                          {statusConfig.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-sm text-muted-foreground">
                          {cred?.data && Object.keys(cred.data).length > 0
                            ? `${Object.keys(cred.data).length} 个字段`
                            : '—'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-xs text-muted-foreground">
                          {cred?.lastValidatedAt
                            ? new Date(cred.lastValidatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
                            : '—'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {cred && (
                          <button
                            onClick={() => handleDeleteCred(platform)}
                            className="text-xs text-error hover:text-error/80"
                            title="删除Cookie"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
