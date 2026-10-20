import { useState, useEffect } from 'react';
import { useSessionStore } from '../stores/sessionStore.js';
import { ConfigHeader } from '../components/geo/ConfigHeader.js';
import { ConfigTabs } from '../components/geo/ConfigTabs.js';
import { FormBasicInfo } from '../components/geo/FormBasicInfo.js';
import { FormProductBrand } from '../components/geo/FormProductBrand.js';
import { FormTrustTone } from '../components/geo/FormTrustTone.js';
import { ConfigFooter } from '../components/geo/ConfigFooter.js';
import type { EnterpriseProfile } from '@zemingengine/shared';

type TabKey = 'basic' | 'product' | 'trust';

const TABS = [
  { key: 'basic', label: '基本信息', completed: 0, total: 4 },
  { key: 'product', label: '产品与品牌', completed: 0, total: 2 },
  { key: 'trust', label: '信任与调性', completed: 0, total: 1 },
];

export function GeoConfigPage() {
  const { sessionData, isLoading, submitUrl, confirmProfileReview } = useSessionStore();
  const [activeTab, setActiveTab] = useState<TabKey>('basic');
  const [localEnterprise, setLocalEnterprise] = useState<Partial<EnterpriseProfile>>({});

  // 从 sessionData 初始化本地编辑状态
  useEffect(() => {
    if (sessionData?.enterprise) {
      setLocalEnterprise(sessionData.enterprise);
    }
  }, [sessionData?.enterprise]);

  // 计算各Tab完成进度
  const basicCompleted = countCompletedFields(localEnterprise, [
    'fullName', 'scale', 'location', 'description',
  ]);
  const productCompleted = countCompletedFields(localEnterprise, [
    'products', 'brandStory',
  ]);
  const trustCompleted = countCompletedFields(localEnterprise, [
    'trustAnchors',
  ]);

  const tabsWithProgress = TABS.map((tab) => {
    if (tab.key === 'basic') return { ...tab, completed: basicCompleted };
    if (tab.key === 'product') return { ...tab, completed: productCompleted };
    if (tab.key === 'trust') return { ...tab, completed: trustCompleted };
    return tab;
  });

  // 处理字段变更 - 更新本地状态
  const handleFieldChange = (field: keyof EnterpriseProfile, value: any) => {
    setLocalEnterprise((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  // 处理 URL 自动填充
  const handleUrlSubmit = async (url: string) => {
    await submitUrl(url);
  };

  // 处理保存并继续 - 将本地编辑状态转为 ProfileReviewRequest 提交后端
  const handleSaveAndContinue = () => {
    if (localEnterprise && localEnterprise.fullName) {
      confirmProfileReview({
        fullName: localEnterprise.fullName || '',
        shortName: localEnterprise.shortName || '',
        description: localEnterprise.description || '',
        scale: localEnterprise.scale || '',
        location: localEnterprise.location || '',
        website: localEnterprise.website || '',
        productsText: (localEnterprise.products || []).map((p) => p.name).join('\n'),
        brandStory: localEnterprise.brandStory || '',
        trustAnchorsText: (localEnterprise.trustAnchors || []).join('\n'),
      });
    }
  };

  const totalCompleted = basicCompleted + productCompleted + trustCompleted;

  return (
    <div className="h-full flex flex-col bg-background">
      {/* ConfigHeader */}
      <ConfigHeader
        title="企业画像配置"
        completedCount={totalCompleted}
        totalCount={7}
        onUrlSubmit={handleUrlSubmit}
        isAutoFilling={isLoading}
      />

      {/* Tabs */}
      <ConfigTabs
        tabs={tabsWithProgress}
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as TabKey)}
      />

      {/* Form Content */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-6">
        <div className="max-w-3xl mx-auto">
          {activeTab === 'basic' && (
            <FormBasicInfo
              data={localEnterprise}
              onChange={handleFieldChange}
            />
          )}
          {activeTab === 'product' && (
            <FormProductBrand
              data={localEnterprise}
              onChange={handleFieldChange}
            />
          )}
          {activeTab === 'trust' && (
            <FormTrustTone
              data={localEnterprise}
              onChange={handleFieldChange}
            />
          )}
        </div>
      </div>

      {/* Footer */}
      <ConfigFooter
        tabProgress={tabsWithProgress.map((t) => ({ label: t.label, completed: t.completed, total: t.total }))}
        onSaveAndContinue={handleSaveAndContinue}
        disabled={isLoading}
      />
    </div>
  );
}

// 辅助函数：计算完成的字段数
function countCompletedFields(
  data: Partial<EnterpriseProfile> | undefined,
  fields: (keyof EnterpriseProfile)[]
): number {
  if (!data) return 0;
  let count = 0;
  for (const field of fields) {
    const value = data[field];
    if (Array.isArray(value)) {
      if (value.length > 0) count++;
    } else if (value && String(value).trim()) {
      count++;
    }
  }
  return count;
}
