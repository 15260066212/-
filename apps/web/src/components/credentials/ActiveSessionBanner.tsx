import { ShieldCheck, RefreshCw, ExternalLink } from 'lucide-react';
import type { SessionInfo } from './AccountManager.js';

interface Props {
  activeSession: SessionInfo;
  enterpriseName: string;
  actionLoading: string | null;
  onCheckAndSave: () => void;
  onCloseSession: () => void;
}

/**
 * ActiveSessionBanner — 活跃采集会话横幅
 * 显示当前正在进行的浏览器采集会话，提供打开浏览器、检查保存、关闭等操作
 */
export function ActiveSessionBanner({
  activeSession,
  enterpriseName,
  actionLoading,
  onCheckAndSave,
  onCloseSession,
}: Props) {
  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-5 h-5 text-primary" />
          <div>
            <div className="text-sm font-medium text-primary">
              {activeSession.platformName} 采集会话
            </div>
            <div className="text-xs text-primary/80">
              为「{enterpriseName}」采集持久化 Profile
            </div>
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
            onClick={onCheckAndSave}
            disabled={actionLoading !== null}
            className="rounded-md border border-primary/50 bg-card px-3 py-1.5 text-xs font-medium text-primary/90 hover:bg-primary/10 disabled:opacity-50"
          >
            {actionLoading === 'save' ? '处理中...' : '检查并保存'}
          </button>
          <button
            onClick={onCloseSession}
            disabled={actionLoading !== null}
            className="rounded-md border border-error/50 bg-card px-3 py-1.5 text-xs font-medium text-error hover:bg-error-bg disabled:opacity-50"
          >
            关闭
          </button>
        </div>
      </div>
      <div className="mt-2 text-xs text-primary/70 border-t border-primary/20 pt-2">
        操作步骤：点击「打开浏览器」进入远程浏览器 → 完成平台登录 → 回到此页面点击「检查并保存」（自动保存为持久化 Profile）
      </div>
    </div>
  );
}
