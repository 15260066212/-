import { ReactNode } from 'react';
import { TopBar } from './TopBar.js';
import { Sidebar, type NavKey, useMobileSidebar } from './Sidebar.js';
import { BottomBar } from './BottomBar.js';
import type { EnterpriseProfile } from '@zemingengine/shared';

interface MainLayoutProps {
  children: ReactNode;
  activeTab: NavKey;
  onNavigate: (key: NavKey) => void;
  currentStage?: string;
  enterprise?: EnterpriseProfile | null;
  error?: string | null;
  isComplete?: boolean;
  onClearError?: () => void;
  showPreview?: boolean;
  previewPanel?: ReactNode;
}

export function MainLayout({
  children,
  activeTab,
  onNavigate,
  currentStage,
  enterprise,
  error,
  isComplete,
  onClearError,
  showPreview = false,
  previewPanel,
}: MainLayoutProps) {
  const { isOpen: sidebarOpen, setIsOpen: setSidebarOpen } = useMobileSidebar();
  const showStageIndicator = activeTab === 'chat';

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {/* TopBar */}
      <TopBar
        currentStage={currentStage}
        showStageIndicator={showStageIndicator}
        onMenuClick={() => setSidebarOpen(true)}
      />

      {/* 中间区域：Sidebar + 内容 + 预览面板 */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Sidebar */}
        <Sidebar
          activeKey={activeTab}
          onNavigate={onNavigate}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />

        {/* 主内容区 */}
        <div className="flex-1 flex min-w-0 overflow-hidden">
          <main className="flex-1 overflow-auto">
            {children}
          </main>

          {/* 右侧预览面板 - 仅在 showPreview 时显示，大屏以上可见 */}
          {showPreview && previewPanel && (
            <div className="w-80 border-l border-border bg-card hidden lg:block flex-shrink-0 overflow-y-auto">
              {previewPanel}
            </div>
          )}
        </div>
      </div>

      {/* BottomBar */}
      <BottomBar
        enterprise={enterprise}
        currentStage={currentStage}
        error={error}
        isComplete={isComplete}
        onClearError={onClearError}
      />
    </div>
  );
}
