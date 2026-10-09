import { create } from 'zustand';
import type { SessionData, DialogueMessage, ProfileReviewRequest } from '@zemingengine/shared';
import { api, withLoading } from '../hooks/useApi.js';

interface SessionStore {
  // State
  sessionId: string | null;
  sessionData: SessionData | null;
  messages: DialogueMessage[];
  isLoading: boolean;
  error: string | null;
  isComplete: boolean;
  showProfileReview: boolean;

  // Actions
  startSession: () => Promise<void>;
  loadExistingSession: (sessionId: string) => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  submitUrl: (url: string) => Promise<void>;
  importPpt: (file: File) => Promise<void>;
  confirmProfileReview: (payload: ProfileReviewRequest) => Promise<void>;
  goBack: () => Promise<void>;
  clearError: () => void;
  downloadManual: (format?: 'markdown' | 'html') => void;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessionId: null,
  sessionData: null,
  messages: [],
  isLoading: false,
  error: null,
  isComplete: false,
  showProfileReview: false,

  startSession: async () => {
    await withLoading(set, 'isLoading', 'error', 'Failed to create session', async () => {
      const result = await api.createSession();
      set({
        sessionId: result.sessionId,
        sessionData: result.sessionData as SessionData,
        messages: [result.introMessage as DialogueMessage],
        showProfileReview: false,
      });
    });
  },

  loadExistingSession: async (existingSessionId: string) => {
    await withLoading(set, 'isLoading', 'error', 'Failed to load session', async () => {
      const result = await api.loadSession(existingSessionId);
      set({
        sessionId: existingSessionId,
        sessionData: result.sessionData as SessionData,
        messages: [],
        showProfileReview: false,
      });
    });
  },

  sendMessage: async (text: string) => {
    const { sessionId, messages } = get();
    if (!sessionId) return;

    await withLoading(set, 'isLoading', 'error', 'Failed to send message', async () => {
      const result = await api.sendMessage(sessionId, text);
      const newMessages = result.messages as DialogueMessage[];
      set({
        messages: [...messages, ...newMessages],
        sessionData: result.sessionData as SessionData,
        isComplete: result.isComplete,
        showProfileReview: false,
      });
    });
  },

  submitUrl: async (url: string) => {
    const { sessionId, messages } = get();
    if (!sessionId) return;

    await withLoading(set, 'isLoading', 'error', 'Failed to scrape URL', async () => {
      // First add the user's URL message
      const userMessage: DialogueMessage = {
        id: `msg_${Date.now()}_user`,
        role: 'user',
        content: url,
        stage: 'intro',
        timestamp: new Date().toISOString(),
      };

      // Then scrape and analyze
      const result = await api.scrapeUrl(sessionId, url);
      const analysisMessage = result.analysisMessage as DialogueMessage;

      // Update messages with scrape results
      set({
        messages: [...messages, userMessage, analysisMessage],
        sessionData: result.sessionData as SessionData,
        showProfileReview: true,
      });
    });
  },

  importPpt: async (file: File) => {
    const { sessionId } = get();
    if (!sessionId) return;

    await withLoading(set, 'isLoading', 'error', 'PPT 导入失败', async () => {
      const result = await api.importPpt(sessionId, file);
      set({
        sessionData: result.sessionData as SessionData,
      });
    });
  },

  confirmProfileReview: async (payload: ProfileReviewRequest) => {
    const { sessionId, messages } = get();
    if (!sessionId) return;

    await withLoading(set, 'isLoading', 'error', 'Failed to confirm profile', async () => {
      const result = await api.confirmProfileReview(sessionId, payload);
      set({
        messages: [...messages, ...result.messages],
        sessionData: result.sessionData,
        isComplete: result.isComplete,
        showProfileReview: false,
      });
    });
  },

  goBack: async () => {
    const { sessionId, messages } = get();
    if (!sessionId) return;

    await withLoading(set, 'isLoading', 'error', 'Failed to go back', async () => {
      const result = await api.goBack(sessionId);
      set({
        messages: [...messages, result.message as DialogueMessage],
        sessionData: result.sessionData as SessionData,
        showProfileReview: false,
      });
    });
  },

  clearError: () => set({ error: null }),

  downloadManual: (format: 'markdown' | 'html' = 'markdown') => {
    const { sessionId } = get();
    if (!sessionId) return;
    const url = api.getManualDownloadUrl(sessionId, format);
    window.open(url, '_blank');
  },
}));
