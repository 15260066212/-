import { useEffect, useState } from 'react';
import type { PlatformCredentials, PlatformId } from '@zemingengine/shared';
import { useCredentialStore } from '../../stores/credentialStore.js';

const PLATFORM_LABELS: Record<string, string> = {
  weixin: '微信公众号',
  zhihu: '知乎',
  baijia: '百家号',
  toutiao: '今日头条',
  csdn: 'CSDN',
  juejin: '掘金',
  bilibili: '哔哩哔哩',
  sohu: '搜狐号',
  netease: '网易号',
  zhidao: '百度知道',
};

const ALL_PLATFORMS: PlatformId[] = [
  'weixin', 'zhihu', 'toutiao',
  'csdn', 'juejin',
  'sohu', 'netease',
];

const CRED_TYPE_LABELS: Record<PlatformCredentials['type'], string> = {
  api_key: 'API Key',
  cookie: 'Cookie',
  token: 'Token',
};

const STATUS_CONFIG: Record<
  PlatformCredentials['status'] | 'none',
  { label: string; className: string }
> = {
  active: { label: '已激活', className: 'bg-success-bg text-success' },
  expired: { label: '已过期', className: 'bg-warning-bg text-warning' },
  invalid: { label: '无效', className: 'bg-error-bg text-error' },
  none: { label: '未配置', className: 'bg-muted text-muted-foreground' },
};

interface Row {
  key: string;
  value: string;
  /** 原始（脱敏）值，仅作为输入框 placeholder 提示 */
  masked?: string;
}

interface CardProps {
  platform: PlatformId;
  credential?: PlatformCredentials;
}

function initRows(cred?: PlatformCredentials): Row[] {
  if (!cred || Object.keys(cred.data).length === 0) {
    return [{ key: '', value: '', masked: undefined }];
  }
  return Object.entries(cred.data).map(([k, v]) => ({
    key: k,
    value: '',
    masked: v,
  }));
}

function PlatformCredentialCard({ platform, credential }: CardProps) {
  const { saveCredential, deleteCredential, validateCredential, loading } =
    useCredentialStore();

  const [type, setType] = useState<PlatformCredentials['type']>(
    credential?.type ?? 'cookie',
  );
  const [rows, setRows] = useState<Row[]>(() => initRows(credential));
  const [localError, setLocalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 当凭据内容变化时（如保存后返回新的脱敏数据），重置表单
  // 这是受控组件模式：将外部 props 同步到本地 state
  const dataSignature = credential ? JSON.stringify(credential.data) : '';
  useEffect(() => {
    // 受控组件模式：将外部 props 同步到本地 state
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setType(credential?.type ?? 'cookie');
    setRows(initRows(credential));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSignature]);

  const updateRow = (index: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const addRow = () => {
    setRows((prev) => [...prev, { key: '', value: '', masked: undefined }]);
  };

  const removeRow = (index: number) => {
    setRows((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.length > 0 ? next : [{ key: '', value: '', masked: undefined }];
    });
  };

  const handleSave = async () => {
    setLocalError(null);
    const data: Record<string, string> = {};
    for (const row of rows) {
      const k = row.key.trim();
      const v = row.value;
      if (!k) continue;
      if (!v) continue; // 跳过未填写的字段
      if (v.includes('*')) continue; // 跳过误填的脱敏值
      data[k] = v;
    }
    if (Object.keys(data).length === 0) {
      setLocalError('请至少完整填写一个凭据字段（字段名与值均不能为空）');
      return;
    }
    setBusy(true);
    try {
      await saveCredential(platform, {
        platform,
        accountId: credential?.accountId || 'default',
        type,
        data,
        status: 'active',
      });
      setLocalError(null);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };

  const handleValidate = async () => {
    setLocalError(null);
    setBusy(true);
    try {
      await validateCredential(platform);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : '验证失败');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!credential) return;
    if (!window.confirm(`确定要删除「${PLATFORM_LABELS[platform]}」的凭据吗？`)) return;
    setLocalError(null);
    setBusy(true);
    try {
      await deleteCredential(platform);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setBusy(false);
    }
  };

  const status: PlatformCredentials['status'] | 'none' = credential?.status ?? 'none';
  const statusConfig = STATUS_CONFIG[status];
  const disabled = busy || loading;

  return (
    <div className="bg-card rounded-xl border border-border p-4 space-y-3 shadow-card">
      {/* 头部：平台名 + 状态 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            {PLATFORM_LABELS[platform]}
          </h3>
          <span className="text-xs text-muted-foreground/70">{platform}</span>
        </div>
        <div className="flex items-center gap-2">
          {credential?.lastValidatedAt && (
            <span className="text-xs text-muted-foreground/70">
              验证于 {new Date(credential.lastValidatedAt).toLocaleString('zh-CN')}
            </span>
          )}
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusConfig.className}`}
          >
            {statusConfig.label}
          </span>
        </div>
      </div>

      {/* 已保存凭据（脱敏展示） */}
      {credential && Object.keys(credential.data).length > 0 && (
        <div className="rounded-md bg-muted/50 px-3 py-2">
          <div className="text-xs text-muted-foreground mb-1">已保存字段（脱敏）：</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {Object.entries(credential.data).map(([k, v]) => (
              <span key={k} className="text-xs text-foreground/70">
                <span className="font-medium">{k}</span>: {v}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 编辑表单 */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground w-12">类型</label>
          <select
            value={type}
            onChange={(e) =>
              setType(e.target.value as PlatformCredentials['type'])
            }
            disabled={disabled}
            className="rounded-md border border-border px-2 py-1 text-sm focus:border-primary focus:outline-none disabled:bg-muted"
          >
            {(Object.keys(CRED_TYPE_LABELS) as PlatformCredentials['type'][]).map(
              (t) => (
                <option key={t} value={t}>
                  {CRED_TYPE_LABELS[t]}
                </option>
              ),
            )}
          </select>
        </div>

        <div className="space-y-1.5">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                value={row.key}
                onChange={(e) => updateRow(i, { key: e.target.value })}
                placeholder="字段名（如 cookie / token / api_key）"
                disabled={disabled}
                className="w-1/3 rounded-md border border-border px-2 py-1 text-sm focus:border-primary focus:outline-none disabled:bg-muted"
              />
              <input
                type="password"
                value={row.value}
                onChange={(e) => updateRow(i, { value: e.target.value })}
                placeholder={row.masked ? `当前：${row.masked}（输入新值以更新）` : '字段值'}
                disabled={disabled}
                className="flex-1 rounded-md border border-border px-2 py-1 text-sm focus:border-primary focus:outline-none disabled:bg-muted"
              />
              <button
                onClick={() => removeRow(i)}
                disabled={disabled}
                className="rounded-md border border-border px-2 py-1 text-xs text-foreground/70 hover:bg-muted/50 disabled:opacity-50"
                title="移除该字段"
              >
                移除
              </button>
            </div>
          ))}
        </div>

        <button
          onClick={addRow}
          disabled={disabled}
          className="text-xs text-primary hover:text-primary/90 disabled:opacity-50"
        >
          + 添加字段
        </button>
      </div>

      {/* 错误提示 */}
      {localError && (
        <div className="rounded-md bg-error-bg px-3 py-2 text-xs text-error">
          {localError}
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={disabled}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? '处理中...' : '保存'}
        </button>
        <button
          onClick={handleValidate}
          disabled={disabled || !credential}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground/90 hover:bg-muted/50 disabled:opacity-50"
        >
          验证
        </button>
        <button
          onClick={handleDelete}
          disabled={disabled || !credential}
          className="rounded-md border border-error/30 px-3 py-1.5 text-xs font-medium text-error hover:bg-error-bg disabled:opacity-50"
        >
          删除
        </button>
        <span className="ml-auto text-xs text-muted-foreground/70">
          保存将覆盖该平台全部凭据字段
        </span>
      </div>
    </div>
  );
}

export function CredentialManager() {
  const { credentials, loading, error, fetchCredentials, clearError } =
    useCredentialStore();

  useEffect(() => {
    fetchCredentials();
  }, [fetchCredentials]);

  const credentialMap = new Map<PlatformId, PlatformCredentials>(
    credentials.map((c) => [c.platform, c]),
  );

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="p-6 max-w-none space-y-4">
        {/* 顶部标题与操作 */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-foreground">凭据管理</h2>
            <p className="text-sm text-muted-foreground">
              管理各内容平台的发布凭据（Cookie / Token / API Key），数据加密存储。
            </p>
          </div>
          <button
            onClick={() => fetchCredentials()}
            disabled={loading}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground/90 hover:bg-muted/50 disabled:opacity-50"
          >
            {loading ? '刷新中...' : '刷新'}
          </button>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="rounded-lg border border-error/30 bg-error-bg px-4 py-3 text-sm text-error">
            <div className="flex items-center justify-between">
              <span>{error}</span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => fetchCredentials()}
                  disabled={loading}
                  className="text-xs text-error underline underline-offset-2 disabled:opacity-50"
                >
                  重试
                </button>
                <button
                  onClick={clearError}
                  className="text-xs text-error underline underline-offset-2"
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 平台卡片列表 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {ALL_PLATFORMS.map((platform) => (
            <PlatformCredentialCard
              key={platform}
              platform={platform}
              credential={credentialMap.get(platform)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
