import { Package, Users } from 'lucide-react';
import type { EnterpriseProfile, Product } from '@zemingengine/shared';

interface FormProductBrandProps {
  data: Partial<EnterpriseProfile>;
  onChange: (field: keyof EnterpriseProfile, value: any) => void;
}

export function FormProductBrand({ data, onChange }: FormProductBrandProps) {
  // products 数组转为文本（每行一个）
  const productsText = (data.products || [])
    .map((p: Product) => p.name)
    .join('\n');

  const handleProductsChange = (text: string) => {
    const products: Product[] = text
      .split('\n')
      .filter((line) => line.trim())
      .map((name, index) => ({
        name: name.trim(),
        description: '',
        category: '',
        isPrimary: index === 0,
      }));
    onChange('products', products);
  };

  const painPointsText = (data.userPainPoints || []).join('\n');

  const handlePainPointsChange = (text: string) => {
    const points = text
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => line.trim());
    onChange('userPainPoints', points);
  };

  return (
    <div className="space-y-5">
      {/* 核心产品/服务 */}
      <div>
        <label className="flex items-center gap-2 text-sm font-medium text-foreground mb-1.5">
          <Package className="w-4 h-4 text-muted-foreground" />
          核心产品/服务
          <span className="text-error">*</span>
        </label>
        <textarea
          value={productsText}
          onChange={(e) => handleProductsChange(e.target.value)}
          rows={5}
          placeholder="每行一个，第一行将作为主要产品"
          className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-y min-h-[120px]"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          每行一个，第一行将作为主要产品
        </p>
      </div>

      {/* 品牌故事 */}
      <div>
        <label className="flex items-center gap-2 text-sm font-medium text-foreground mb-1.5">
          品牌故事
          <span className="text-error">*</span>
        </label>
        <textarea
          value={data.brandStory || ''}
          onChange={(e) => onChange('brandStory', e.target.value)}
          rows={6}
          placeholder="请描述品牌的创立背景、发展历程、核心价值..."
          className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-y min-h-[150px]"
        />
      </div>

      {/* 用户痛点 */}
      <div>
        <label className="flex items-center gap-2 text-sm font-medium text-foreground mb-1.5">
          <Users className="w-4 h-4 text-muted-foreground" />
          用户痛点
        </label>
        <textarea
          value={painPointsText}
          onChange={(e) => handlePainPointsChange(e.target.value)}
          rows={4}
          placeholder="每行一个痛点"
          className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-y min-h-[100px]"
        />
      </div>
    </div>
  );
}
