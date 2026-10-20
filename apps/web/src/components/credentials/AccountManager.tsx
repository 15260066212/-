import { useEffect, useState, useCallback } from 'react';
import type { PlatformId, SessionData } from '@zemingengine/shared';
import {
  getHarvesterPlatformName,
  getPlatformLabel,
  listRpaPlatforms,
} from '@zemingengine/shared';
import { useCredentialStore } from '../../stores/credentialStore.js';
import { api, type ProfileInfo, type ProfileHealthInfo } from '../../hooks/useApi.js';
import {
  ShieldCheck, RefreshCw, CheckCircle2, XCircle, Plus,
  Building2,
} from 'lucide-react';
import { PlatformCard } from './PlatformCard.js';
import { ActiveSessionBanner } from './ActiveSessionBanner.js';
import { ExpiredProfilesBanner } from './ExpiredProfilesBanner.js';

const ALL_PLATFORMS: PlatformId[] = listRpaPlatforms().map((p) => p.id) as PlatformId[];

type ProfileStatus = 'active' | 'expired' | 'none' | 'checking';

const API_BASE = '/api/cookie-harvester';

export interface SessionInfo {
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

/**
 * AccountManager — 账号管理主组件（Profile 模式）
 *
 * 管理所有平台的持久化浏览器 Profile，支持：
 * - 查看各平台登录状态
 * - 启动浏览器采集登录态
 * - 健康检查 + 一键续期
 * - 失效提醒 + 快速重新采集
 *
 * 子组件拆分：
 * - PlatformCard: 单个平台卡片
 * - ActiveSessionBanner: 活跃会话横幅
 * - ExpiredProfilesBanner: 失效提醒横幅
 */
export function AccountManager({ sessionData }: Props) {
  const { credentials, loading, error, fetchCredentials, clearError } = useCredentialStore();
  const [harvesterHealthy, setHarvesterHealthy] = useState<boolean | null>(null);
  const [activeSession, setActiveSession] = useState<SessionInfo | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [profileHealthMap, setProfileHealthMap] = useState<Record<string, ProfileHealthInfo>>({});
  const [checkingPlatforms, setCheckingPlatforms] = useState<Set<string>>(new Set());
  const [renewingPlatforms, setRenewingPlatforms] = useState<Set<string>>(new Set());

  const enterprise = sessionData?.enterprise;
  const enterpriseName = enterprise?.fullName || '未命名企业';

  // --- Load profiles ---
  const loadProfiles = useCallback(async () => {
    try {
      const data = await api.listProfiles();
      setProfiles(data);
    } catch {
      setProfiles([]);
    }
  }, []);

  useEffect(() => {
    fetchCredentials();
    loadProfiles();
  }, [fetchCredentials, loadProfiles]);

  // --- Health check ---
  const checkHealth = useCallback(async () => {
    try {
      const resp = await fetch(`${API_BASE}/health`);
      const data = await resp.json();
      setHarvesterHealthy(data.success === true);
    } catch { setHarvesterHealthy(false); }
  }, []);

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, [checkHealth]);

  // --- Profile lookup helpers ---
  const getProfileForPlatform = (platform: PlatformId): ProfileInfo | undefined => {
    const harvesterPlatform = getHarvesterPlatformName(platform);
    return profiles.find(
      (p) => p.platform === harvesterPlatform && p.accountName === enterpriseName,
    );
  };

  const getProfileHealth = (platform: PlatformId): ProfileHealthInfo | undefined => {
    return profileHealthMap[`${platform}-${enterpriseName}`];
  };

  const getProfileStatus = (platform: PlatformId): ProfileStatus => {
    const profile = getProfileForPlatform(platform);
    if (!profile) return 'none';
    if (checkingPlatforms.has(platform)) return 'checking';
    const health = getProfileHealth(platform);
    if (health) return health.loggedIn ? 'active' : 'expired';
    return 'active';
  };

  // --- Check profile health ---
  const checkProfileHealth = async (platform: PlatformId) => {
    const profile = getProfileForPlatform(platform);
    if (!profile) return;

    setCheckingPlatforms((prev) => new Set(prev).add(platform));
    try {
      const health = await api.checkProfileHealth(
        getHarvesterPlatformName(platform),
        enterpriseName,
      );
      const key = `${platform}-${enterpriseName}`;
      setProfileHealthMap((prev) => ({ ...prev, [key]: health }));
    } catch {
      // ignore
    } finally {
      setCheckingPlatforms((prev) => {
        const next = new Set(prev);
        next.delete(platform);
        return next;
      });
    }
  };

  // --- Renew profile ---
  const renewProfile = async (platform: PlatformId) => {
    const profile = getProfileForPlatform(platform);
    if (!profile) return;

    setRenewingPlatforms((prev) => new Set(prev).add(platform));
    try {
      const result = await api.renewProfile(
        getHarvesterPlatformName(platform),
        enterpriseName,
      );
      const key = `${platform}-${enterpriseName}`;
      setProfileHealthMap((prev) => ({
        ...prev,
        [key]: {
          success: result.success,
          platform: result.platform,
          account: result.account,
          loggedIn: result.loggedIn,
          error: result.error,
        },
      }));
    } catch {
      // ignore
    } finally {
      setRenewingPlatforms((prev) => {
        const next = new Set(prev);
        next.delete(platform);
        return next;
      });
    }
  };

  // --- Start harvest session ---
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

  // --- Check and save (profile mode) ---
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

      setStatusMessage('检测到登录，正在保存 Profile 和 Cookie...');
      const platform = activeSession.internalPlatform;
      const params = new URLSearchParams();
      if (platform) params.set('platform', platform);
      if (activeSession.brandName) params.set('accountName', activeSession.brandName);
      const url = `${API_BASE}/cookies/${activeSession.sessionId}?${params.toString()}`;
      const resp = await fetch(url);
      const data = await resp.json();
      if (!data.success) { setLocalError(data.error || '保存失败'); setActionLoading(null); return; }

      if (data.savedToCredentials) {
        const profileSaved = data.profileSaved;
        const msg = profileSaved
          ? `✅ ${activeSession.platformName} 登录态已保存（Profile + Cookie）`
          : `✅ ${activeSession.platformName} Cookie 已保存`;
        setStatusMessage(msg);
        fetchCredentials();
        loadProfiles();
      } else if (data.loggedIn) {
        setStatusMessage('检测到登录但未保存，请重试');
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

  // --- Stats ---
  const savedCount = ALL_PLATFORMS.filter((p) => getProfileForPlatform(p)).length;
  const activeCount = ALL_PLATFORMS.filter((p) => getProfileStatus(p) === 'active').length;
  const expiredCount = ALL_PLATFORMS.filter((p) => getProfileStatus(p) === 'expired').length;
  const expiredPlatforms = ALL_PLATFORMS.filter((p) => getProfileStatus(p) === 'expired');

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="p-4 md:p-6 max-w-none space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-foreground">账号管理</h2>
            <p className="text-sm text-muted-foreground">
              持久化浏览器 Profile 登录，比纯 Cookie 更稳定、支持自动续期
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
              onClick={() => { fetchCredentials(); loadProfiles(); checkHealth(); }}
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
                <button onClick={() => { fetchCredentials(); loadProfiles(); setLocalError(null); }} className="text-xs underline">重试</button>
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

        {/* Expired profiles banner */}
        <ExpiredProfilesBanner
          expiredPlatforms={expiredPlatforms}
          actionLoading={actionLoading}
          onStartHarvest={handleStartHarvest}
        />

        {/* Active session banner */}
        {activeSession && (
          <ActiveSessionBanner
            activeSession={activeSession}
            enterpriseName={enterpriseName}
            actionLoading={actionLoading}
            onCheckAndSave={handleCheckAndSave}
            onCloseSession={handleCloseSession}
          />
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

        {/* Platform list - Profile mode */}
        <div className="space-y-2">
          {ALL_PLATFORMS.map((platform) => (
            <PlatformCard
              key={platform}
              platform={platform}
              profile={getProfileForPlatform(platform)}
              status={getProfileStatus(platform)}
              health={getProfileHealth(platform)}
              isChecking={checkingPlatforms.has(platform)}
              isRenewing={renewingPlatforms.has(platform)}
              isThisLoading={actionLoading === platform}
              actionLoading={actionLoading}
              harvesterHealthy={harvesterHealthy}
              onCheckHealth={checkProfileHealth}
              onRenew={renewProfile}
              onStartHarvest={handleStartHarvest}
            />
          ))}
        </div>

        {/* Summary footer */}
        <div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3 shadow-card">
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted-foreground">{enterpriseName}</span>
            <span className="inline-flex items-center gap-1 text-foreground/80">
              <ShieldCheck className="w-3.5 h-3.5 text-success" /> {savedCount} 个已采集
            </span>
            <span className="inline-flex items-center gap-1 text-success">
              <CheckCircle2 className="w-3.5 h-3.5" /> {activeCount} 个登录有效
            </span>
            {expiredCount > 0 && (
              <span className="inline-flex items-center gap-1 text-error">
                <XCircle className="w-3.5 h-3.5" /> {expiredCount} 个已失效
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Plus className="w-3.5 h-3.5" /> {ALL_PLATFORMS.length - savedCount} 个未采集
            </span>
          </div>
          <span className="text-xs text-muted-foreground/70">Profile 模式支持自动续期，比 Cookie 更持久稳定</span>
        </div>
      </div>
    </div>
  );
}
