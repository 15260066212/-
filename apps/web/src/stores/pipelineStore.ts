import { create } from 'zustand';
import type {
  PipelineRequest,
  PipelineStatus,
} from '@zemingengine/shared';
import { request, withLoading } from '../hooks/useApi.js';

interface PipelineStore {
  // State
  status: PipelineStatus | null;
  isRunning: boolean;
  loading: boolean;
  error: string | null;
  currentRunId: string | null;

  // Actions
  startPipeline: (req: PipelineRequest) => Promise<void>;
  fetchStatus: (sessionId: string) => Promise<void>;
  cancelPipeline: (runId: string) => Promise<void>;
  clearError: () => void;
}

export const usePipelineStore = create<PipelineStore>((set, get) => ({
  status: null,
  isRunning: false,
  loading: false,
  error: null,
  currentRunId: null,

  startPipeline: async (req: PipelineRequest) => {
    set({ isRunning: true, loading: true, error: null });
    try {
      // Async API: returns immediately with runId
      const data = await request<{ runId: string; status: string }>('/pipeline/start', {
        method: 'POST',
        body: JSON.stringify(req),
      });
      set({ currentRunId: data.runId, loading: false });
      // Immediately fetch status to show initial progress
      await get().fetchStatus(req.sessionId);
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : '启动流水线失败',
        isRunning: false,
        loading: false,
      });
    }
  },

  fetchStatus: async (sessionId: string) => {
    await withLoading(set, 'loading', 'error', '获取流水线状态失败', async () => {
      const status = await request<PipelineStatus>(
        `/pipeline/status/${encodeURIComponent(sessionId)}`,
      );
      // Update isRunning based on pipeline run status
      const run = status.run;
      const isRunning = run?.status === 'running';
      set({ status, isRunning });
    });
  },

  cancelPipeline: async (runId: string) => {
    try {
      await request<{ runId: string; status: string }>(
        `/pipeline/cancel/${encodeURIComponent(runId)}`,
        { method: 'POST' },
      );
      set({ isRunning: false, currentRunId: null });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : '取消流水线失败',
      });
    }
  },

  clearError: () => set({ error: null }),
}));
