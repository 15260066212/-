import { ShieldCheck, RefreshCw, Plus } from 'lucide-react';
import type { PlatformId } from '@zemingengine/shared';
import { getPlatformLabel } from '@zemingengine/shared';
import type { ProfileInfo, ProfileHealthInfo } from '../../hooks/useApi.js';

type ProfileStatus = 'active' | 'expired' | 'none' | 'checking';

const STATUS_CONFIG: Record<
  ProfileStatus,
  { label: string; className: string; icon: typeof ShieldCheck }
> = {
  active: { label: '已登录', className: 'bg-success-bg text-success', icon: ShieldCheck },
  expired: { label: '已失效', className: 'bg-error-bg text-error', icon: ShieldCheck },
  checking: { label: '检查中', className: 'bg-muted text-muted-foreground', icon: RefreshCw },
  none: { label: '未采集', className: 'bg-muted text-muted-foreground', icon: Plus },
};

const PLATFORM_ICONS: Record<PlatformId, string> = {
  weixin: '💬', zhihu: '知', baijia: '百', toutiao: '头',
  csdn: 'C', juejin: '掘', bilibili: 'B',
  sohu: '搜', netease: '网', zhidao: '百',
};

interface Props {
  platform: PlatformId;
  profile?: ProfileInfo;
  status: ProfileStatus;
  health?: ProfileHealthInfo;
  isChecking: boolean;
  isRenewing: boolean;
  isThisLoading: boolean;
  actionLoading: string | null;
  harvesterHealthy: boolean | null;
  onCheckHealth: (platform: PlatformId) => void;
  onRenew: (platform: PlatformId) => void;
  onStartHarvest: (platform: PlatformId) => void;
}

/**
 * PlatformCard — 单个平台的 Profile 状态卡片
 * 显示平台图标、登录状态、Profile 信息，以及健康检查、续期、采集等操作按钮
 */
export function PlatformCard({
  platform,
  profile,
  status,
  health,
  isChecking,
  isRenewing,
  isThisLoading,
  actionLoading,
  harvesterHealthy,
  onCheckHealth,
  onRenew,
  onStartHarvest,
}: Props) {
  const statusConfig = STATUS_CONFIG[status];
  const StatusIcon = statusConfig.icon;

  const rowHighlight = status === 'expired'
    ? 'border-error/30'
    : status === 'active'
      ? 'border-success/30'
      : 'border-border';

  return (
    <div
      className={`rounded-xl border ${rowHighlight} bg-card shadow-card flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors`}
    >
      {/* Platform icon */}
      <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center text-lg font-bold text-foreground/70">
        {PLATFORM_ICONS[platform]}
      </div>

      {/* Platform name + profile info */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground">{getPlatformLabel(platform)}</div>
        <div className="text-xs text-muted-foreground/70">
          {profile
            ? `Profile ${profile.sizeMB} MB` + (health?.authCookies !== undefined ? ` · 认证Cookie${health.authCookies ? '完整' : '缺失'}` : '')
            : '点击右侧按钮采集登录态（持久化 Profile）'}
        </div>
      </div>

      {/* Status badge */}
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${statusConfig.className}`}>
        <StatusIcon className={`w-3 h-3 ${isChecking || isRenewing ? 'animate-spin' : ''}`} />
        {statusConfig.label}
      </span>

      {/* Action buttons */}
      <div className="flex items-center gap-1">
        {profile && (
          <>
            <button
              onClick={() => onCheckHealth(platform)}
              disabled={isChecking || isRenewing}
              title="检查登录状态"
              className="inline-flex items-center justify-center rounded-md border border-border bg-card px-2 py-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-50 transition-colors"
            >
              {isChecking ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ShieldCheck className="w-3.5 h-3.5" />
              )}
            </button>
            <button
              onClick={() => onRenew(platform)}
              disabled={isChecking || isRenewing}
              title="续期登录态"
              className="inline-flex items-center justify-center rounded-md border border-border bg-card px-2 py-1.5 text-primary/80 hover:bg-primary/10 disabled:opacity-50 transition-colors"
            >
              {isRenewing ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
            </button>
          </>
        )}
        <button
          onClick={() => onStartHarvest(platform)}
          disabled={actionLoading !== null || harvesterHealthy === false}
          title={profile ? '重新采集登录态' : '启动浏览器采集登录态'}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground/80 hover:bg-muted/50 disabled:opacity-50"
        >
          {isThisLoading ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : profile ? (
            <ShieldCheck className="w-3.5 h-3.5" />
          ) : (
            <Plus className="w-3.5 h-3.5" />
          )}
          {isThisLoading ? '启动中...' : profile ? '重新采集' : '采集'}
        </button>
      </div>
    </div>
  );
}
