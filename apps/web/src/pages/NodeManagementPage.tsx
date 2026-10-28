import { useEffect, useState, useCallback } from 'react';
import {
  Server, CircleDot, CheckCircle2, XCircle, Clock,
  RefreshCw, Play, X, Monitor, Cpu, HardDrive,
  ShieldCheck, History, ChevronDown, ChevronUp,
} from 'lucide-react';
import { api, type NodeInfo, type DeployBatchInfo, type DeployTaskInfo } from '../hooks/useApi.js';
import { useAuthStore } from '../stores/authStore.js';

const STATUS_COLORS: Record<string, { text: string; bg: string; dot: string }> = {
  online: { text: 'text-success', bg: 'bg-success-bg', dot: 'bg-success' },
  offline: { text: 'text-error', bg: 'bg-error-bg', dot: 'bg-error' },
  deploying: { text: 'text-primary', bg: 'bg-primary/10', dot: 'bg-primary' },
  success: { text: 'text-success', bg: 'bg-success-bg', dot: 'bg-success' },
  failed: { text: 'text-error', bg: 'bg-error-bg', dot: 'bg-error' },
  pending: { text: 'text-muted-foreground', bg: 'bg-muted', dot: 'bg-muted-foreground' },
  running: { text: 'text-primary', bg: 'bg-primary/10', dot: 'bg-primary' },
  cancelled: { text: 'text-muted-foreground', bg: 'bg-muted', dot: 'bg-muted-foreground' },
};

const STATUS_LABELS: Record<string, string> = {
  online: '在线',
  offline: '离线',
  deploying: '部署中',
  success: '成功',
  failed: '失败',
  pending: '等待中',
  running: '执行中',
  cancelled: '已取消',
};

/**
 * NodeManagementPage — 节点管理 & 云端批量部署面板
 *
 * 功能：
 * - 查看所有 harvester 节点状态（在线/离线/部署中）
 * - 节点资源信息（CPU、内存、平台数、活跃会话）
 * - 批量部署：选择节点 → 下发部署任务 → 实时查看进度
 * - 部署历史：查看历史部署批次和日志
 */
export function NodeManagementPage() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [summary, setSummary] = useState<{ total: number; online: number; offline: number; deploying: number; totalPlatforms: number } | null>(null);
  const [batches, setBatches] = useState<DeployBatchInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
  const [showDeployDialog, setShowDeployDialog] = useState(false);
  const [deployName, setDeployName] = useState('');
  const [targetVersion, setTargetVersion] = useState('');
  const [deploying, setDeploying] = useState(false);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [batchTasks, setBatchTasks] = useState<DeployTaskInfo[]>([]);
  const [expandedNode, setExpandedNode] = useState<string | null>(null);
  const [nodeHistory, setNodeHistory] = useState<DeployTaskInfo[]>([]);
  const [logDialog, setLogDialog] = useState<{ taskId: string; log: string[] } | null>(null);

  // --- Load data ---
  const loadData = useCallback(async () => {
    try {
      const [nodesData, summaryData, batchesData] = await Promise.all([
        api.listNodes(),
        api.getNodesSummary(),
        api.listDeployBatches(10),
      ]);
      setNodes(nodesData);
      setSummary(summaryData);
      setBatches(batchesData);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 10000); // 每10秒刷新
    return () => clearInterval(interval);
  }, [loadData]);

  // --- Deploy batch detail polling ---
  useEffect(() => {
    if (!activeBatchId) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const data = await api.getDeployBatch(activeBatchId);
        if (!cancelled) setBatchTasks(data.tasks);
      } catch {
        // ignore
      }
    };

    poll();
    const interval = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeBatchId]);

  // --- Node selection ---
  const toggleNodeSelect = (nodeId: string) => {
    setSelectedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId);
      return next;
    });
  };

  const selectAllOnline = () => {
    const onlineIds = nodes.filter((n) => n.status === 'online').map((n) => n.nodeId);
    setSelectedNodes(new Set(onlineIds));
  };

  const clearSelection = () => setSelectedNodes(new Set());

  // --- Deploy ---
  const handleDeploy = async () => {
    if (selectedNodes.size === 0) return;
    setDeploying(true);
    try {
      const { batch } = await api.createDeployBatch(
        Array.from(selectedNodes),
        deployName || undefined,
        targetVersion || undefined,
      );
      setActiveBatchId(batch.batchId);
      setShowDeployDialog(false);
      setDeployName('');
      setTargetVersion('');
      clearSelection();
      loadData();
    } catch (err) {
      console.error('Deploy failed:', err);
    } finally {
      setDeploying(false);
    }
  };

  const handleCancelBatch = async (batchId: string) => {
    try {
      await api.cancelDeployBatch(batchId);
      loadData();
    } catch {
      // ignore
    }
  };

  const showTaskLog = async (taskId: string) => {
    try {
      const data = await api.getDeployTaskLog(taskId);
      setLogDialog({ taskId, log: data.log });
    } catch {
      setLogDialog({ taskId, log: ['无法加载日志'] });
    }
  };

  const toggleNodeExpand = async (nodeId: string) => {
    if (expandedNode === nodeId) {
      setExpandedNode(null);
      return;
    }
    setExpandedNode(nodeId);
    try {
      const history = await api.getNodeDeployHistory(nodeId, 5);
      setNodeHistory(history);
    } catch {
      setNodeHistory([]);
    }
  };

  const statusColor = (s: string) => STATUS_COLORS[s] || STATUS_COLORS.offline;
  const statusLabel = (s: string) => STATUS_LABELS[s] || s;

  if (loading && nodes.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // 非 admin 无权限访问
  if (!isAdmin) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <ShieldCheck className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-foreground mb-1">无权限访问</h3>
          <p className="text-sm text-muted-foreground">节点管理仅对管理员账号开放</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="p-4 md:p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-foreground">节点管理</h2>
            <p className="text-sm text-muted-foreground">云端统一管理所有单机节点，批量下发部署任务</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadData}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-sm hover:bg-muted/50"
            >
              <RefreshCw className="w-4 h-4 inline mr-1" />
              刷新
            </button>
            <button
              onClick={() => setShowDeployDialog(true)}
              disabled={selectedNodes.size === 0}
              className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Play className="w-4 h-4 inline mr-1" />
              批量部署
              {selectedNodes.size > 0 && ` (${selectedNodes.size})`}
            </button>
          </div>
        </div>

        {/* Summary cards */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="text-xs text-muted-foreground mb-1">总节点数</div>
              <div className="text-2xl font-bold text-foreground">{summary.total}</div>
            </div>
            <div className="rounded-xl border border-success/30 bg-success-bg p-4">
              <div className="text-xs text-success mb-1">在线</div>
              <div className="text-2xl font-bold text-success">{summary.online}</div>
            </div>
            <div className="rounded-xl border border-error/30 bg-error-bg p-4">
              <div className="text-xs text-error mb-1">离线</div>
              <div className="text-2xl font-bold text-error">{summary.offline}</div>
            </div>
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
              <div className="text-xs text-primary mb-1">平台总数</div>
              <div className="text-2xl font-bold text-primary">{summary.totalPlatforms}</div>
            </div>
          </div>
        )}

        {/* Selection toolbar */}
        {nodes.length > 0 && (
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-3 py-2">
            <span className="text-sm text-muted-foreground">
              已选 <span className="font-medium text-foreground">{selectedNodes.size}</span> / {nodes.length} 个节点
            </span>
            <div className="flex items-center gap-2">
              <button onClick={selectAllOnline} className="text-xs text-primary hover:underline">
                全选在线
              </button>
              <button onClick={clearSelection} className="text-xs text-muted-foreground hover:underline">
                清空选择
              </button>
            </div>
          </div>
        )}

        {/* Node list */}
        <div className="space-y-2">
          {nodes.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
              <Server className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-muted-foreground">暂无节点</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                在单机上设置 NODE_AGENT_ENABLED=true 并启动 harvester 后将自动注册
              </p>
            </div>
          ) : (
            nodes.map((node) => {
              const sc = statusColor(node.status);
              const isExpanded = expandedNode === node.nodeId;
              return (
                <div key={node.nodeId} className="rounded-xl border border-border bg-card shadow-card overflow-hidden">
                  <div
                    className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => toggleNodeExpand(node.nodeId)}
                  >
                    {/* Checkbox */}
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleNodeSelect(node.nodeId); }}
                      className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                        selectedNodes.has(node.nodeId)
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border'
                      }`}
                    >
                      {selectedNodes.has(node.nodeId) && <CheckCircle2 className="w-3 h-3" />}
                    </button>

                    {/* Node info */}
                    <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                      <Monitor className="w-5 h-5 text-foreground/60" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{node.name}</span>
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${sc.bg} ${sc.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${sc.dot} ${node.status === 'deploying' ? 'animate-pulse' : ''}`} />
                          {statusLabel(node.status)}
                        </span>
                        {node.tags.length > 0 && node.tags.map((tag) => (
                          <span key={tag} className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            {tag}
                          </span>
                        ))}
                      </div>
                      <div className="text-xs text-muted-foreground/70 mt-0.5">
                        {node.version} · {node.os}
                      </div>
                    </div>

                    {/* Stats */}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        {node.platformCount} 平台
                      </div>
                      <div className="flex items-center gap-1">
                        <CircleDot className="w-3.5 h-3.5" />
                        {node.activeSessions} 会话
                      </div>
                      <div className="flex items-center gap-1">
                        <Cpu className="w-3.5 h-3.5" />
                        {node.cpuCores}核
                      </div>
                      <div className="flex items-center gap-1">
                        <HardDrive className="w-3.5 h-3.5" />
                        {Math.round(node.memoryMB / 1024)}G
                      </div>
                    </div>

                    {/* Expand icon */}
                    {isExpanded ? (
                      <ChevronUp className="w-5 h-5 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-muted-foreground" />
                    )}
                  </div>

                  {/* Expanded: deploy history */}
                  {isExpanded && (
                    <div className="border-t border-border px-4 py-3 bg-muted/10">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-foreground flex items-center gap-1.5">
                          <History className="w-4 h-4" />
                          最近部署记录
                        </span>
                      </div>
                      {nodeHistory.length === 0 ? (
                        <p className="text-xs text-muted-foreground/70">暂无部署记录</p>
                      ) : (
                        <div className="space-y-1">
                          {nodeHistory.map((task) => {
                            const tc = statusColor(task.status);
                            return (
                              <div
                                key={task.taskId}
                                className="flex items-center justify-between rounded-md bg-card px-3 py-2 text-sm cursor-pointer hover:bg-muted/50"
                                onClick={() => showTaskLog(task.taskId)}
                              >
                                <div className="flex items-center gap-2">
                                  <span className={`w-2 h-2 rounded-full ${tc.dot}`} />
                                  <span className="text-foreground/80">{statusLabel(task.status)}</span>
                                  <span className="text-xs text-muted-foreground">
                                    {new Date(task.createdAt).toLocaleString('zh-CN')}
                                  </span>
                                </div>
                                {task.durationMs !== undefined && (
                                  <span className="text-xs text-muted-foreground">
                                    {(task.durationMs / 1000).toFixed(1)}s
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Deploy history */}
        {batches.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
              <Clock className="w-4 h-4" />
              最近部署批次
            </h3>
            <div className="space-y-2">
              {batches.slice(0, 5).map((batch) => {
                const sc = statusColor(batch.status);
                const isActive = activeBatchId === batch.batchId;
                return (
                  <div
                    key={batch.batchId}
                    className={`rounded-xl border bg-card shadow-card overflow-hidden cursor-pointer transition-all ${
                      isActive ? 'border-primary/50 ring-1 ring-primary/30' : 'border-border hover:border-muted-foreground/30'
                    }`}
                    onClick={() => setActiveBatchId(isActive ? null : batch.batchId)}
                  >
                    <div className="flex items-center gap-3 px-4 py-3">
                      <div className={`w-2 h-2 rounded-full ${sc.dot} ${batch.status === 'running' ? 'animate-pulse' : ''}`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-foreground">{batch.name}</div>
                        <div className="text-xs text-muted-foreground/70">
                          {batch.nodeIds.length} 个节点 · {new Date(batch.createdAt).toLocaleString('zh-CN')}
                        </div>
                      </div>
                      <span className={`text-xs font-medium ${sc.text}`}>
                        {statusLabel(batch.status)}
                      </span>
                      {batch.status === 'running' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleCancelBatch(batch.batchId); }}
                          className="text-xs text-error hover:underline"
                        >
                          取消
                        </button>
                      )}
                    </div>

                    {/* Batch tasks */}
                    {isActive && batchTasks.length > 0 && (
                      <div className="border-t border-border px-4 py-3 bg-muted/10 space-y-1.5">
                        {batchTasks.map((task) => {
                          const tc = statusColor(task.status);
                          const node = nodes.find((n) => n.nodeId === task.nodeId);
                          return (
                            <div
                              key={task.taskId}
                              className="flex items-center justify-between rounded-md bg-card px-3 py-2 text-sm"
                            >
                              <div className="flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full ${tc.dot} ${task.status === 'running' ? 'animate-pulse' : ''}`} />
                                <span className="text-foreground/80">{node?.name || task.nodeId}</span>
                                <span className={`text-xs ${tc.text}`}>{statusLabel(task.status)}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                {task.durationMs !== undefined && (
                                  <span className="text-xs text-muted-foreground">
                                    {(task.durationMs / 1000).toFixed(1)}s
                                  </span>
                                )}
                                {(task.status === 'success' || task.status === 'failed') && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); showTaskLog(task.taskId); }}
                                    className="text-xs text-primary hover:underline"
                                  >
                                    查看日志
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Deploy dialog */}
      {showDeployDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="rounded-xl border border-border bg-background shadow-2xl w-full max-w-md">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="text-base font-semibold text-foreground">批量部署</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                将向 {selectedNodes.size} 个节点下发部署任务
              </p>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="text-xs font-medium text-foreground/80 mb-1 block">
                  部署名称（可选）
                </label>
                <input
                  type="text"
                  value={deployName}
                  onChange={(e) => setDeployName(e.target.value)}
                  placeholder="例如：v1.2.0 升级"
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-foreground/80 mb-1 block">
                  目标版本（可选）
                </label>
                <input
                  type="text"
                  value={targetVersion}
                  onChange={(e) => setTargetVersion(e.target.value)}
                  placeholder="留空使用最新版本"
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div className="rounded-lg bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground mb-2">目标节点：</div>
                <div className="flex flex-wrap gap-1.5">
                  {Array.from(selectedNodes).map((id) => {
                    const n = nodes.find((x) => x.nodeId === id);
                    return (
                      <span key={id} className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                        {n?.name || id}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
              <button
                onClick={() => setShowDeployDialog(false)}
                disabled={deploying}
                className="rounded-md border border-border bg-card px-4 py-1.5 text-sm hover:bg-muted/50 disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={handleDeploy}
                disabled={deploying || selectedNodes.size === 0}
                className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {deploying ? (
                  <><RefreshCw className="w-4 h-4 inline animate-spin mr-1" /> 部署中...</>
                ) : (
                  <><Play className="w-4 h-4 inline mr-1" /> 开始部署</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Log dialog */}
      {logDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setLogDialog(null)}>
          <div className="rounded-xl border border-border bg-background shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <h3 className="text-base font-semibold text-foreground">部署日志</h3>
              <button onClick={() => setLogDialog(null)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 bg-black/90 rounded-b-xl">
              <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap">
                {logDialog.log.length === 0 ? '暂无日志' : logDialog.log.join('\n')}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
