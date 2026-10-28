import { useState } from 'react';
import { Search, Bell, ChevronDown, Menu, LogOut } from 'lucide-react';
import { STAGES, STAGE_DISPLAY_NAMES } from '@zemingengine/shared';
import { useAuthStore } from '../../stores/authStore.js';

interface TopBarProps {
  currentStage?: string;
  showStageIndicator?: boolean;
  onMenuClick?: () => void;
}

export function TopBar({ currentStage, showStageIndicator = false, onMenuClick }: TopBarProps) {
  const { user, logout } = useAuthStore();
  const [showMenu, setShowMenu] = useState(false);

  const stageIndex = currentStage
    ? STAGES.findIndex((stage) => stage === currentStage)
    : -1;

  return (
    <header className="h-14 bg-card border-b border-border flex items-center justify-between px-4 md:px-6 flex-shrink-0">
      {/* 左侧：Logo + 标题 */}
      <div className="flex items-center gap-3 min-w-0">
        {onMenuClick && (
          <button
            onClick={onMenuClick}
            className="md:hidden p-2 -ml-2 rounded-lg hover:bg-muted transition-colors"
            aria-label="打开菜单"
          >
            <Menu className="w-5 h-5 text-muted-foreground" />
          </button>
        )}
        <div className="flex items-center gap-3">
          <div className="hidden sm:block">
            <div className="font-semibold text-foreground text-sm leading-tight">GEO 运营平台</div>
          </div>
        </div>
      </div>

      {/* 中间：搜索框 */}
      <div className="flex-1 max-w-md mx-4 hidden md:block">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted border border-border">
          <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <input
            type="text"
            placeholder="搜索客户、项目、内容..."
            className="bg-transparent border-none outline-none text-sm w-full placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {/* 右侧：阶段指示 + 通知 + 用户 */}
      <div className="flex items-center gap-2 md:gap-3 flex-shrink-0">
        {/* 阶段指示标签 */}
        {showStageIndicator && currentStage && stageIndex >= 0 && (
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted">
            <span className="text-xs text-muted-foreground">
              阶段 {stageIndex + 1}/{STAGES.length}
            </span>
            <span className="text-xs font-medium text-foreground">
              {STAGE_DISPLAY_NAMES[currentStage as keyof typeof STAGE_DISPLAY_NAMES] || currentStage}
            </span>
          </div>
        )}

        {/* 搜索图标 - 移动端 */}
        <button
          className="md:hidden p-2 rounded-lg hover:bg-muted transition-colors"
          aria-label="搜索"
        >
          <Search className="w-5 h-5 text-muted-foreground" />
        </button>

        {/* 通知 */}
        <button
          className="relative p-2 rounded-lg hover:bg-muted transition-colors"
          aria-label="通知"
        >
          <Bell className="w-5 h-5 text-muted-foreground" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-primary" />
        </button>

        {/* 用户头像 + 下拉菜单 */}
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="flex items-center gap-2 pl-2 md:pl-3"
          >
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-bold">
              {user?.displayName?.charAt(0) || 'A'}
            </div>
            <span className="hidden md:inline text-sm text-foreground font-medium">
              {user?.displayName || 'Administrator'}
            </span>
            <ChevronDown className="w-4 h-4 text-muted-foreground hidden md:block" />
          </button>

          {/* 下拉菜单 */}
          {showMenu && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setShowMenu(false)}
              />
              <div className="absolute right-0 top-full mt-2 w-48 rounded-lg border border-border bg-card shadow-lg z-50 py-1">
                <div className="px-3 py-2 border-b border-border">
                  <div className="text-sm font-medium text-foreground">{user?.displayName}</div>
                  <div className="text-xs text-muted-foreground">
                    {user?.role === 'admin' ? '管理员' : '运营人员'}
                  </div>
                </div>
                <button
                  onClick={() => {
                    logout();
                    setShowMenu(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-error hover:bg-error-bg transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  退出登录
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
