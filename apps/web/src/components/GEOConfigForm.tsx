import { useMemo, useState, useRef, useEffect } from 'react';
import type { ProfileReviewRequest, SessionData, ProductDetail } from '@zemingengine/shared';
import { useSessionStore } from '../stores/sessionStore.js';
import {
  Building2, Link2, FileText, Package, Award, Globe, MapPin, Users, Calendar,
  Sparkles, Save, RefreshCw, CheckCircle2, FileSpreadsheet, Phone, Mail,
  Briefcase, Target, Layers, Plus, Trash2, ShieldAlert,
} from 'lucide-react';

interface Props {
  sessionData: SessionData;
}

/**
 * GEO 配置表单 —— 字段结构对齐《新客户录入表（企业填写）》。
 *
 * 板块划分：
 *   1. 基础信息（公司全称 / 经营地址 / 咨询热线 / 公司简介）
 *   2. 公司介绍（企业介绍 / 团队实力 / 服务优势 / 经营理念）
 *   3. 产品服务（推广核心产品或服务 / 品牌故事）
 *   4. 信任背书（信任背书 / 品牌调性）
 *   5. 合作案例（实际案例 / 录入标准 / 案例行业分类）
 *   6. 名片与其他（网址 / 电话 / 邮箱 / 产品详细解读 / 规避清单）
 */
export function GEOConfigForm({ sessionData }: Props) {
  const { submitUrl, importPpt, importDocx, confirmProfileReview, isLoading } = useSessionStore();
  const [urlInput, setUrlInput] = useState('');
  const [activeSection, setActiveSection] = useState<string>('basic');
  const [savedFields, setSavedFields] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docxInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState<'ppt' | 'docx' | null>(null);
  const skipNextSync = useRef(false);

  const buildInitial = (data: SessionData): ProfileReviewRequest => {
    const e = data.enterprise;
    return {
      fullName: e.fullName,
      shortName: e.shortName,
      description: e.description,
      scale: e.scale,
      location: e.location,
      website: e.website,
      phone: e.phone || '',
      email: e.email || '',
      address: e.address || '',
      foundedYear: e.foundedYear,
      productsText: e.products
        .map((p) => (p.description ? `${p.name}：${p.description}` : p.name))
        .join('\n'),
      brandStory: e.brandStory,
      trustAnchorsText: e.trustAnchors.join('\n'),
      brandToneText: e.brandTone.join('、'),
      userPainPointsText: e.userPainPoints.join('\n'),
      enterpriseIntro: e.enterpriseIntro ?? '',
      teamStrength: e.teamStrength ?? '',
      serviceAdvantages: e.serviceAdvantages ?? '',
      businessPhilosophy: e.businessPhilosophy ?? '',
      caseStudiesText: (e.caseStudies ?? []).join('\n'),
      caseEntryStandard: e.caseEntryStandard ?? '',
      caseIndustriesText: (e.caseIndustries ?? []).join('\n'),
      productDetails: e.productDetails ?? [],
      avoidKeywordsText: (e.avoidKeywords ?? []).join('\n'),
    };
  };

  const initial = useMemo(() => buildInitial(sessionData), [sessionData]);

  const [form, setForm] = useState<ProfileReviewRequest>(initial);

  // Sync form state when sessionData changes (e.g., after URL auto-fill or PPT import)
  // Skip sync after save to preserve user input
  useEffect(() => {
    if (skipNextSync.current) {
      skipNextSync.current = false;
      return;
    }
    setForm(buildInitial(sessionData));
  }, [sessionData]);

  const update = (field: string, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setSavedFields((prev) => {
      const next = new Set(prev);
      next.delete(field);
      return next;
    });
  };

  const updateProductDetail = (index: number, field: keyof ProductDetail, value: string) => {
    setForm((current) => {
      const list = [...(current.productDetails ?? [])];
      list[index] = { ...list[index], [field]: value };
      return { ...current, productDetails: list };
    });
  };

  const addProductDetail = () => {
    setForm((current) => ({
      ...current,
      productDetails: [...(current.productDetails ?? []), { name: '' }],
    }));
  };

  const removeProductDetail = (index: number) => {
    setForm((current) => ({
      ...current,
      productDetails: (current.productDetails ?? []).filter((_, i) => i !== index),
    }));
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

  const handlePptFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const name = file.name.toLowerCase();
    if (!name.endsWith('.pptx')) {
      alert('仅支持 .pptx 格式文件，请将 PPT 另存为 .pptx 格式');
      e.target.value = '';
      return;
    }
    setImporting('ppt');
    try {
      await importPpt(file);
    } finally {
      setImporting(null);
      e.target.value = '';
    }
  };

  const handleDocxImport = () => {
    docxInputRef.current?.click();
  };

  const handleDocxFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const name = file.name.toLowerCase();
    if (name.endsWith('.doc')) {
      alert('旧版 .doc 格式不支持，请将 Word 另存为 .docx 格式');
      e.target.value = '';
      return;
    }
    if (!name.endsWith('.docx')) {
      alert('仅支持 .docx 格式文件');
      e.target.value = '';
      return;
    }
    setImporting('docx');
    try {
      await importDocx(file);
    } finally {
      setImporting(null);
      e.target.value = '';
    }
  };

  const handleSave = () => {
    skipNextSync.current = true;
    const cleaned: ProfileReviewRequest = {
      ...form,
      productDetails: (form.productDetails ?? []).filter((item) => item.name?.trim()),
    };
    confirmProfileReview(cleaned);
    setSavedFields(
      new Set(
        Object.keys(cleaned).filter((k) => {
          const v = cleaned[k as keyof ProfileReviewRequest];
          if (Array.isArray(v)) return v.length > 0;
          return typeof v === 'string' && v.trim().length > 0;
        }),
      ),
    );
  };

  // 板块定义 —— 与录入表一致
  const sections = [
    { id: 'basic', label: '基础信息', icon: Building2, fields: ['fullName', 'address', 'phone', 'description'] },
    { id: 'intro', label: '公司介绍', icon: Briefcase, fields: ['enterpriseIntro', 'teamStrength', 'serviceAdvantages', 'businessPhilosophy'] },
    { id: 'products', label: '产品服务', icon: Package, fields: ['productsText', 'brandStory'] },
    { id: 'trust', label: '信任背书', icon: Award, fields: ['trustAnchorsText', 'brandToneText'] },
    { id: 'cases', label: '合作案例', icon: Target, fields: ['caseStudiesText', 'caseEntryStandard', 'caseIndustriesText'] },
    { id: 'misc', label: '名片与其他', icon: Globe, fields: ['website', 'phone', 'email'] },
  ];

  const isFilled = (key: string) => {
    const v = form[key as keyof ProfileReviewRequest];
    if (Array.isArray(v)) return v.length > 0;
    return typeof v === 'string' && v.trim().length > 0;
  };

  const filledCount = sections.reduce(
    (sum, s) => sum + s.fields.filter((f) => isFilled(f)).length,
    0,
  );
  const totalCount = sections.reduce((sum, s) => sum + s.fields.length, 0);

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Top toolbar */}
      <div className="border-b border-border bg-card px-4 py-3 flex items-center gap-3 flex-shrink-0">
        <div className="flex items-center gap-2 flex-1">
          <Globe className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium text-foreground">企业画像配置</span>
          <span className="text-xs text-muted-foreground">({filledCount}/{totalCount} 项已填)</span>
        </div>
        {/* URL auto-fill + PPT / Word import */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="输入网址，如 www.example.com"
            className="w-32 md:w-48 rounded-md border border-input bg-background px-3 py-1.5 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-ring"
            onKeyDown={(e) => e.key === 'Enter' && handleScrape()}
          />
          <button
            onClick={handleScrape}
            disabled={isLoading || importing !== null || !urlInput.trim()}
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
            onChange={handlePptFileChange}
            className="hidden"
          />
          <button
            onClick={handlePptImport}
            disabled={isLoading || importing !== null}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 text-primary px-3 py-1.5 text-xs font-medium hover:bg-primary/20 disabled:opacity-50 transition-colors"
          >
            {importing === 'ppt' ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FileSpreadsheet className="w-3.5 h-3.5" />
            )}
            {importing === 'ppt' ? '导入中...' : 'PPT导入'}
          </button>
          <input
            ref={docxInputRef}
            type="file"
            accept=".docx"
            onChange={handleDocxFileChange}
            className="hidden"
          />
          <button
            onClick={handleDocxImport}
            disabled={isLoading || importing !== null}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 text-primary px-3 py-1.5 text-xs font-medium hover:bg-primary/20 disabled:opacity-50 transition-colors"
          >
            {importing === 'docx' ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FileText className="w-3.5 h-3.5" />
            )}
            {importing === 'docx' ? '导入中...' : 'Word导入'}
          </button>
        </div>
      </div>

      {/* Section tabs */}
      <div className="border-b border-border bg-card flex flex-shrink-0 overflow-x-auto">
        {sections.map((section) => {
          const Icon = section.icon;
          const isActive = activeSection === section.id;
          return (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
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
          {/* 一、基础信息 */}
          {activeSection === 'basic' && (
            <>
              <FormField
                label="公司全称"
                required
                icon={Building2}
                value={form.fullName}
                onChange={(v) => update('fullName', v)}
                placeholder="例如：漳州新途科技有限公司"
              />
              <div className="grid gap-5 md:grid-cols-2">
                <FormField
                  label="经营地址"
                  icon={MapPin}
                  value={form.address ?? ''}
                  onChange={(v) => update('address', v)}
                  placeholder="例如：福建省漳州市芗城区xxx"
                />
                <FormField
                  label="咨询热线"
                  icon={Phone}
                  value={form.phone ?? ''}
                  onChange={(v) => update('phone', v)}
                  placeholder="例如：400-xxx-xxxx"
                  hint="将出现在文章末尾联系方式中"
                />
              </div>
              <TextAreaField
                label="公司简介（一句话描述）"
                required
                icon={FileText}
                value={form.description}
                onChange={(v) => update('description', v)}
                placeholder="用一句话概括公司的核心业务和价值主张"
                rows={2}
              />

              <SectionNote text="以下为补充信息，录入表未要求，用于优化方案与内容生成" />
              <div className="grid gap-5 md:grid-cols-2">
                <FormField
                  label="公司简称"
                  icon={Building2}
                  value={form.shortName}
                  onChange={(v) => update('shortName', v)}
                  placeholder="例如：新途科技"
                />
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
                  placeholder="例如：漳州"
                />
                <FormField
                  label="成立年份"
                  icon={Calendar}
                  value={form.foundedYear ?? ''}
                  onChange={(v) => update('foundedYear', v)}
                  placeholder="例如：2015"
                />
              </div>
            </>
          )}

          {/* 公司介绍 */}
          {activeSection === 'intro' && (
            <>
              <TextAreaField
                label="企业介绍"
                icon={Briefcase}
                value={form.enterpriseIntro ?? ''}
                onChange={(v) => update('enterpriseIntro', v)}
                placeholder="介绍公司的发展历程、主营业务、行业地位等"
                rows={5}
              />
              <TextAreaField
                label="团队实力"
                icon={Users}
                value={form.teamStrength ?? ''}
                onChange={(v) => update('teamStrength', v)}
                placeholder="团队规模、核心成员背景、技术或行业经验等"
                rows={4}
              />
              <TextAreaField
                label="服务优势"
                icon={Layers}
                value={form.serviceAdvantages ?? ''}
                onChange={(v) => update('serviceAdvantages', v)}
                placeholder="相比同行的服务优势，如响应速度、交付流程、售后保障等"
                rows={4}
              />
              <TextAreaField
                label="经营理念"
                icon={Target}
                value={form.businessPhilosophy ?? ''}
                onChange={(v) => update('businessPhilosophy', v)}
                placeholder="企业的价值观、经营宗旨、长期目标等"
                rows={3}
              />
            </>
          )}

          {/* 二、产品/服务版块 */}
          {activeSection === 'products' && (
            <>
              <TextAreaField
                label="推广核心产品或服务"
                required
                icon={Package}
                value={form.productsText}
                onChange={(v) => update('productsText', v)}
                placeholder={'每行一个，格式：产品名：简要说明\n例如：\nGEO生成式引擎优化：面向AI搜索的内容与品牌优化服务\nSEO搜索引擎优化：传统搜索引擎排名提升'}
                rows={5}
                hint="基准：符合客户需求。可从应用场景类、特性类两个角度描述"
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
                hint="补充字段，录入表未要求"
              />
            </>
          )}

          {/* 三、信任背书板块 */}
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
                hint="每行一条，也可使用顿号或逗号分隔"
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

          {/* 四、合作案例板块 */}
          {activeSection === 'cases' && (
            <>
              <TextAreaField
                label="实际案例"
                icon={Target}
                value={form.caseStudiesText ?? ''}
                onChange={(v) => update('caseStudiesText', v)}
                placeholder={'每行一个案例，格式：客户/项目名称：成果或亮点\n例如：\n某汽车贴膜品牌：3个月内AI搜索品牌提及率提升40%'}
                rows={6}
                hint="基准：越多越好，每行一条"
              />
              <div className="grid gap-5 md:grid-cols-2">
                <TextAreaField
                  label="案例行业分类"
                  icon={Layers}
                  value={form.caseIndustriesText ?? ''}
                  onChange={(v) => update('caseIndustriesText', v)}
                  placeholder={'每行一个，例如：\n汽车后市场\n教育培训\n本地生活'}
                  rows={3}
                />
                <TextAreaField
                  label="录入标准"
                  icon={FileText}
                  value={form.caseEntryStandard ?? ''}
                  onChange={(v) => update('caseEntryStandard', v)}
                  placeholder="说明哪些案例可以录入，例如：需有可验证的成果数据、客户授权可公开等"
                  rows={3}
                />
              </div>
            </>
          )}

          {/* AI名片 + 六、其他板块 */}
          {activeSection === 'misc' && (
            <>
              <div className="grid gap-5 md:grid-cols-3">
                <FormField
                  label="网址（官网）"
                  icon={Link2}
                  value={form.website}
                  onChange={(v) => update('website', v)}
                  placeholder="没有填“无”"
                />
                <FormField
                  label="电话"
                  icon={Phone}
                  value={form.phone ?? ''}
                  onChange={(v) => update('phone', v)}
                  placeholder="例如：400-xxx-xxxx"
                />
                <FormField
                  label="邮箱"
                  icon={Mail}
                  value={form.email ?? ''}
                  onChange={(v) => update('email', v)}
                  placeholder="例如：contact@example.com"
                />
              </div>

              <SectionNote text="产品详细解读 —— 基准：产品详细解读，逐个产品填写" />
              <div className="space-y-4">
                {(form.productDetails ?? []).map((product, index) => (
                  <div key={index} className="rounded-lg border border-border bg-card p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-medium text-foreground">
                        产品 {index + 1}
                      </span>
                      <button
                        onClick={() => removeProductDetail(index)}
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        删除
                      </button>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <FormField
                        label="名称"
                        required
                        value={product.name}
                        onChange={(v) => updateProductDetail(index, 'name', v)}
                        placeholder="产品名称"
                      />
                      <FormField
                        label="别称或下属小分类产品"
                        value={product.alias ?? ''}
                        onChange={(v) => updateProductDetail(index, 'alias', v)}
                        placeholder="例如：XX系列 / 子型号"
                      />
                      <FormField
                        label="规格"
                        value={product.spec ?? ''}
                        onChange={(v) => updateProductDetail(index, 'spec', v)}
                        placeholder="例如：500ml/瓶、标准版/企业版"
                      />
                      <FormField
                        label="价格"
                        value={product.price ?? ''}
                        onChange={(v) => updateProductDetail(index, 'price', v)}
                        placeholder="例如：2999元/年"
                      />
                    </div>
                    <div className="grid gap-4 md:grid-cols-2 mt-4">
                      <TextAreaField
                        label="性能优势特点"
                        value={product.advantages ?? ''}
                        onChange={(v) => updateProductDetail(index, 'advantages', v)}
                        placeholder="相比竞品的性能优势、核心卖点"
                        rows={3}
                      />
                      <TextAreaField
                        label="应用场景或详细内容"
                        value={product.scenarios ?? ''}
                        onChange={(v) => updateProductDetail(index, 'scenarios', v)}
                        placeholder="适用的场景、使用方法或详细说明"
                        rows={3}
                      />
                    </div>
                  </div>
                ))}
                <button
                  onClick={addProductDetail}
                  className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-4 py-2 text-xs font-medium text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  添加产品
                </button>
              </div>

              <TextAreaField
                label="规避清单"
                icon={ShieldAlert}
                value={form.avoidKeywordsText ?? ''}
                onChange={(v) => update('avoidKeywordsText', v)}
                placeholder={'需要规避的行业敏感词语，每行一个；没有则留空\n例如：最、第一、国家级、绝对'}
                rows={3}
                hint="没有需要规避的词语则不需要填写"
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
            const filled = s.fields.filter((f) => isFilled(f)).length;
            return (
              <span key={s.id} className="text-xs text-muted-foreground hidden md:inline">
                {s.label}: {filled}/{s.fields.length}
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

function SectionNote({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <span className="h-px flex-1 bg-border" />
      <span className="text-xs text-muted-foreground">{text}</span>
      <span className="h-px flex-1 bg-border" />
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
  icon?: React.ComponentType<{ className?: string }>;
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
  icon?: React.ComponentType<{ className?: string }>;
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
