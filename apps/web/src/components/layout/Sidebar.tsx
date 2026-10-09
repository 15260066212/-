import { useState, useEffect } from 'react';
import {
  MessageCircle,
  FolderOpen,
  Send,
  BarChart3,
  Key,
  X,
  Target,
  Radar,
} from 'lucide-react';

export type NavKey = 'chat' | 'plan' | 'content' | 'pipeline' | 'accounts' | 'monitor' | 'competitor';

interface NavItem {
  key: NavKey;
  label: string;
  icon: typeof MessageCircle;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'chat', label: 'GEO 配置', icon: MessageCircle },
  { key: 'plan', label: '优化方案', icon: Target },
  { key: 'content', label: '内容管理', icon: FolderOpen },
  { key: 'pipeline', label: '流水线', icon: Send },
  { key: 'accounts', label: '账号管理', icon: Key },
  { key: 'competitor', label: '竞品监测', icon: Radar },
  { key: 'monitor', label: '运营监控', icon: BarChart3 },
];

interface SidebarProps {
  activeKey: NavKey;
  onNavigate: (key: NavKey) => void;
  isOpen?: boolean;
  onClose?: () => void;
  enterpriseName?: string;
}

export function Sidebar({ activeKey, onNavigate, isOpen = true, onClose, enterpriseName }: SidebarProps) {
  return (
    <>
      {/* Mobile overlay */}
      {isOpen && onClose && (
        <div
          className="fixed inset-0 bg-foreground/40 backdrop-blur-sm z-40 md:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed md:static inset-y-0 left-0 z-50 md:z-auto
          w-60 flex-shrink-0 bg-card border-r border-border flex flex-col
          transform transition-transform duration-200 ease-in-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}
      >
        {/* Logo area */}
        <div className="h-16 flex items-center justify-between gap-3 px-5 border-b border-border">
          <div className="flex items-center gap-3">
            <img src="/company-logo.png" alt="芯图引擎：GEO" className="h-9 w-auto max-w-[150px] object-contain" />
            <div className="text-xs text-muted-foreground">GEO 运营平台</div>
          </div>
          {/* Mobile close button */}
          {onClose && (
            <button
              onClick={onClose}
              className="md:hidden p-1.5 rounded-lg hover:bg-muted transition-colors"
              aria-label="关闭侧边栏"
            >
              <X className="w-5 h-5 text-muted-foreground" />
            </button>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const isActive = activeKey === item.key;
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                onClick={() => {
                  onNavigate(item.key);
                  if (onClose) onClose();
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Footer - enterprise info */}
        <div className="px-4 py-4 border-t border-border">
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-bold">
              {(enterpriseName ?? '?').charAt(0)}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{enterpriseName ?? '未选择企业'}</p>
              <p className="text-xs text-muted-foreground truncate">企业版</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

export function useMobileSidebar() {
  const [isOpen, setIsOpen] = useState(false);

  // Close sidebar on resize to desktop
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768) {
        setIsOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Prevent body scroll when sidebar is open on mobile
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  return { isOpen, setIsOpen };
}
