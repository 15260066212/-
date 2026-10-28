import { Bell, AlertTriangle, ShieldCheck } from 'lucide-react';
import type { PlatformId } from '@zemingengine/shared';
import { getPlatformLabel } from '@zemingengine/shared';

interface Props {
  expiredPlatforms: PlatformId[];
  actionLoading: string | null;
  onStartHarvest: (platform: PlatformId) => void;
}

/**
 * ExpiredProfilesBanner — Profile 失效提醒横幅
 * 当有平台登录态过期时显示，列出过期平台并提供快速重新采集入口
 */
export function ExpiredProfilesBanner({
  expiredPlatforms,
  actionLoading,
  onStartHarvest,
}: Props) {
  if (expiredPlatforms.length === 0) return null;

  const firstExpired = expiredPlatforms[0];

  return (
    <div className="rounded-xl border border-error/30 bg-error-bg px-4 py-3">
      <div className="flex items-start gap-3">
        <Bell className="w-5 h-5 mt-0.5 text-error" />
        <div className="flex-1">
          <div className="text-sm font-medium text-error">Profile 失效提醒</div>
          <div className="mt-1 text-xs text-foreground/80">
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="w-3 h-3 text-error" />
              <span>
                {expiredPlatforms.length} 个平台 Profile 已失效，登录态丢失，请重新采集或等待自动续期
              </span>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {expiredPlatforms.map((platform) => (
              <span
                key={platform}
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-error/15 text-error"
              >
                {getPlatformLabel(platform)}
              </span>
            ))}
          </div>
          <button
            onClick={() => onStartHarvest(firstExpired)}
            disabled={actionLoading !== null}
            className="mt-2 inline-flex items-center gap-1 rounded-md border border-primary/50 bg-card px-3 py-1 text-xs font-medium text-primary/90 hover:bg-primary/10 disabled:opacity-50"
          >
            <ShieldCheck className="w-3 h-3" />
            立即重新采集
          </button>
        </div>
      </div>
    </div>
  );
}
