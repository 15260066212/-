import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface CollapsiblePanelProps {
  title: string;
  badge?: string | number;
  icon?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  action?: ReactNode;
}

export function CollapsiblePanel({
  title,
  badge,
  icon,
  defaultOpen = true,
  children,
  action,
}: CollapsiblePanelProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-border last:border-b-0">
      {/* Header */}
      <button
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-2 min-w-0">
          {icon && <span className="flex-shrink-0">{icon}</span>}
          <span className="text-sm font-medium text-foreground truncate">{title}</span>
          {badge !== undefined && (
            <span className="flex-shrink-0 px-2 py-0.5 rounded-full bg-muted text-xs text-muted-foreground">
              {badge}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {action && <div onClick={(e) => e.stopPropagation()}>{action}</div>}
          {isOpen ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* Content */}
      {isOpen && (
        <div className="px-4 pb-4">
          {children}
        </div>
      )}
    </div>
  );
}
