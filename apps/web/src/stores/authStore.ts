import { create } from 'zustand';
import { request, withLoading, ApiError } from '../hooks/useApi.js';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'user';
  apiKey: string;
}

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  error: string | null;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  restoreSession: () => Promise<void>;
}

const STORAGE_KEY = 'geo_auth_user';

export const useAuthStore = create<AuthState>((set) => ({
  user: (() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as AuthUser) : null;
    } catch {
      return null;
    }
  })(),
  isLoading: false,
  error: null,

  login: async (username: string, password: string) => {
    const result = await withLoading(set, 'isLoading', 'error', '登录失败', async () => {
      const user = await request<AuthUser>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
      set({ user });
      return true;
    });
    return result ?? false;
  },

  logout: () => {
    localStorage.removeItem(STORAGE_KEY);
    set({ user: null });
  },

  restoreSession: async () => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return;
    try {
      // request 自动从 localStorage 读取 apiKey 并添加 header
      await request('/auth/verify', { method: 'POST' });
      // 验证成功，保持当前用户状态
    } catch (err) {
      if (err instanceof ApiError) {
        // API 返回业务错误（如 apiKey 无效），清除登录状态
        localStorage.removeItem(STORAGE_KEY);
        set({ user: null });
      }
      // 网络错误则保持已登录状态（允许离线使用）
    }
  },
}));
