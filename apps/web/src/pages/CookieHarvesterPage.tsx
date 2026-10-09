import { useEffect, useState, useCallback } from 'react';
import type { PlatformId } from '@zemingengine/shared';

const API_BASE = '/api/cookie-harvester';

const PLATFORM_LABELS: Record<PlatformId, string> = {
  weixin: '微信公众号',
  zhihu: '知乎',
  baijia: '百家号',
  toutiao: '今日头条',
  csdn: 'CSDN',
  juejin: '掘金',
  bilibili: '哔哩哔哩',
  sohu: '搜狐号',
  netease: '网易号',
  zhidao: '百度知道',
};

const ALL_PLATFORMS: PlatformId[] = [
  'weixin', 'zhihu', 'baijia', 'toutiao',
  'csdn', 'juejin', 'bilibili',
  'sohu', 'netease', 'zhidao',
];

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

export function CookieHarvesterPage() {
  const [harvesterHealthy, setHarvesterHealthy] = useState<boolean | null>(null);
  const [activeSession, setActiveSession] = useState<SessionInfo | null>(null);
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [cookieResult, setCookieResult] = useState<CookieResult | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showVnc, setShowVnc] = useState(false);

  // Check harvester health on mount
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
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, [checkHealth]);

  // Start a browser session
  const handleStart = async (platform: PlatformId) => {
    setError(null);
    setCookieResult(null);
    setStatus(null);
    setLoading('start');

    try {
      const resp = await fetch(`${API_BASE}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform }),
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

  // Check login status
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
        // Auto-extract cookies when logged in
        await handleExtractCookies();
      }
    } catch {
      setError('无法连接到采集服务');
    } finally {
      setLoading(null);
    }
  };

  // Extract and save cookies
  const handleExtractCookies = async () => {
    if (!activeSession) return;
    setError(null);
    setLoading('extract');

    try {
      // Find the platform from activeSession
      const platformEntry = Object.entries(PLATFORM_LABELS).find(
        ([, name]) => name === activeSession.platformName,
      );
      const platform = platformEntry?.[0] as PlatformId | undefined;

      const url = platform
        ? `${API_BASE}/cookies/${activeSession.sessionId}?platform=${platform}`
        : `${API_BASE}/cookies/${activeSession.sessionId}`;

      const resp = await fetch(url);
      const data = await resp.json();

      if (!data.success) {
        setError(data.error || '提取失败');
        return;
      }

      setCookieResult(data);

      if (!data.loggedIn) {
        setError('尚未检测到登录状态，请先在浏览器中完成登录');
      }
    } catch {
      setError('无法连接到采集服务');
    } finally {
      setLoading(null);
    }
  };

  // Close session
  const handleClose = async () => {
    if (!activeSession) return;
    setError(null);
    setLoading('close');

    try {
      await fetch(`${API_BASE}/close/${activeSession.sessionId}`, { method: 'POST' });
    } catch {
      // Ignore errors on close
    } finally {
      setActiveSession(null);
      setStatus(null);
      setCookieResult(null);
      setShowVnc(false);
      setLoading(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="p-6 max-w-none space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-foreground">Cookie 采集</h2>
            <p className="text-sm text-muted-foreground">
              通过远程浏览器登录各平台，自动提取 Cookie 并保存到凭据管理系统
            </p>
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
              {harvesterHealthy === true
                ? '采集服务在线'
                : harvesterHealthy === false
                  ? '采集服务离线'
                  : '检测中...'}
            </span>
            <button
              onClick={checkHealth}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground/90 hover:bg-muted/50"
            >
              刷新
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-xl border border-error/30 bg-error-bg px-4 py-3 text-sm text-error shadow-card">
            <div className="flex items-center justify-between">
              <span>{error}</span>
              <button onClick={() => setError(null)} className="text-xs underline">
                关闭
              </button>
            </div>
          </div>
        )}

        {/* Platform grid */}
        {!activeSession && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {ALL_PLATFORMS.map((platform) => (
              <button
                key={platform}
                onClick={() => handleStart(platform)}
                disabled={loading !== null || harvesterHealthy === false}
                className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-4 hover:border-primary/50 hover:bg-primary/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-card"
              >
                <div className="text-2xl">
                  {platform === 'weixin' ? '💬' :
                   platform === 'zhihu' ? '知' :
                   platform === 'baijia' ? '百' :
                   platform === 'toutiao' ? '头' :
                   platform === 'csdn' ? 'C' :
                   platform === 'juejin' ? '掘' :
                   platform === 'bilibili' ? 'B' :
                   platform === 'sohu' ? '搜' :
                   platform === 'netease' ? '网' :
                   '百'}
                </div>
                <span className="text-sm font-medium text-foreground">
                  {PLATFORM_LABELS[platform]}
                </span>
                <span className="text-xs text-muted-foreground/70">{platform}</span>
              </button>
            ))}
          </div>
        )}

        {/* Active session */}
        {activeSession && (
          <div className="space-y-4">
            {/* Session info */}
            <div className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 shadow-card">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-primary">
                    {activeSession.platformName} - 登录会话
                  </div>
                  <div className="text-xs text-primary mt-1">
                    Session: {activeSession.sessionId}
                  </div>
                  <div className="text-xs text-primary">
                    登录地址: {activeSession.loginUrl}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCheckStatus}
                    disabled={loading !== null}
                    className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {loading === 'status' ? '检测中...' : '检查登录状态'}
                  </button>
                  <button
                    onClick={handleExtractCookies}
                    disabled={loading !== null}
                    className="rounded-md border border-primary/50 bg-card px-3 py-1.5 text-xs font-medium text-primary/90 hover:bg-primary/10 disabled:opacity-50"
                  >
                    {loading === 'extract' ? '提取中...' : '提取 Cookie'}
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

            {/* Status display */}
            {status && (
              <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-card">
                <div className="flex items-center gap-4 text-sm">
                  <span className="font-medium text-foreground/90">登录状态:</span>
                  {status.loggedIn ? (
                    <span className="inline-flex items-center rounded-full bg-success-bg px-2.5 py-0.5 text-xs font-medium text-success">
                      已登录
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-warning-bg px-2.5 py-0.5 text-xs font-medium text-warning">
                      未登录
                    </span>
                  )}
                  <span className="text-muted-foreground">
                    Cookie 数量: {status.cookieCount}
                  </span>
                  <span className="text-muted-foreground/70">
                    已用时: {Math.floor(status.elapsed / 1000)}秒
                  </span>
                </div>
              </div>
            )}

            {/* Cookie result */}
            {cookieResult && (
              <div className="rounded-xl border border-border bg-card px-4 py-3 space-y-2 shadow-card">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground/90">Cookie 提取结果:</span>
                  {cookieResult.savedToCredentials ? (
                    <span className="inline-flex items-center rounded-full bg-success-bg px-2.5 py-0.5 text-xs font-medium text-success">
                      已保存到凭据管理
                    </span>
                  ) : cookieResult.loggedIn ? (
                    <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary/90">
                      已提取（未保存）
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-error-bg px-2.5 py-0.5 text-xs font-medium text-error">
                      未检测到登录
                    </span>
                  )}
                </div>
                {cookieResult.cookieString && (
                  <div className="rounded-md bg-muted/50 px-3 py-2">
                    <div className="text-xs text-muted-foreground mb-1">Cookie 内容（已截断）:</div>
                    <code className="text-xs text-foreground/70 break-all">
                      {cookieResult.cookieString.slice(0, 200)}
                      {cookieResult.cookieString.length > 200 ? '...' : ''}
                    </code>
                  </div>
                )}
              </div>
            )}

            {/* noVNC iframe */}
            {showVnc && (
              <div className="rounded-xl border border-border overflow-hidden shadow-card">
                <div className="bg-foreground/90 px-3 py-2 flex items-center justify-between">
                  <span className="text-sm text-white font-medium">
                    远程浏览器 - {activeSession.platformName}
                  </span>
                  <button
                    onClick={() => setShowVnc(false)}
                    className="text-xs text-muted-foreground/70 hover:text-white"
                  >
                    收起
                  </button>
                </div>
                <iframe
                  src={activeSession.noVncUrl}
                  className="w-full"
                  style={{ height: '600px' }}
                  title="noVNC Remote Browser"
                />
              </div>
            )}

            {/* Reopen noVNC if closed */}
            {!showVnc && (
              <button
                onClick={() => setShowVnc(true)}
                className="text-sm text-primary hover:text-primary/90"
              >
                重新打开远程浏览器窗口
              </button>
            )}
          </div>
        )}

        {/* Instructions */}
        {!activeSession && (
          <div className="rounded-xl border border-border bg-card p-4 space-y-2 shadow-card">
            <h3 className="text-sm font-semibold text-foreground">使用说明</h3>
            <ol className="list-decimal list-inside space-y-1 text-xs text-foreground/70">
              <li>点击上方平台卡片，启动远程浏览器并打开该平台登录页面</li>
              <li>在嵌入的远程浏览器窗口中完成账号登录（扫码/账号密码/验证码）</li>
              <li>点击「检查登录状态」确认登录成功</li>
              <li>点击「提取 Cookie」自动提取并保存到凭据管理系统</li>
              <li>关闭会话，Cookie 已安全存储，后续自动发布将使用该凭据</li>
            </ol>
            <div className="text-xs text-muted-foreground/70 pt-2 border-t border-border/50">
              注意：每个会话超时时间为 10 分钟，请在此时间内完成登录操作
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
