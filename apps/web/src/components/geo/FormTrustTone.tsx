import { ShieldCheck, Palette } from 'lucide-react';
import type { EnterpriseProfile } from '@zemingengine/shared';

interface FormTrustToneProps {
  data: Partial<EnterpriseProfile>;
  onChange: (field: keyof EnterpriseProfile, value: any) => void;
}

export function FormTrustTone({ data, onChange }: FormTrustToneProps) {
  const trustAnchorsText = (data.trustAnchors || []).join('\n');

  const handleTrustAnchorsChange = (text: string) => {
    const anchors = text
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => line.trim());
    onChange('trustAnchors', anchors);
  };

  const brandToneText = (data.brandTone || []).join('、');

  const handleBrandToneChange = (text: string) => {
    const tones = text
      .split(/[、,，]/)
      .filter((t) => t.trim())
      .map((t) => t.trim());
    onChange('brandTone', tones);
  };

  return (
    <div className="space-y-5">
      {/* 信任背书 */}
      <div>
        <label className="flex items-center gap-2 text-sm font-medium text-foreground mb-1.5">
          <ShieldCheck className="w-4 h-4 text-muted-foreground" />
          信任背书
          <span className="text-error">*</span>
        </label>
        <textarea
          value={trustAnchorsText}
          onChange={(e) => handleTrustAnchorsChange(e.target.value)}
          rows={5}
          placeholder="每行一条，使用顿号或换行分隔"
          className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-y min-h-[120px]"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          每行一条，使用顿号或换行分隔
        </p>
      </div>

      {/* 品牌调性 */}
      <div>
        <label className="flex items-center gap-2 text-sm font-medium text-foreground mb-1.5">
          <Palette className="w-4 h-4 text-muted-foreground" />
          品牌调性
        </label>
        <input
          type="text"
          value={brandToneText}
          onChange={(e) => handleBrandToneChange(e.target.value)}
          placeholder="用顿号或逗号分隔多个调性词"
          className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          用顿号或逗号分隔多个调性词
        </p>
      </div>
    </div>
  );
}
