import { STAGES, STAGE_DISPLAY_NAMES } from '@zemingengine/shared';
import type { EnterpriseProfile } from '@zemingengine/shared';

interface BottomBarProps {
  enterprise?: EnterpriseProfile | null;
  currentStage?: string;
  error?: string | null;
  isComplete?: boolean;
  onClearError?: () => void;
}

export function BottomBar({
  enterprise,
  currentStage,
  error,
  isComplete,
  onClearError
}: BottomBarProps) {
  const stageIndex = currentStage
    ? STAGES.findIndex((stage) => stage === currentStage)
    : -1;

  const companyName = enterprise?.fullName || '新途科技';
  const initial = companyName.charAt(0);

  return (
    <footer className="bg-card border-t border-border px-4 md:px-6 py-2.5 flex-shrink-0">
      <div className="flex items-center justify-between gap-4">
        {/* 左侧：企业信息 */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-bold flex-shrink-0">
            {initial}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{companyName}</p>
            <p className="text-xs text-muted-foreground">企业版</p>
          </div>
        </div>

        {/* 右侧：状态指示 */}
        <div className="flex items-center gap-3 flex-shrink-0">
          {error && (
            <button
              onClick={onClearError}
              className="text-xs rounded border border-error/30 bg-error-bg px-2 py-1 text-error truncate max-w-[200px]"
              title={error}
            >
              {error}
            </button>
          )}
          {isComplete && (
            <span className="text-xs text-success font-medium">配置完成</span>
          )}
          {currentStage && stageIndex >= 0 && !isComplete && (
            <span className="text-xs text-muted-foreground">
              阶段 {stageIndex + 1}/{STAGES.length}
              {' · '}
              {STAGE_DISPLAY_NAMES[currentStage as keyof typeof STAGE_DISPLAY_NAMES] || currentStage}
            </span>
          )}
        </div>
      </div>
    </footer>
  );
}
