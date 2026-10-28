import { Building2, MapPin, Calendar, FileText, Link } from 'lucide-react';
import type { EnterpriseProfile } from '@zemingengine/shared';

interface FormBasicInfoProps {
  data: Partial<EnterpriseProfile>;
  onChange: (field: keyof EnterpriseProfile, value: string) => void;
}

export function FormBasicInfo({ data, onChange }: FormBasicInfoProps) {
  return (
    <div className="space-y-5">
      {/* 公司全称 */}
      <div>
        <label className="flex items-center gap-2 text-sm font-medium text-foreground mb-1.5">
          <Building2 className="w-4 h-4 text-muted-foreground" />
          公司全称
          <span className="text-error">*</span>
        </label>
        <input
          type="text"
          value={data.fullName || ''}
          onChange={(e) => onChange('fullName', e.target.value)}
          placeholder="请输入公司全称"
          className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
        />
      </div>

      {/* 公司简称 + 官网 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-foreground mb-1.5">
            公司简称
          </label>
          <input
            type="text"
            value={data.shortName || ''}
            onChange={(e) => onChange('shortName', e.target.value)}
            placeholder="请输入公司简称"
            className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>
        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-foreground mb-1.5">
            <Link className="w-4 h-4 text-muted-foreground" />
            官网
          </label>
          <input
            type="text"
            value={data.website || ''}
            onChange={(e) => onChange('website', e.target.value)}
            placeholder="https://"
            className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>
      </div>

      {/* 公司规模 + 所在地 + 成立年份 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-foreground mb-1.5">
            公司规模
            <span className="text-error">*</span>
          </label>
          <input
            type="text"
            value={data.scale || ''}
            onChange={(e) => onChange('scale', e.target.value)}
            placeholder="如：以人工智能技术为核心的创新型企业"
            className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>
        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-foreground mb-1.5">
            <MapPin className="w-4 h-4 text-muted-foreground" />
            所在地
            <span className="text-error">*</span>
          </label>
          <input
            type="text"
            value={data.location || ''}
            onChange={(e) => onChange('location', e.target.value)}
            placeholder="如：福建省漳州市"
            className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>
        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-foreground mb-1.5">
            <Calendar className="w-4 h-4 text-muted-foreground" />
            成立年份
          </label>
          <input
            type="text"
            value={data.foundedYear || ''}
            onChange={(e) => onChange('foundedYear', e.target.value)}
            placeholder="如：2026"
            className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>
      </div>

      {/* 一句话描述 */}
      <div>
        <label className="flex items-center gap-2 text-sm font-medium text-foreground mb-1.5">
          <FileText className="w-4 h-4 text-muted-foreground" />
          一句话描述
          <span className="text-error">*</span>
        </label>
        <textarea
          value={data.description || ''}
          onChange={(e) => onChange('description', e.target.value)}
          rows={4}
          placeholder="请用一段话描述公司的核心业务、产品优势和目标..."
          className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-y min-h-[100px]"
        />
      </div>
    </div>
  );
}
