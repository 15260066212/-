import { useMemo, useState, useRef, useEffect } from 'react';
import type { ProfileReviewRequest, SessionData } from '@zemingengine/shared';
import { useSessionStore } from '../stores/sessionStore.js';
import { Building2, Link2, FileText, Package, Award, Globe, MapPin, Users, Calendar, Sparkles, Save, RefreshCw, CheckCircle2, Upload, FileSpreadsheet, Phone, Mail } from 'lucide-react';

interface Props {
  sessionData: SessionData;
}

export function GEOConfigForm({ sessionData }: Props) {
  const { submitUrl, importPpt, confirmProfileReview, isLoading, sessionId } = useSessionStore();
  const [urlInput, setUrlInput] = useState('');
  const [activeSection, setActiveSection] = useState<string>('basic');
  const [savedFields, setSavedFields] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const skipNextSync = useRef(false);

  const initial = useMemo(() => {
    const enterprise = sessionData.enterprise;
    return {
      fullName: enterprise.fullName,
      shortName: enterprise.shortName,
      description: enterprise.description,
      scale: enterprise.scale,
      location: enterprise.location,
      website: enterprise.website,
      phone: enterprise.phone || '',
      email: enterprise.email || '',
      address: enterprise.address || '',
      foundedYear: enterprise.foundedYear,
      productsText: enterprise.products.map((product) => product.name).join('\n'),
      brandStory: enterprise.brandStory,
      trustAnchorsText: enterprise.trustAnchors.join('\n'),
      brandToneText: enterprise.brandTone.join('、'),
      userPainPointsText: enterprise.userPainPoints.join('\n'),
    };
  }, [sessionData]);

  const [form, setForm] = useState<ProfileReviewRequest & { foundedYear?: string; brandToneText?: string; userPainPointsText?: string; phone?: string; email?: string; address?: string }>(initial);

  // Sync form state when sessionData changes (e.g., after URL auto-fill or PPT import)
  // Skip sync after save to preserve user input
  useEffect(() => {
    if (skipNextSync.current) {
      skipNextSync.current = false;
      return;
    }
    setForm({
      fullName: sessionData.enterprise.fullName,
      shortName: sessionData.enterprise.shortName,
      description: sessionData.enterprise.description,
      scale: sessionData.enterprise.scale,
      location: sessionData.enterprise.location,
      website: sessionData.enterprise.website,
      phone: sessionData.enterprise.phone || '',
      email: sessionData.enterprise.email || '',
      address: sessionData.enterprise.address || '',
      foundedYear: sessionData.enterprise.foundedYear,
      productsText: sessionData.enterprise.products.map((p) => p.name).join('\n'),
      brandStory: sessionData.enterprise.brandStory,
      trustAnchorsText: sessionData.enterprise.trustAnchors.join('\n'),
      brandToneText: sessionData.enterprise.brandTone.join('、'),
      userPainPointsText: sessionData.enterprise.userPainPoints.join('\n'),
    });
  }, [sessionData]);

  const update = (field: string, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setSavedFields((prev) => {
      const next = new Set(prev);
      next.delete(field);
      return next;
    });
  };

  const handleScrape = () => {
    let url = urlInput.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
    }
    submitUrl(url);
  };

  const handlePptImport = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const name = file.name.toLowerCase();
    if (!name.endsWith('.pptx')) {
      alert('仅支持 .pptx 格式文件，请将 PPT 另存为 .pptx 格式');
      e.target.value = '';
      return;
    }
    setImporting(true);
    try {
      await importPpt(file);
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  };

  const handleSave = () => {
    skipNextSync.current = true;
    confirmProfileReview(form);
    setSavedFields(new Set(Object.keys(form).filter((k) => form[k as keyof typeof form]?.trim())));
  };

  const sections = [
    { id: 'basic', label: '基本信息', icon: Building2 },
    { id: 'products', label: '产品与品牌', icon: Package },
    { id: 'trust', label: '信任与调性', icon: Award },
  ];

  const fieldStatus = (field: string) => {
    const value = form[field as keyof typeof form];
    if (!value?.trim()) return 'empty';
    return savedFields.has(field) ? 'saved' : 'filled';
  };

  const filledCount = [
    form.fullName, form.description, form.scale, form.location,
    form.productsText, form.brandStory, form.trustAnchorsText,
  ].filter((v) => v?.trim()).length;
  const totalCount = 7;

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Top toolbar */}
      <div className="border-b border-border bg-card px-4 py-3 flex items-center gap-3 flex-shrink-0">
        <div className="flex items-center gap-2 flex-1">
          <Globe className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium text-foreground">企业画像配置</span>
          <span className="text-xs text-muted-foreground">({filledCount}/{totalCount} 项已填)</span>
        </div>
        {/* URL auto-fill + PPT import */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="输入网址，如 www.example.com"
            className="w-40 md:w-56 rounded-md border border-input bg-background px-3 py-1.5 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-ring"
            onKeyDown={(e) => e.key === 'Enter' && handleScrape()}
          />
          <button
            onClick={handleScrape}
            disabled={isLoading || importing || !urlInput.trim()}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 text-primary px-3 py-1.5 text-xs font-medium hover:bg-primary/20 disabled:opacity-50 transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" />
            自动填充
          </button>
          <span className="text-xs text-muted-foreground/50">|</span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pptx"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            onClick={handlePptImport}
            disabled={isLoading || importing}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 text-primary px-3 py-1.5 text-xs font-medium hover:bg-primary/20 disabled:opacity-50 transition-colors"
          >
            {importing ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FileSpreadsheet className="w-3.5 h-3.5" />
            )}
            {importing ? '导入中...' : 'PPT导入'}
          </button>
        </div>
      </div>

      {/* Section tabs */}
      <div className="border-b border-border bg-card flex flex-shrink-0">
        {sections.map((section) => {
          const Icon = section.icon;
          const isActive = activeSection === section.id;
          return (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                isActive
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="w-4 h-4" />
              {section.label}
            </button>
          );
        })}
      </div>

      {/* Form content */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="max-w-3xl mx-auto space-y-5">
          {activeSection === 'basic' && (
            <>
              <FormField
                label="公司全称"
                required
                icon={Building2}
                value={form.fullName}
                onChange={(v) => update('fullName', v)}
                placeholder="例如：北京新途科技有限公司"
              />
              <div className="grid gap-5 md:grid-cols-2">
                <FormField
                  label="公司简称"
                  icon={Building2}
                  value={form.shortName}
                  onChange={(v) => update('shortName', v)}
                  placeholder="例如：新途科技"
                />
                <FormField
                  label="官网"
                  icon={Link2}
                  value={form.website}
                  onChange={(v) => update('website', v)}
                  placeholder="https://..."
                />
              </div>
              <div className="grid gap-5 md:grid-cols-3">
                <FormField
                  label="联系电话"
                  icon={Phone}
                  value={form.phone ?? ''}
                  onChange={(v) => update('phone', v)}
                  placeholder="例如：400-xxx-xxxx"
                  hint="将出现在文章末尾联系方式中"
                />
                <FormField
                  label="联系邮箱"
                  icon={Mail}
                  value={form.email ?? ''}
                  onChange={(v) => update('email', v)}
                  placeholder="例如：contact@example.com"
                />
                <FormField
                  label="公司地址"
                  icon={MapPin}
                  value={form.address ?? ''}
                  onChange={(v) => update('address', v)}
                  placeholder="例如：北京市朝阳区xxx"
                />
              </div>
              <div className="grid gap-5 md:grid-cols-3">
                <FormField
                  label="公司规模"
                  required
                  icon={Users}
                  value={form.scale}
                  onChange={(v) => update('scale', v)}
                  placeholder="例如：50-200人"
                />
                <FormField
                  label="所在地"
                  required
                  icon={MapPin}
                  value={form.location}
                  onChange={(v) => update('location', v)}
                  placeholder="例如：北京"
                />
                <FormField
                  label="成立年份"
                  icon={Calendar}
                  value={form.foundedYear ?? ''}
                  onChange={(v) => update('foundedYear', v)}
                  placeholder="例如：2015"
                />
              </div>
              <TextAreaField
                label="一句话描述"
                required
                icon={FileText}
                value={form.description}
                onChange={(v) => update('description', v)}
                placeholder="用一句话概括公司的核心业务和价值主张"
                rows={2}
              />
            </>
          )}

          {activeSection === 'products' && (
            <>
              <TextAreaField
                label="核心产品/服务"
                required
                icon={Package}
                value={form.productsText}
                onChange={(v) => update('productsText', v)}
                placeholder="每行一个产品/服务名称，例如：&#10;SEO搜索引擎优化&#10;GEO生成式引擎优化&#10;社交媒体营销"
                rows={5}
                hint="每行一个，第一行将作为主要产品"
              />
              <TextAreaField
                label="品牌故事"
                required
                icon={FileText}
                value={form.brandStory}
                onChange={(v) => update('brandStory', v)}
                placeholder="描述品牌的创立背景、愿景和发展历程..."
                rows={4}
              />
              <TextAreaField
                label="用户痛点"
                icon={Users}
                value={form.userPainPointsText ?? ''}
                onChange={(v) => update('userPainPointsText', v)}
                placeholder="目标用户面临的核心痛点，每行一个..."
                rows={3}
              />
            </>
          )}

          {activeSection === 'trust' && (
            <>
              <TextAreaField
                label="信任背书"
                required
                icon={Award}
                value={form.trustAnchorsText}
                onChange={(v) => update('trustAnchorsText', v)}
                placeholder="资质认证、行业奖项、合作伙伴等，每行一条..."
                rows={4}
                hint="每行一条，使用顿号或换行分隔"
              />
              <FormField
                label="品牌调性"
                icon={Sparkles}
                value={form.brandToneText ?? ''}
                onChange={(v) => update('brandToneText', v)}
                placeholder="例如：专业、可信赖、创新"
                hint="用顿号或逗号分隔多个调性词"
              />
            </>
          )}
        </div>
      </div>

      {/* Bottom action bar */}
      <div className="border-t border-border bg-card px-4 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          {isLoading && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              处理中...
            </span>
          )}
          {savedFields.size > 0 && !isLoading && (
            <span className="inline-flex items-center gap-1.5 text-xs text-success">
              <CheckCircle2 className="w-3.5 h-3.5" />
              已保存
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {sections.map((s) => {
            const sectionFields = s.id === 'basic'
              ? ['fullName', 'description', 'scale', 'location']
              : s.id === 'products'
              ? ['productsText', 'brandStory']
              : ['trustAnchorsText'];
            const filled = sectionFields.filter((f) => form[f as keyof typeof form]?.trim()).length;
            return (
              <span key={s.id} className="text-xs text-muted-foreground">
                {s.label}: {filled}/{sectionFields.length}
              </span>
            );
          })}
          <button
            onClick={handleSave}
            disabled={isLoading}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {isLoading ? '保存中...' : '保存并继续'}
          </button>
        </div>
      </div>
    </div>
  );
}

function FormField({
  label,
  required,
  icon: Icon,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  required?: boolean;
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <div>
      <label className="flex items-center gap-2 mb-1.5">
        {Icon && <Icon className="w-3.5 h-3.5 text-muted-foreground" />}
        <span className="text-sm font-medium text-foreground">
          {label}
          {required && <span className="text-destructive ml-0.5">*</span>}
        </span>
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-ring"
      />
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function TextAreaField({
  label,
  required,
  icon: Icon,
  value,
  onChange,
  placeholder,
  rows = 3,
  hint,
}: {
  label: string;
  required?: boolean;
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  hint?: string;
}) {
  return (
    <div>
      <label className="flex items-center gap-2 mb-1.5">
        {Icon && <Icon className="w-3.5 h-3.5 text-muted-foreground" />}
        <span className="text-sm font-medium text-foreground">
          {label}
          {required && <span className="text-destructive ml-0.5">*</span>}
        </span>
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-ring"
      />
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
