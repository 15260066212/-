import { useState, useRef } from 'react';
import {
  Search, Download, RefreshCw, Building2,
  FileText, Eye, BarChart3, AlertCircle,
} from 'lucide-react';
import { competitorMonitorPaths } from '../utils/api-paths.js';

const COMPETITOR_MAX_CHARS = 1000;

interface Props {
  sessionData: { enterprise?: { fullName?: string } } | null;
}

export function CompetitorMonitorPage({ sessionData }: Props) {
  const [targetCompany, setTargetCompany] = useState(
    sessionData?.enterprise?.fullName || '',
  );
  const [competitorText, setCompetitorText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportHtml, setReportHtml] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const parsedCompetitors = competitorText
    .split(/[\n,，;；、]/)
    .map((s) => s.trim())
    .filter(Boolean);

  const handleGenerate = async () => {
    if (!targetCompany.trim()) {
      setError('请填写公司名称');
      return;
    }
    if (parsedCompetitors.length === 0) {
      setError('请填写至少一个竞品名称');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const apiKey = localStorage.getItem('apiKey') || '';
      const resp = await fetch(competitorMonitorPaths.generate, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({
          target: targetCompany.trim(),
          competitors: parsedCompetitors,
        }),
      });
      const data = await resp.json();
      if (!data.success) {
        setError(data.error || '生成报告失败');
        return;
      }
      setReportHtml(data.data.html);
      setShowReport(true);
    } catch {
      setError('无法连接到服务器');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (!reportHtml) return;
    const blob = new Blob([reportHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GEO监测报告_${targetCompany}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 max-w-4xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <BarChart3 className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">竞品 GEO 监测</h2>
            <p className="text-sm text-muted-foreground">
              输入公司名称和竞品，一键生成 GEO 竞品对比监测报告（PPT）
            </p>
          </div>
        </div>

        {/* Step 1: Company name */}
        <div className="bg-card rounded-xl border border-border p-5 shadow-card">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">1</span>
            <h3 className="text-base font-semibold text-foreground">公司名称</h3>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 rounded-lg border border-input bg-background px-3">
              <Building2 className="w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                value={targetCompany}
                onChange={(e) => setTargetCompany(e.target.value)}
                placeholder="输入您的公司名称，如：新途科技"
                className="flex-1 bg-transparent py-2.5 text-sm text-foreground outline-none"
              />
            </div>
          </div>
        </div>

        {/* Step 2: Competitor supplement */}
        <div className="bg-card rounded-xl border border-border p-5 shadow-card">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">2</span>
              <h3 className="text-base font-semibold text-foreground">信息补充</h3>
            </div>
            <span className={`text-xs ${competitorText.length > COMPETITOR_MAX_CHARS ? 'text-error' : 'text-muted-foreground'}`}>
              {competitorText.length} / {COMPETITOR_MAX_CHARS}
            </span>
          </div>

          <textarea
            value={competitorText}
            onChange={(e) => {
              if (e.target.value.length <= COMPETITOR_MAX_CHARS) {
                setCompetitorText(e.target.value);
              }
            }}
            placeholder="填写竞品名称，多个竞品用换行、逗号或顿号分隔。例如：&#10;腾讯云&#10;阿里云&#10;华为云"
            rows={6}
            className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground outline-none resize-y focus:border-primary/50 transition-colors"
          />

          {parsedCompetitors.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {parsedCompetitors.map((c) => (
                <span
                  key={c}
                  className="inline-flex items-center rounded-full bg-muted text-foreground/90 px-3 py-1.5 text-sm"
                >
                  {c}
                </span>
              ))}
            </div>
          )}

          {parsedCompetitors.length === 0 && (
            <p className="text-xs text-muted-foreground/70 mt-2">
              填写竞品后，系统将对比您与竞品在 AI 搜索引擎中的 GEO 表现
            </p>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-error/30 bg-error-bg px-4 py-3 text-sm text-error flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto text-xs underline">关闭</button>
          </div>
        )}

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={loading || !targetCompany.trim() || parsedCompetitors.length === 0}
          className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              正在生成监测报告...
            </>
          ) : (
            <>
              <Search className="w-4 h-4" />
              生成 GEO 监测报告（PPT）
            </>
          )}
        </button>

        {/* Report result */}
        {reportHtml && showReport && (
          <div className="space-y-3 animate-in fade-in duration-300">
            <div className="flex items-center gap-2 text-sm text-success">
              <FileText className="w-4 h-4" />
              <span>监测报告已生成</span>
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setShowReport(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 text-primary px-3 py-2 text-xs font-medium hover:bg-primary/20 transition-colors"
              >
                <Eye className="w-3.5 h-3.5" />
                查看报告
              </button>
              <button
                onClick={handleDownload}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card text-foreground px-3 py-2 text-xs font-medium hover:bg-muted/30 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                下载报告HTML
              </button>
            </div>

            {/* Preview */}
            <div className="rounded-lg border border-border p-4 bg-muted/20">
              <div className="text-sm font-medium text-foreground mb-2">报告概览</div>
              <div className="text-xs text-muted-foreground space-y-1">
                <div>· 目标公司：{targetCompany}</div>
                <div>· 对比竞品：{parsedCompetitors.join('、')}</div>
                <div>· 报告格式：HTML PPT（可打印为PDF）</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Report preview modal */}
      {showReport && reportHtml && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowReport(false)}>
          <div className="bg-card rounded-xl shadow-xl w-full h-[90vh] max-w-5xl flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">{targetCompany} 竞品GEO监测报告</h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDownload}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted/30 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  下载
                </button>
                <button
                  onClick={() => setShowReport(false)}
                  className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/30 transition-colors"
                >
                  关闭
                </button>
              </div>
            </div>
            <iframe
              ref={iframeRef}
              srcDoc={reportHtml}
              title="GEO监测报告"
              className="flex-1 w-full border-0"
            />
          </div>
        </div>
      )}
    </div>
  );
}
