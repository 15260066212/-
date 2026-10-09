import { create } from 'zustand';
import type { PlatformCredentials, PlatformId } from '@zemingengine/shared';
import { api, withLoading } from '../hooks/useApi.js';

interface CredentialStore {
  // State
  credentials: PlatformCredentials[];
  loading: boolean;
  error: string | null;

  // Actions
  fetchCredentials: () => Promise<void>;
  saveCredential: (platform: PlatformId, credential: PlatformCredentials) => Promise<void>;
  deleteCredential: (platform: PlatformId) => Promise<void>;
  validateCredential: (platform: PlatformId) => Promise<void>;
  clearError: () => void;
}

export const useCredentialStore = create<CredentialStore>((set, get) => ({
  credentials: [],
  loading: false,
  error: null,

  fetchCredentials: async () => {
    await withLoading(set, 'loading', 'error', '获取凭据列表失败', async () => {
      const credentials = await api.fetchCredentials();
      set({ credentials });
    });
  },

  saveCredential: async (platform, credential) => {
    return withLoading(set, 'loading', 'error', '保存凭据失败', async () => {
      const saved = await api.saveCredential(platform, credential);
      // 更新或追加到列表
      const { credentials } = get();
      const exists = credentials.some((c) => c.platform === platform);
      set({
        credentials: exists
          ? credentials.map((c) => (c.platform === platform ? saved : c))
          : [...credentials, saved],
      });
    }, true) as Promise<void>;
  },

  deleteCredential: async (platform) => {
    return withLoading(set, 'loading', 'error', '删除凭据失败', async () => {
      await api.deleteCredential(platform);
      const { credentials } = get();
      set({
        credentials: credentials.filter((c) => c.platform !== platform),
      });
    }, true) as Promise<void>;
  },

  validateCredential: async (platform) => {
    return withLoading(set, 'loading', 'error', '验证凭据失败', async () => {
      const result = await api.validateCredential(platform);
      const { credentials } = get();
      set({
        credentials: credentials.map((c) =>
          c.platform === platform
            ? { ...c, status: result.status, lastValidatedAt: result.lastValidatedAt }
            : c,
        ),
      });
    }, true) as Promise<void>;
  },

  clearError: () => set({ error: null }),
}));
