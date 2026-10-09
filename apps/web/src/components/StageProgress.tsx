import { STAGES, STAGE_DISPLAY_NAMES, type Stage } from '@zemingengine/shared';
import { Check } from 'lucide-react';

interface Props {
  currentStage: Stage;
  onStageClick?: (stage: Stage) => void;
}

export function StageProgress({ currentStage, onStageClick }: Props) {
  const currentIndex = STAGES.findIndex((stage) => stage === currentStage);

  return (
    <div className="flex items-center gap-1 px-2">
      {STAGES.map((stage, i) => {
        const isActive = stage === currentStage;
        const isDone = i < currentIndex;
        const isClickable = isDone && onStageClick;

        return (
          <button
            key={stage}
            onClick={() => isClickable && onStageClick(stage)}
            disabled={!isClickable}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              isActive
                ? 'bg-primary/10 text-primary'
                : isDone
                ? 'bg-success-bg text-success hover:bg-success-bg/80'
                : 'bg-muted text-muted-foreground'
            } ${isClickable ? 'cursor-pointer' : 'cursor-default'}`}
          >
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : isDone
                  ? 'bg-success text-white'
                  : 'bg-muted-foreground/30 text-muted-foreground'
              }`}
            >
              {isDone ? <Check className="w-3 h-3" /> : i + 1}
            </span>
            <span className="hidden sm:inline">{STAGE_DISPLAY_NAMES[stage]}</span>
          </button>
        );
      })}
    </div>
  );
}
