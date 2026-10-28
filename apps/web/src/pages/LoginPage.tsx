import { useState } from 'react';
import { useAuthStore } from '../stores/authStore.js';
import { Lock, User, Eye, EyeOff } from 'lucide-react';

export function LoginPage() {
  const { login, isLoading, error } = useAuthStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await login(username, password);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/30 p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <img
            src="/company-logo.png"
            alt="芯图引擎"
            className="h-12 w-auto mb-3"
          />
          <h1 className="text-xl font-bold text-foreground">GEO 运营平台</h1>
          <p className="text-sm text-muted-foreground mt-1">让品牌在 AI 时代被看见</p>
        </div>

        {/* Login Form */}
        <form
          onSubmit={handleSubmit}
          className="bg-card rounded-2xl border border-border shadow-lg p-6 space-y-4"
        >
          <h2 className="text-lg font-semibold text-foreground text-center">登录</h2>

          {/* Error */}
          {error && (
            <div className="rounded-lg border border-error/30 bg-error-bg px-3 py-2 text-sm text-error text-center">
              {error}
            </div>
          )}

          {/* Username */}
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-foreground mb-1.5">
              <User className="w-4 h-4 text-muted-foreground" />
              用户名
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="请输入用户名"
              required
              className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>

          {/* Password */}
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-foreground mb-1.5">
              <Lock className="w-4 h-4 text-muted-foreground" />
              密码
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码"
                required
                className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? '登录中...' : '登录'}
          </button>

          {/* Hint */}
          <div className="text-xs text-muted-foreground text-center space-y-0.5">
            <p>管理员: admin / admin123</p>
            <p>运营人员: operator / operator123</p>
          </div>
        </form>

        {/* Footer */}
        <p className="text-xs text-muted-foreground/50 text-center mt-6">
          © 2026 芯图引擎 GEO 运营平台
        </p>
      </div>
    </div>
  );
}
