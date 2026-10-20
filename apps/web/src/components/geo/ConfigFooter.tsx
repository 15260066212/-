import { ChevronRight } from 'lucide-react';

interface TabProgress {
  label: string;
  completed: number;
  total: number;
}

interface ConfigFooterProps {
  tabProgress: TabProgress[];
  onSaveAndContinue: () => void;
  disabled?: boolean;
}

export function ConfigFooter({ tabProgress, onSaveAndContinue, disabled = false }: ConfigFooterProps) {
  const totalCompleted = tabProgress.reduce((sum, t) => sum + t.completed, 0);
  const totalItems = tabProgress.reduce((sum, t) => sum + t.total, 0);

  return (
    <div className="border-t border-border bg-card px-4 md:px-6 py-3">
      <div className="flex items-center justify-between">
        {/* 进度文字 */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {tabProgress.map((tab, index) => (
            <span key={tab.label}>
              {tab.label}: {tab.completed}/{tab.total}
              {index < tabProgress.length - 1 && ''}
            </span>
          ))}
        </div>

        {/* 保存并继续按钮 */}
        <button
          onClick={onSaveAndContinue}
          disabled={disabled || totalCompleted < totalItems}
          className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
        >
          <span>保存并继续</span>
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
