import { Search, Bell, Menu, LogOut } from 'lucide-react';
import { STAGE_DISPLAY_NAMES, STAGES } from '@zemingengine/shared';
import { useAuthStore } from '../../stores/authStore.js';

interface AppHeaderProps {
  sessionId?: string;
  currentStage?: string;
  isComplete?: boolean;
  onDownloadManual?: (format: 'markdown' | 'html') => void;
  onExportJson?: () => void;
  title?: string;
  onMenuClick?: () => void;
}

export function AppHeader({
  sessionId,
  currentStage,
  isComplete,
  onDownloadManual,
  onExportJson,
  title,
  onMenuClick,
}: AppHeaderProps) {
  const { user, logout } = useAuthStore();
  const stageIndex = currentStage
    ? STAGES.findIndex((stage) => stage === currentStage)
    : -1;

  return (
    <header className="h-16 bg-card border-b border-border flex items-center justify-between px-4 md:px-6 sticky top-0 z-30">
      <div className="flex items-center gap-3 min-w-0">
        {/* Mobile menu button */}
        {onMenuClick && (
          <button
            onClick={onMenuClick}
            className="md:hidden p-2 -ml-2 rounded-lg hover:bg-muted transition-colors"
            aria-label="打开菜单"
          >
            <Menu className="w-5 h-5 text-muted-foreground" />
          </button>
        )}
        {title && (
          <h1 className="text-base md:text-lg font-semibold text-foreground truncate">
            {title}
          </h1>
        )}
      </div>

      <div className="flex items-center gap-2 md:gap-4 flex-shrink-0">
        {/* Search - hidden on mobile */}
        <div className="hidden md:flex items-center gap-2 px-3 py-2 rounded-lg bg-muted border border-border">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="搜索客户、项目、内容..."
            className="bg-transparent border-none outline-none text-sm w-48 placeholder:text-muted-foreground"
          />
        </div>

        {/* Stage progress - hidden on tablet and below */}
        {sessionId && currentStage && stageIndex >= 0 && (
          <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted">
            <span className="text-xs text-muted-foreground">
              阶段 {stageIndex + 1}/{STAGES.length}
            </span>
            <span className="text-xs font-medium text-foreground">
              {STAGE_DISPLAY_NAMES[currentStage as keyof typeof STAGE_DISPLAY_NAMES] || currentStage}
            </span>
          </div>
        )}

        {/* Action buttons - hidden on mobile */}
        {isComplete && onDownloadManual && onExportJson && (
          <div className="hidden xl:flex items-center gap-2">
            <button
              onClick={() => onDownloadManual('markdown')}
              className="rounded-lg bg-success px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition-opacity"
            >
              下载手册 (MD)
            </button>
            <button
              onClick={() => onDownloadManual('html')}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 transition-opacity"
            >
              下载手册 (HTML)
            </button>
            <button
              onClick={onExportJson}
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
            >
              导出 JSON
            </button>
          </div>
        )}

        {/* Search icon button - mobile only */}
        <button
          className="md:hidden p-2 rounded-lg hover:bg-muted transition-colors"
          aria-label="搜索"
        >
          <Search className="w-5 h-5 text-muted-foreground" />
        </button>

        {/* Notifications */}
        <button
          className="relative p-2 rounded-lg hover:bg-muted transition-colors"
          aria-label="通知"
        >
          <Bell className="w-5 h-5 text-muted-foreground" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-primary" />
        </button>

        {/* User */}
        <div className="flex items-center gap-2 pl-2 md:pl-4 border-l border-border">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
            <span className="text-xs font-medium text-primary">
              {user?.displayName?.charAt(0) ?? 'U'}
            </span>
          </div>
          <span className="hidden md:inline text-sm text-muted-foreground">
            {user?.displayName ?? user?.username ?? '用户'}
          </span>
          <button
            onClick={logout}
            className="p-2 rounded-lg hover:bg-muted transition-colors"
            aria-label="退出登录"
            title="退出登录"
          >
            <LogOut className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
      </div>
    </header>
  );
}
