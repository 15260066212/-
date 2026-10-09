import { useMemo, useState } from 'react';
import type { ProfileReviewRequest, SessionData } from '@zemingengine/shared';
import { CheckCircle2 } from 'lucide-react';

interface Props {
  sessionData: SessionData;
  isLoading: boolean;
  onConfirm: (payload: ProfileReviewRequest) => void;
}

export function ProfileReviewForm({ sessionData, isLoading, onConfirm }: Props) {
  const initial = useMemo(() => {
    const enterprise = sessionData.enterprise;
    return {
      fullName: enterprise.fullName,
      shortName: enterprise.shortName,
      description: enterprise.description,
      scale: enterprise.scale,
      location: enterprise.location,
      website: enterprise.website,
      productsText: enterprise.products.map((product) => product.name).join('\n'),
      brandStory: enterprise.brandStory,
      trustAnchorsText: enterprise.trustAnchors.join('\n'),
    };
  }, [sessionData]);

  const [form, setForm] = useState<ProfileReviewRequest>(initial);

  const update = (field: keyof ProfileReviewRequest, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const missingCount = [
    form.fullName,
    form.description,
    form.scale,
    form.location,
    form.productsText,
    form.brandStory,
    form.trustAnchorsText,
  ].filter((value) => !value.trim()).length;

  return (
    <div className="mx-4 mb-4 rounded-xl border border-primary/30 bg-card shadow-card">
      <div className="border-b border-primary/20 bg-primary/5 px-4 py-3 rounded-t-xl">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary flex-shrink-0">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">确认企业画像</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                已从官网获取的信息可直接修改，确认后只补充缺失项。
              </p>
            </div>
          </div>
          <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
            缺失 {missingCount} 项
          </span>
        </div>
      </div>

      <div className="grid gap-3 p-4 md:grid-cols-2">
        <TextField label="公司全称" value={form.fullName} onChange={(value) => update('fullName', value)} />
        <TextField label="公司简称" value={form.shortName} onChange={(value) => update('shortName', value)} />
        <TextField label="官网" value={form.website} onChange={(value) => update('website', value)} />
        <TextField label="公司规模" value={form.scale} onChange={(value) => update('scale', value)} />
        <TextField label="所在地" value={form.location} onChange={(value) => update('location', value)} />
        <TextArea
          label="一句话描述"
          value={form.description}
          onChange={(value) => update('description', value)}
          className="md:col-span-2"
        />
        <TextArea
          label="核心产品/服务"
          value={form.productsText}
          onChange={(value) => update('productsText', value)}
          className="md:col-span-2"
        />
        <TextArea
          label="品牌故事"
          value={form.brandStory}
          onChange={(value) => update('brandStory', value)}
          className="md:col-span-2"
        />
        <TextArea
          label="信任背书"
          value={form.trustAnchorsText}
          onChange={(value) => update('trustAnchorsText', value)}
          className="md:col-span-2"
        />
      </div>

      <div className="flex justify-end border-t border-border px-4 py-3">
        <button
          onClick={() => onConfirm(form)}
          disabled={isLoading}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {isLoading ? '确认中...' : '确认并继续'}
        </button>
      </div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-ring"
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  className = '',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-ring"
      />
    </label>
  );
}
