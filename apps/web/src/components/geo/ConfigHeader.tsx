import { useState } from 'react';
import { Globe, Upload, Sparkles } from 'lucide-react';

interface ConfigHeaderProps {
  title: string;
  completedCount: number;
  totalCount: number;
  onUrlSubmit?: (url: string) => void;
  onPptImport?: () => void;
  isAutoFilling?: boolean;
}

export function ConfigHeader({
  title,
  completedCount,
  totalCount,
  onUrlSubmit,
  onPptImport,
  isAutoFilling = false,
}: ConfigHeaderProps) {
  const [url, setUrl] = useState('');

  const handleAutoFill = () => {
    if (url.trim() && onUrlSubmit) {
      onUrlSubmit(url.trim());
    }
  };

  return (
    <div className="border-b border-border bg-card px-4 md:px-6 py-4">
      {/* 标题行 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center">
            <Globe className="w-3.5 h-3.5 text-primary" />
          </div>
          <h2 className="text-base font-semibold text-foreground">
            {title}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({completedCount}/{totalCount} 项已填)
            </span>
          </h2>
        </div>
      </div>

      {/* 操作栏 */}
      <div className="flex items-center gap-3">
        {/* URL 输入 + 自动填充 */}
        <div className="flex-1 flex items-center gap-2">
          <div className="flex-1 relative">
            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="输入网址，如 www.example.com"
              className="w-full pl-9 pr-4 py-2 rounded-lg border border-border bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              onKeyDown={(e) => e.key === 'Enter' && handleAutoFill()}
            />
          </div>
          <button
            onClick={handleAutoFill}
            disabled={!url.trim() || isAutoFilling}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary/10 text-primary text-sm font-medium hover:bg-primary/15 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Sparkles className="w-4 h-4" />
            <span>自动填充</span>
          </button>
        </div>

        {/* PPT 导入 */}
        <button
          onClick={onPptImport}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-card text-sm font-medium text-foreground hover:bg-muted transition-colors"
        >
          <Upload className="w-4 h-4" />
          <span>PPT导入</span>
        </button>
      </div>
    </div>
  );
}
