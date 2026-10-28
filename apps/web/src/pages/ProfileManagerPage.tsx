import { useState, useCallback, useEffect } from 'react';
import {
  RefreshCw,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  HardDrive,
  Clock,
  PlayCircle,
  ShieldCheck,
  Info,
  Cookie,
  Server,
} from 'lucide-react';
import { getPlatformInfoByHarvesterName } from '@zemingengine/shared';
import { api, type ProfileInfo, type ProfileHealthInfo, type ProfileCredentialInfo } from '../hooks/useApi.js';

function getPlatformLabel(platform: string): string {
  return getPlatformInfoByHarvesterName(platform)?.label ?? platform;
}

interface ProfileWithHealth extends ProfileInfo {
  health?: ProfileHealthInfo | null;
  healthLoading?: boolean;
  healthError?: string;
  renewing?: boolean;
  deleting?: boolean;
  credential?: ProfileCredentialInfo | null;
}

export function ProfileManagerPage() {
  const [profiles, setProfiles] = useState<ProfileWithHealth[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<ProfileWithHealth | null>(null);

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listProfiles();
      setProfiles(data.map((p) => ({ ...p, health: null })));
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  /** Update a single profile in the list by platform + accountName. */
  const updateProfile = useCallback(
    (platform: string, accountName: string, updater: (p: ProfileWithHealth) => ProfileWithHealth) => {
      setProfiles((prev) =>
        prev.map((p) =>
          p.platform === platform && p.accountName === accountName ? updater(p) : p,
        ),
      );
    },
    [],
  );

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  const checkHealth = async (platform: string, accountName: string) => {
    updateProfile(platform, accountName, (p) => ({ ...p, healthLoading: true, healthError: undefined }));

    try {
      const health = await api.checkProfileHealth(platform, accountName);
      updateProfile(platform, accountName, (p) => ({ ...p, health, healthLoading: false }));
    } catch (err) {
      updateProfile(platform, accountName, (p) => ({
        ...p,
        healthLoading: false,
        healthError: err instanceof Error ? err.message : '检查失败',
      }));
    }
  };

  const renewProfile = async (platform: string, accountName: string) => {
    updateProfile(platform, accountName, (p) => ({ ...p, renewing: true }));

    try {
      const result = await api.renewProfile(platform, accountName);
      // Update health status after renewal
      updateProfile(platform, accountName, (p) => ({
        ...p,
        renewing: false,
        health: {
          success: result.success,
          platform: result.platform,
          account: result.account,
          loggedIn: result.loggedIn,
          error: result.error,
        },
      }));
    } catch (err) {
      updateProfile(platform, accountName, (p) => ({ ...p, renewing: false, healthError: err instanceof Error ? err.message : '续期失败' }));
    }
  };

  const deleteProfile = async (platform: string, accountName: string) => {
    updateProfile(platform, accountName, (p) => ({ ...p, deleting: true }));

    try {
      await api.deleteProfile(platform, accountName);
      setProfiles((prev) =>
        prev.filter((p) => !(p.platform === platform && p.accountName === accountName)),
      );
    } catch (err) {
      updateProfile(platform, accountName, (p) => ({ ...p, deleting: false }));
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeleteConfirm(null);
    }
  };

  const renewAll = async () => {
    setRefreshingAll(true);
    setError(null);
    try {
      const result = await api.renewAllProfiles();
      // Update each profile's health based on results
      setProfiles((prev) =>
        prev.map((p) => {
          const r = result.results.find(
            (res) => res.platform === p.platform && res.accountName === p.accountName,
          );
          if (r) {
            return {
              ...p,
              health: {
                success: r.success,
                platform: r.platform,
                account: r.accountName,
                loggedIn: r.loggedIn,
                error: r.error,
              },
            };
          }
          return p;
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '批量续期失败');
    } finally {
      setRefreshingAll(false);
    }
  };

  // Group profiles by platform
  const grouped = profiles.reduce<Record<string, ProfileWithHealth[]>>((acc, p) => {
    if (!acc[p.platform]) acc[p.platform] = [];
    acc[p.platform].push(p);
    return acc;
  }, {});

  const totalLoggedIn = profiles.filter((p) => p.health?.loggedIn).length;
  const totalUnknown = profiles.filter((p) => !p.health).length;

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-border bg-card px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">浏览器 Profile 管理</h2>
              <p className="text-xs text-muted-foreground">
                持久化浏览器登录态，Profile 优先模式更稳定
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={renewAll}
              disabled={refreshingAll || profiles.length === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/20 disabled:opacity-50 transition-colors"
            >
              <PlayCircle className={`w-4 h-4 ${refreshingAll ? 'animate-spin' : ''}`} />
              {refreshingAll ? '续期中...' : '一键续期全部'}
            </button>
            <button
              onClick={loadProfiles}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              刷新
            </button>
          </div>
        </div>

        {/* Stats */}
        {profiles.length > 0 && (
          <div className="flex gap-4 mt-4">
            <div className="flex items-center gap-2 text-xs">
              <HardDrive className="w-4 h-4 text-muted-foreground" />
              <span className="text-muted-foreground">总计:</span>
              <span className="font-medium text-foreground">{profiles.length} 个</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <CheckCircle2 className="w-4 h-4 text-success" />
              <span className="text-muted-foreground">已登录:</span>
              <span className="font-medium text-success">{totalLoggedIn}</span>
            </div>
            {totalUnknown > 0 && (
              <div className="flex items-center gap-2 text-xs">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <span className="text-muted-foreground">未检查:</span>
                <span className="font-medium text-foreground">{totalUnknown}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex-shrink-0 mx-6 mt-4 rounded-lg border border-error/30 bg-error-bg px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-error" />
              <span className="text-sm text-error">{error}</span>
            </div>
            <button
              onClick={() => setError(null)}
              className="text-xs text-error underline"
            >
              关闭
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading && profiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <RefreshCw className="w-8 h-8 animate-spin mb-3" />
            <p className="text-sm">加载中...</p>
          </div>
        ) : profiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
              <HardDrive className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-base font-medium text-foreground mb-2">暂无浏览器 Profile</h3>
            <p className="text-sm text-muted-foreground max-w-xs">
              通过 Cookie 采集页面登录账号后，系统会自动保存为持久化 Profile。
              Profile 模式比纯 Cookie 更稳定，支持自动续期。
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(grouped).map(([platform, platformProfiles]) => (
              <div key={platform}>
                <h3 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                  {getPlatformLabel(platform)}
                  <span className="text-xs text-muted-foreground font-normal">
                    ({platformProfiles.length} 个账号)
                  </span>
                </h3>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {platformProfiles.map((profile) => (
                    <ProfileCard
                      key={`${profile.platform}-${profile.accountName}`}
                      profile={profile}
                      onCheckHealth={() => checkHealth(profile.platform, profile.accountName)}
                      onRenew={() => renewProfile(profile.platform, profile.accountName)}
                      onDelete={() => setDeleteConfirm(profile)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete confirm dialog */}
      {deleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => !deleteConfirm.deleting && setDeleteConfirm(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-card border border-border shadow-lg p-5 mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="w-9 h-9 rounded-lg bg-error/10 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-error" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-foreground">确认删除 Profile</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  将删除「{getPlatformLabel(deleteConfirm.platform)} - {deleteConfirm.accountName}」的浏览器 Profile。
                  删除后需要重新登录采集，此操作不可撤销。
                </p>
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteConfirm(null)}
                disabled={deleteConfirm.deleting}
                className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={() => deleteProfile(deleteConfirm.platform, deleteConfirm.accountName)}
                disabled={deleteConfirm.deleting}
                className="rounded-lg bg-error px-3 py-1.5 text-sm font-medium text-white hover:bg-error/90 transition-colors disabled:opacity-50"
              >
                {deleteConfirm.deleting ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileCard({
  profile,
  onCheckHealth,
  onRenew,
  onDelete,
}: {
  profile: ProfileWithHealth;
  onCheckHealth: () => void;
  onRenew: () => void;
  onDelete: () => void;
}) {
  const hasHealth = profile.health !== null && profile.health !== undefined;
  const isLoggedIn = profile.health?.loggedIn;
  const cred = profile.credential;
  const displayName = cred?.accountName || profile.accountName;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return { label: '有效', className: 'bg-success/10 text-success' };
      case 'expired':
        return { label: '已过期', className: 'bg-error/10 text-error' };
      case 'invalid':
        return { label: '无效', className: 'bg-error/10 text-error' };
      default:
        return { label: status, className: 'bg-muted text-muted-foreground' };
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 hover:border-primary/50 transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <h4 className="text-sm font-medium text-foreground truncate" title={displayName}>
            {displayName}
          </h4>
          {cred && cred.accountName !== profile.accountName && (
            <p className="text-xs text-muted-foreground truncate" title={profile.accountName}>
              ID: {profile.accountName}
            </p>
          )}
          <div className="flex items-center gap-1.5 mt-1">
            <HardDrive className="w-3 h-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">{profile.sizeMB} MB</span>
          </div>
        </div>

        {/* Status badge */}
        {profile.healthLoading ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <RefreshCw className="w-3 h-3 animate-spin" />
            检查中
          </span>
        ) : hasHealth ? (
          <span
            className={`inline-flex items-center gap-1 text-xs ${
              isLoggedIn ? 'text-success' : 'text-error'
            }`}
          >
            {isLoggedIn ? (
              <CheckCircle2 className="w-3.5 h-3.5" />
            ) : (
              <XCircle className="w-3.5 h-3.5" />
            )}
            {isLoggedIn ? '已登录' : '未登录'}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="w-3.5 h-3.5" />
            未检查
          </span>
        )}
      </div>

      {/* Credential info */}
      {cred && (
        <div className="mb-3 p-2 rounded-lg bg-muted/30 text-xs space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1 text-muted-foreground">
              <Cookie className="w-3 h-3" />
              Cookie
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-foreground font-medium">{cred.cookieCount} 个</span>
              <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${getStatusBadge(cred.status).className}`}>
                {getStatusBadge(cred.status).label}
              </span>
            </div>
          </div>
          {cred.lastValidatedAt && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">最后验证</span>
              <span className="text-muted-foreground">
                {new Date(cred.lastValidatedAt).toLocaleDateString('zh-CN')}
              </span>
            </div>
          )}
        </div>
      )}

      {!cred && (
        <div className="mb-3 p-2 rounded-lg bg-muted/20 text-xs">
          <div className="flex items-center gap-1 text-muted-foreground">
            <Info className="w-3 h-3" />
            <span>暂无关联 Cookie 凭证</span>
          </div>
        </div>
      )}

      {/* Health details */}
      {hasHealth && profile.health && (
        <div className="mb-3 p-2 rounded-lg bg-muted/50 text-xs space-y-1">
          {profile.health.authCookies !== undefined && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">认证 Cookie</span>
              <span className={profile.health.authCookies ? 'text-success' : 'text-error'}>
                {profile.health.authCookies ? '完整' : '缺失'}
              </span>
            </div>
          )}
          {profile.health.error && (
            <div className="flex items-start gap-1 text-error">
              <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
              <span className="truncate" title={profile.health.error}>
                {profile.health.error}
              </span>
            </div>
          )}
        </div>
      )}

      {profile.healthError && (
        <div className="mb-3 text-xs text-error">
          错误: {profile.healthError}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1">
        <button
          onClick={onCheckHealth}
          disabled={profile.healthLoading}
          className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-border px-2 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
          title="检查登录状态"
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          检查
        </button>
        <button
          onClick={onRenew}
          disabled={profile.renewing}
          className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-primary/10 px-2 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 disabled:opacity-50 transition-colors"
          title="续期登录态"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${profile.renewing ? 'animate-spin' : ''}`} />
          续期
        </button>
        <button
          onClick={onDelete}
          disabled={profile.deleting}
          className="inline-flex items-center justify-center rounded-lg border border-border px-2 py-1.5 text-muted-foreground hover:text-error hover:border-error/50 hover:bg-error/5 disabled:opacity-50 transition-colors"
          title="删除 Profile"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
