import { useEffect, useRef } from 'react';
import type { SessionData } from '@zemingengine/shared';
import { usePipelineStore } from '../stores/pipelineStore.js';
import { PipelineLauncher } from '../components/pipeline/PipelineLauncher.js';
import { PipelineProgress } from '../components/pipeline/PipelineProgress.js';
import { PipelineDashboard } from '../components/pipeline/PipelineDashboard.js';

interface Props {
  sessionId: string;
  sessionData: SessionData | null;
}

const REFRESH_INTERVAL_MS = 3000;

export function PipelinePage({ sessionId, sessionData }: Props) {
  const { status, isRunning, isPaused, currentRunId, fetchStatus, error, clearError, cancelPipeline, pausePipeline, resumePipeline } = usePipelineStore();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetchStatus(sessionId);
  }, [sessionId, fetchStatus]);

  // 暂停/恢复时也要保持状态轮询
  useEffect(() => {
    if (isRunning) {
      timerRef.current = setInterval(() => {
        fetchStatus(sessionId);
      }, REFRESH_INTERVAL_MS);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isRunning, isPaused, sessionId, fetchStatus]);

  const showProgress = isRunning || (status?.run != null);

  const handleClosePipeline = async (runId: string) => {
    await cancelPipeline(runId);
    // Clear local state so the launcher reappears
    setTimeout(() => fetchStatus(sessionId), 500);
  };

  const handlePause = async (runId: string) => {
    await pausePipeline(runId);
  };

  const handleResume = async (runId: string) => {
    await resumePipeline(runId);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 max-w-none space-y-4">
        {/* 错误信息 */}
        {error && (
          <div className="rounded-lg border border-error/30 bg-error-bg px-4 py-3">
            <div className="flex items-start justify-between">
              <div className="text-sm text-error">
                <span className="font-medium">错误：</span>
                {error}
              </div>
              <button
                onClick={clearError}
                className="text-xs text-error underline underline-offset-2"
              >
                关闭
              </button>
            </div>
          </div>
        )}

        {/* 实时进度面板 */}
        {showProgress && (
          <PipelineProgress
            status={status}
            isRunning={isRunning}
            isPaused={isPaused}
            runId={currentRunId}
            sessionId={sessionId}
            onCancel={handleClosePipeline}
            onPause={handlePause}
            onResume={handleResume}
          />
        )}

        {/* 启动器（未运行时显示） */}
        {!isRunning && (
          <PipelineLauncher sessionId={sessionId} sessionData={sessionData} />
        )}

        {/* 仪表盘 */}
        <PipelineDashboard sessionId={sessionId} />
      </div>
    </div>
  );
}
