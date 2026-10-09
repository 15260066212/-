import { useState, useEffect } from 'react';
import { useSessionStore } from './stores/sessionStore.js';
import { useAuthStore } from './stores/authStore.js';
import { LoginPage } from './components/LoginPage.js';
import { GEOConfigForm } from './components/GEOConfigForm.js';
import { ConfigPreview } from './components/ConfigPreview.js';
import { OptimizationPlanPage } from './pages/OptimizationPlanPage.js';
import { ContentPage } from './pages/ContentPage.js';
import { PipelinePage } from './pages/PipelinePage.js';
import { MonitorPage } from './pages/MonitorPage.js';
import { CompetitorMonitorPage } from './pages/CompetitorMonitorPage.js';
import { AccountManager } from './components/credentials/AccountManager.js';
import { Sidebar, type NavKey, useMobileSidebar } from './components/layout/Sidebar.js';
import { AppHeader } from './components/layout/AppHeader.js';
import { STAGES, STAGE_DISPLAY_NAMES } from '@zemingengine/shared';
import { api, type SessionListItem } from './hooks/useApi.js';
import { Sparkles, ArrowRight, LayoutDashboard, Building2, Plus, Edit3, Clock, Trash2, AlertTriangle, X } from 'lucide-react';

const TAB_LABELS: Record<NavKey, string> = {
  chat: 'GEO 配置',
  plan: '优化方案',
  content: '内容管理',
  pipeline: '流水线',
  accounts: '账号管理',
  competitor: '竞品监测',
  monitor: '运营监控',
};

export function App() {
  const {
    sessionId,
    sessionData,
    isComplete,
    isLoading,
    error,
    startSession,
    loadExistingSession,
    clearError,
    downloadManual,
  } = useSessionStore();
  const { user } = useAuthStore();

  const [activeTab, setActiveTab] = useState<NavKey>('chat');
  const { isOpen: sidebarOpen, setIsOpen: setSidebarOpen } = useMobileSidebar();
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<SessionListItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const currentStage = sessionData?.currentStage ?? 'intro';

  // Load existing company sessions when not in a session
  useEffect(() => {
    if (!sessionId && user) {
      api.listSessions().then((data) => setSessions(data)).catch(() => {});
    }
  }, [sessionId, user]);

  const handleDeleteSession = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteSession(deleteTarget.id);
      setSessions((prev) => prev.filter((s) => s.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : '删除会话失败');
    } finally {
      setIsDeleting(false);
    }
  };

  // Show login page if not authenticated
  if (!user) {
    return <LoginPage />;
  }

  const handleExportJson = () => {
    if (!sessionData) return;
    const json = JSON.stringify(sessionData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `芯图引擎GEO_${sessionData.enterprise.fullName || '配置'}_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // No session: show company selection view within GEO 配置 tab
  if (!sessionId) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        {/* Simple header */}
        <header className="h-14 md:h-16 bg-card border-b border-border flex items-center px-4 md:px-6">
          <div className="flex items-center gap-3">
            <img src="/company-logo.png" alt="芯图引擎：GEO" className="h-8 md:h-9 w-auto max-w-[200px] object-contain" />
            <div className="text-xs text-muted-foreground hidden sm:block">GEO 运营平台</div>
          </div>
        </header>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="max-w-4xl mx-auto">
            {/* Title bar */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-primary" />
                <h2 className="text-lg font-semibold text-foreground">GEO 配置 — 企业项目</h2>
              </div>
              <button
                onClick={startSession}
                disabled={isLoading}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                <Plus className="w-4 h-4" />
                {isLoading ? '正在创建...' : '新建企业项目'}
              </button>
            </div>

            {/* Error */}
            {error && (
              <div className="rounded-xl border border-error/30 bg-error-bg px-4 py-3 mb-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-error">{error}</span>
                  <button onClick={clearError} className="text-xs text-error underline">关闭</button>
                </div>
              </div>
            )}

            {/* Existing company projects */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {/* New company card */}
              <button
                onClick={startSession}
                disabled={isLoading}
                className="group flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-card/50 p-6 hover:border-primary hover:bg-primary/5 transition-colors disabled:opacity-50 min-h-[120px]"
              >
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Plus className="w-5 h-5 text-primary" />
                </div>
                <span className="text-sm font-medium text-foreground">新建企业项目</span>
                <span className="text-xs text-muted-foreground">添加新的公司配置</span>
              </button>

              {/* Existing sessions */}
              {sessions.map((s) => (
                <div
                  key={s.id}
                  onClick={() => !isLoading && loadExistingSession(s.id)}
                  className={`group relative flex items-center gap-3 rounded-xl border border-border bg-card p-4 hover:border-primary hover:bg-primary/5 transition-colors ${isLoading ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}
                >
                  <div className="w-11 h-11 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <span className="text-base font-bold text-primary">
                      {(s.enterpriseName ?? '?').charAt(0)}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">
                      {s.enterpriseName ?? '未命名企业'}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Clock className="w-3 h-3 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">
                        {new Date(s.updatedAt).toLocaleDateString('zh-CN')}
                      </span>
                    </div>
                  </div>
                  <Edit3 className="w-4 h-4 text-muted-foreground group-hover:text-primary flex-shrink-0" />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTarget(s);
                      setDeleteError(null);
                    }}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-error hover:bg-error/10 transition-colors flex-shrink-0"
                    title="删除会话"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            {sessions.length === 0 && !isLoading && (
              <div className="text-center py-12">
                <p className="text-sm text-muted-foreground">暂无企业项目，点击上方「新建企业项目」开始配置</p>
              </div>
            )}

            {/* Delete confirmation dialog */}
            {deleteTarget && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
                onClick={() => !isDeleting && setDeleteTarget(null)}
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
                      <h3 className="text-sm font-semibold text-foreground">确认删除会话</h3>
                      <p className="text-xs text-muted-foreground mt-1">
                        将永久删除「{deleteTarget.enterpriseName ?? '未命名企业'}」的会话及其所有配置数据，此操作不可撤销。
                      </p>
                    </div>
                    <button
                      onClick={() => !isDeleting && setDeleteTarget(null)}
                      className="p-1 rounded text-muted-foreground hover:text-foreground"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {deleteError && (
                    <div className="rounded-lg border border-error/30 bg-error-bg px-3 py-2 mb-3">
                      <span className="text-xs text-error">{deleteError}</span>
                    </div>
                  )}

                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => setDeleteTarget(null)}
                      disabled={isDeleting}
                      className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                    >
                      取消
                    </button>
                    <button
                      onClick={handleDeleteSession}
                      disabled={isDeleting}
                      className="rounded-lg bg-error px-3 py-1.5 text-sm font-medium text-white hover:bg-error/90 transition-colors disabled:opacity-50"
                    >
                      {isDeleting ? '删除中...' : '确认删除'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    );
  }

  // Main app layout (with session)
  return (
    <div className="h-screen flex flex-col bg-background">
      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <Sidebar
          activeKey={activeTab}
          onNavigate={setActiveTab}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          enterpriseName={sessionData?.enterprise?.fullName}
        />

        {/* Main content area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <AppHeader
            sessionId={sessionId}
            currentStage={currentStage}
            isComplete={isComplete}
            onDownloadManual={downloadManual}
            onExportJson={handleExportJson}
            title={TAB_LABELS[activeTab]}
            onMenuClick={() => setSidebarOpen(true)}
          />

          {/* Content */}
          <main className="flex-1 overflow-hidden">
            {activeTab === 'chat' ? (
              <div className="h-full flex">
                {/* Config form */}
                <div className="flex-1 flex flex-col min-w-0">
                  <GEOConfigForm sessionData={sessionData} />
                </div>
                {/* Config preview sidebar - hidden on tablet and below */}
                <div className="w-80 border-l border-border bg-card hidden lg:block flex-shrink-0">
                  <ConfigPreview sessionData={sessionData} onExportJson={handleExportJson} />
                </div>
              </div>
            ) : activeTab === 'plan' ? (
              <OptimizationPlanPage
                sessionId={sessionId}
                sessionData={sessionData}
                onNavigate={(tab) => setActiveTab(tab as NavKey)}
              />
            ) : activeTab === 'content' ? (
              <ContentPage sessionId={sessionId} />
            ) : activeTab === 'pipeline' ? (
              <PipelinePage sessionId={sessionId} sessionData={sessionData} />
            ) : activeTab === 'accounts' ? (
              <AccountManager sessionData={sessionData} />
            ) : activeTab === 'competitor' ? (
              <CompetitorMonitorPage sessionData={sessionData} />
            ) : (
              <MonitorPage />
            )}
          </main>

          {/* Footer status bar - hidden on mobile */}
          <footer className="bg-card border-t border-border px-4 md:px-6 py-2 hidden sm:block">
            <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
              <span className="truncate">
                阶段 {STAGES.findIndex((stage) => stage === currentStage) + 1}/
                {STAGES.length}
                {' · '}
                {STAGE_DISPLAY_NAMES[currentStage as keyof typeof STAGE_DISPLAY_NAMES]}
              </span>
              {error && (
                <button
                  onClick={clearError}
                  className="truncate rounded border border-error/30 bg-error-bg px-2 py-1 text-error flex-shrink-0"
                  title={error}
                >
                  {error}
                </button>
              )}
              {isComplete && (
                <span className="text-success font-medium truncate">配置完成！点击上方按钮下载手册</span>
              )}
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
