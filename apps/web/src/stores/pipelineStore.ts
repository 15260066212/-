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
  isPaused: boolean;
  loading: boolean;
  error: string | null;
  currentRunId: string | null;

  // Actions
  startPipeline: (req: PipelineRequest) => Promise<void>;
  fetchStatus: (sessionId: string) => Promise<void>;
  cancelPipeline: (runId: string) => Promise<void>;
  pausePipeline: (runId: string) => Promise<void>;
  resumePipeline: (runId: string) => Promise<void>;
  clearError: () => void;
}

export const usePipelineStore = create<PipelineStore>((set, get) => ({
  status: null,
  isRunning: false,
  isPaused: false,
  loading: false,
  error: null,
  currentRunId: null,

  startPipeline: async (req: PipelineRequest) => {
    set({ isRunning: true, isPaused: false, loading: true, error: null });
    try {
      // Async API: returns immediately with runId
      const data = await request<{ runId: string; status: string }>('/pipeline/start', {
        method: 'POST',
        body: JSON.stringify(req),
      });
      set({ currentRunId: data.runId, loading: false });
      // Immediately fetch status to show initial progress
      await get().fetchStatus(req.sessionId);
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : '启动流水线失败',
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
      // Update isRunning & isPaused based on pipeline run status
      const run = status.run;
      set({
        status,
        isRunning: run?.status === 'running' || run?.status === 'paused',
        isPaused: run?.status === 'paused',
      });
    });
  },

  cancelPipeline: async (runId: string) => {
    try {
      await request<{ runId: string; status: string }>(
        `/pipeline/cancel/${encodeURIComponent(runId)}`,
        { method: 'POST' },
      );
      set({ isRunning: false, isPaused: false, currentRunId: null });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : '取消流水线失败',
      });
    }
  },

  pausePipeline: async (runId: string) => {
    try {
      await request<{ runId: string; status: string }>(
        `/pipeline/pause/${encodeURIComponent(runId)}`,
        { method: 'POST' },
      );
      set({ isPaused: true });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : '暂停流水线失败',
      });
    }
  },

  resumePipeline: async (runId: string) => {
    try {
      await request<{ runId: string; status: string }>(
        `/pipeline/resume/${encodeURIComponent(runId)}`,
        { method: 'POST' },
      );
      set({ isPaused: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : '恢复流水线失败',
      });
    }
  },

  clearError: () => set({ error: null }),
}));
