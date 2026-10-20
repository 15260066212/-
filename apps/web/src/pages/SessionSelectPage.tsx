import { useEffect } from 'react';
import { useSessionStore } from '../stores/sessionStore.js';
import { useAuthStore } from '../stores/authStore.js';
import { Plus, Building2, Clock, ChevronRight, LogOut, RefreshCw } from 'lucide-react';

export function SessionSelectPage() {
  const { sessions, isSessionsLoading, loadSessions, startSession, selectSession } = useSessionStore();
  const { user, logout } = useAuthStore();

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const handleNewSession = async () => {
    await startSession();
  };

  const handleSelectSession = async (id: string) => {
    await selectSession(id);
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* TopBar */}
      <header className="h-14 bg-card border-b border-border flex items-center justify-between px-4 md:px-6 flex-shrink-0">
        <div className="flex items-center gap-3">
          <img src="/company-logo.png" alt="芯图引擎" className="h-8 w-auto max-w-[150px] object-contain" />
          <div className="hidden sm:block">
            <div className="font-semibold text-foreground text-sm">GEO 运营平台</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-bold">
              {user?.displayName?.charAt(0) || 'A'}
            </div>
            <span className="hidden md:inline text-sm text-foreground font-medium">
              {user?.displayName || 'Administrator'}
            </span>
            <span className="hidden md:inline text-xs text-muted-foreground px-2 py-0.5 rounded-full bg-muted">
              {user?.role === 'admin' ? '管理员' : '运营人员'}
            </span>
          </div>
          <button
            onClick={logout}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">退出</span>
          </button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-5xl mx-auto">
          {/* Title */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-xl font-bold text-foreground mb-1">选择会话</h1>
              <p className="text-sm text-muted-foreground">选择已有企业会话或创建新会话进行 GEO 配置</p>
            </div>
            <button
              onClick={() => loadSessions()}
              disabled={isSessionsLoading}
              className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground/90 hover:bg-muted/50 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isSessionsLoading ? 'animate-spin' : ''}`} />
              刷新
            </button>
          </div>

          {/* Session grid */}
          {isSessionsLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="text-sm text-muted-foreground">加载会话列表中...</div>
            </div>
          ) : sessions.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-8 text-center shadow-card">
              <p className="text-sm text-muted-foreground mb-4">暂无会话，点击下方按钮创建新会话</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Existing sessions */}
              {sessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => handleSelectSession(s.id)}
                  className="group flex flex-col gap-3 rounded-xl border border-border bg-card p-4 hover:border-primary/50 hover:bg-primary/5 hover:shadow-card transition-all text-left"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Building2 className="w-5 h-5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-foreground truncate">
                        {s.enterpriseName}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        阶段: {s.stage || '未开始'}
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-muted-foreground/50 group-hover:text-primary group-hover:translate-x-0.5 transition-all flex-shrink-0" />
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground/70">
                    <Clock className="w-3 h-3" />
                    {new Date(s.createdAt).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </button>
              ))}

              {/* New session card */}
              <button
                onClick={handleNewSession}
                className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-card/50 p-4 hover:border-primary/50 hover:bg-primary/5 transition-all min-h-[100px]"
              >
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Plus className="w-5 h-5 text-primary" />
                </div>
                <span className="text-sm font-medium text-primary">配置新会话</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <footer className="py-3 text-center text-xs text-muted-foreground border-t border-border px-4 flex-shrink-0">
        © 2026 新途科技 芯图引擎：GEO · 让品牌在 AI 时代被看见
      </footer>
    </div>
  );
}
