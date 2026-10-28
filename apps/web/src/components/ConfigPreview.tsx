import { useState } from 'react';
import type { SessionData } from '@zemingengine/shared';
import { STAGE_DISPLAY_NAMES, STAGES } from '@zemingengine/shared';

interface Props {
  sessionData: SessionData | null;
  onExportJson?: () => void;
}

export function ConfigPreview({ sessionData, onExportJson }: Props) {
  if (!sessionData) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400 text-sm">
        开始对话后，配置预览将在这里显示
      </div>
    );
  }

  const {
    enterprise,
    keywords,
    wordBank,
    knowledgeBase,
    prompts,
    platforms,
    currentStage,
    promotionGoal,
    audienceSegments,
    keywordStrategy,
    knowledgePlan,
    imagePlan,
    contentPlaybook,
    trackingPlan,
  } = sessionData;

  // Determine which sections have data
  const hasEnterprise = !!(enterprise.fullName || enterprise.description);
  const hasKeywords = keywords.length > 0;
  const hasWordBank =
    wordBank.brandTerms.length > 0 ||
    wordBank.productTerms.length > 0 ||
    wordBank.industryTerms.length > 0 ||
    wordBank.prefixes.length > 0 ||
    wordBank.suffixes.length > 0;
  const hasKnowledge =
    knowledgeBase.documents.length > 0 ||
    knowledgeBase.tags.length > 0 ||
    (knowledgeBase.sources?.length ?? 0) > 0 ||
    !!knowledgeBase.card;
  const hasPrompts = prompts.length > 0;
  const hasPlatforms = platforms.length > 0;
  const hasManualPlan =
    !!promotionGoal.productName ||
    audienceSegments.length > 0 ||
    keywordStrategy.categories.length > 0 ||
    knowledgePlan.length > 0 ||
    imagePlan.length > 0 ||
    contentPlaybook.length > 0 ||
    trackingPlan.metrics.length > 0;

  // Auto-expand the current stage section
  const currentStageIndex = STAGES.findIndex((stage) => stage === currentStage);

  return (
    <div className="p-4 space-y-3 overflow-y-auto h-full">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold text-gray-800">配置预览</h2>
        {onExportJson && (
          <button
            onClick={onExportJson}
            className="text-xs text-blue-500 hover:text-blue-700 transition-colors"
            title="导出 JSON"
          >
            <svg className="w-4 h-4 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            JSON
          </button>
        )}
      </div>

      <CollapsibleSection
        title="手册章节预览"
        icon="🧾"
        count={getManualSections(sessionData).filter((section) => section.done).length}
        defaultOpen={hasManualPlan}
        hasData={hasManualPlan}
      >
        <div className="space-y-1">
          {getManualSections(sessionData).map((section, i) => (
            <div key={section.title} className="flex items-center gap-2 text-sm">
              <span className={`h-2 w-2 rounded-full ${section.done ? 'bg-green-400' : 'bg-gray-200'}`} />
              <span className="w-4 text-xs text-gray-400">{i + 1}</span>
              <span className={section.done ? 'text-gray-700' : 'text-gray-400'}>{section.title}</span>
            </div>
          ))}
        </div>
      </CollapsibleSection>

      {/* 1. Enterprise Profile */}
      <CollapsibleSection
        title="企业画像"
        icon="🏢"
        defaultOpen={currentStageIndex >= 1 || hasEnterprise}
        hasData={hasEnterprise}
      >
        <Field label="公司全称" value={enterprise.fullName} />
        <Field label="公司简称" value={enterprise.shortName} />
        <Field label="一句话描述" value={enterprise.description} />
        <Field label="公司规模" value={enterprise.scale} />
        <Field label="所在地" value={enterprise.location} />
        <Field label="官网" value={enterprise.website} />
        {enterprise.products.length > 0 && (
          <Field label="核心产品" value={enterprise.products.map((p) => p.name).join('、')} />
        )}
        {enterprise.brandStory && (
          <Field label="品牌故事" value={enterprise.brandStory} truncate />
        )}
        {enterprise.trustAnchors.length > 0 && (
          <Field label="信任锚点" value={enterprise.trustAnchors.join('、')} />
        )}
        {enterprise.brandTone.length > 0 && (
          <Field label="品牌调性" value={enterprise.brandTone.join('、')} />
        )}
      </CollapsibleSection>

      {/* 2. Keywords */}
      <CollapsibleSection
        title="关键词"
        icon="🔑"
        count={keywords.length}
        defaultOpen={currentStageIndex >= 2 && currentStageIndex <= 3}
        hasData={hasKeywords}
      >
        {keywords.map((kw, i) => (
          <div key={i} className="text-sm text-gray-600 mb-2">
            <div className="flex items-start gap-1">
              <span className="text-gray-400 shrink-0">#{i + 1}</span>
              <span>{kw.question}</span>
            </div>
            <div className="text-xs text-gray-400 ml-5">
              类型：{kw.type} · 优先级：{kw.priority}
            </div>
          </div>
        ))}
      </CollapsibleSection>

      {/* 3. WordBank */}
      <CollapsibleSection
        title="词库"
        icon="📚"
        defaultOpen={currentStageIndex >= 3 && currentStageIndex <= 4}
        hasData={hasWordBank}
      >
        {wordBank.brandTerms.length > 0 && (
          <TermGroup label="品牌词" terms={wordBank.brandTerms} color="blue" />
        )}
        {wordBank.productTerms.length > 0 && (
          <TermGroup label="产品词" terms={wordBank.productTerms} color="green" />
        )}
        {wordBank.industryTerms.length > 0 && (
          <TermGroup label="行业词" terms={wordBank.industryTerms} color="purple" />
        )}
        {wordBank.prefixes.length > 0 && (
          <TermGroup label="前缀" terms={wordBank.prefixes} color="blue" />
        )}
        {wordBank.suffixes.length > 0 && (
          <TermGroup label="后缀" terms={wordBank.suffixes} color="green" />
        )}
      </CollapsibleSection>

      {/* 4. Knowledge Base */}
      <CollapsibleSection
        title="企业知识库（三层）"
        icon="📖"
        defaultOpen={currentStageIndex >= 4 && currentStageIndex <= 5}
        hasData={hasKnowledge}
      >
        {knowledgeBase.card && (
          <div className="mb-2 rounded border border-blue-100 bg-blue-50/60 p-2">
            <div className="flex items-center gap-1 mb-1">
              <span className="px-1 py-0.5 bg-blue-600 text-white rounded text-xs">L3</span>
              <span className="text-xs font-medium text-gray-700">AI 名片 · 每篇必引</span>
              <span className="ml-auto px-1 py-0.5 bg-white text-blue-600 rounded text-xs">
                引用 {knowledgeBase.card.source.usageCount} 次
              </span>
            </div>
            <div className="text-sm text-gray-800 font-medium truncate">{knowledgeBase.card.companyName}</div>
            <div className="text-xs text-gray-600 mt-0.5 line-clamp-2">{knowledgeBase.card.description}</div>
            {(knowledgeBase.card.coreProducts?.length ?? 0) > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {knowledgeBase.card.coreProducts!.slice(0, 3).map((p, i) => (
                  <span key={i} className="px-1.5 py-0.5 bg-white text-gray-600 rounded text-xs">{p}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {(knowledgeBase.sources?.length ?? 0) > 0 && (
          <div className="mb-2">
            <div className="text-xs text-gray-400 mb-1">
              L2 可引用信源（{knowledgeBase.sources!.length} 条）
            </div>
            {knowledgeBase.sources!.map((src, i) => (
              <details key={src.id} className="text-sm text-gray-600 mb-1 group">
                <summary className="flex items-start gap-1 cursor-pointer list-none hover:text-gray-800">
                  <span className="text-gray-400 shrink-0">{i + 1}.</span>
                  <span className="truncate flex-1 text-left">{src.title}</span>
                  <span className="px-1 py-0.5 bg-gray-100 text-gray-500 rounded text-xs shrink-0">{src.type}</span>
                  <span
                    className={`px-1 py-0.5 rounded text-xs shrink-0 ${
                      src.usageCount > 0 ? 'bg-amber-50 text-amber-600' : 'bg-gray-50 text-gray-400'
                    }`}
                  >
                    引用 {src.usageCount}
                  </span>
                  <svg
                    className="w-3.5 h-3.5 text-gray-400 shrink-0 group-open:rotate-180 transition-transform mt-0.5"
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </summary>
                <div className="ml-6 mt-1.5 space-y-1.5 text-xs">
                  {src.sections.map((section, si) => (
                    section.bullets.length > 0 && (
                      <div key={si}>
                        <div className="font-medium text-gray-500">{section.heading}</div>
                        <ul className="list-disc list-inside text-gray-600 space-y-0.5">
                          {section.bullets.map((b, bi) => <li key={bi} className="truncate">{b}</li>)}
                        </ul>
                      </div>
                    )
                  ))}
                  {src.keyFacts.length > 0 && (
                    <div>
                      <div className="font-medium text-amber-600 mt-1">关键事实</div>
                      <ul className="list-disc list-inside text-amber-700/80 space-y-0.5">
                        {src.keyFacts.map((f, fi) => <li key={fi} className="truncate">{f}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              </details>
            ))}
          </div>
        )}

        {knowledgeBase.documents.length > 0 && (
          <div className="mb-2">
            <div className="text-xs text-gray-400 mb-1">文档素材</div>
            {knowledgeBase.documents.map((doc, i) => (
              <details key={i} className="text-sm text-gray-600 mb-1 group">
                <summary className="flex items-start gap-1 cursor-pointer list-none hover:text-gray-800">
                  <span className="text-gray-400 shrink-0">{i + 1}.</span>
                  <span className="truncate flex-1 text-left">{doc.title || doc.content.slice(0, 50)}</span>
                  <span className="px-1 py-0.5 bg-gray-100 text-gray-500 rounded text-xs shrink-0">
                    {doc.type}
                  </span>
                  {(doc.sections?.length ?? 0) > 0 && (
                    <span className="px-1 py-0.5 bg-blue-50 text-blue-600 rounded text-xs shrink-0">
                      Wiki
                    </span>
                  )}
                  <svg
                    className="w-3.5 h-3.5 text-gray-400 shrink-0 group-open:rotate-180 transition-transform mt-0.5"
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </summary>
                {(doc.sections?.length ?? 0) > 0 ? (
                  <div className="ml-6 mt-1.5 space-y-1.5 text-xs">
                    {doc.sections!.map((section, si) => (
                      section.bullets.length > 0 && (
                        <div key={si}>
                          <div className="font-medium text-gray-500">{section.heading}</div>
                          <ul className="list-disc list-inside text-gray-600 space-y-0.5">
                            {section.bullets.map((b, bi) => <li key={bi} className="truncate">{b}</li>)}
                          </ul>
                        </div>
                      )
                    ))}
                    {(doc.keyFacts?.length ?? 0) > 0 && (
                      <div>
                        <div className="font-medium text-amber-600 mt-1">关键事实</div>
                        <ul className="list-disc list-inside text-amber-700/80 space-y-0.5">
                          {doc.keyFacts!.map((f, fi) => <li key={fi} className="truncate">{f}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : (
                  doc.content && doc.content.length > 30 && (
                    <div className="ml-6 mt-1 text-xs text-gray-400 italic truncate">
                      {doc.content.slice(0, 120)}
                    </div>
                  )
                )}
              </details>
            ))}
          </div>
        )}
        {knowledgeBase.tags.length > 0 && (
          <div>
            <div className="text-xs text-gray-400 mb-1">标签</div>
            <div className="flex flex-wrap gap-1">
              {knowledgeBase.tags.map((tag, i) => (
                <span key={i} className="px-2 py-0.5 bg-purple-50 text-purple-600 rounded text-xs">
                  {tag.name}
                </span>
              ))}
            </div>
          </div>
        )}
        {knowledgeBase.images.length > 0 && (
          <div className="mt-2">
            <div className="text-xs text-gray-400 mb-1">图片素材</div>
            {knowledgeBase.images.map((image, i) => (
              <div key={i} className="text-sm text-gray-600 mb-1">
                {image.alt} · {image.category}
              </div>
            ))}
          </div>
        )}
      </CollapsibleSection>

      {/* 5. Prompts */}
      <CollapsibleSection
        title="提示词"
        icon="💬"
        count={prompts.length}
        defaultOpen={currentStageIndex >= 5 && currentStageIndex <= 6}
        hasData={hasPrompts}
      >
        <div className="mb-2 text-xs text-gray-400">12 大平台文章生成提示词</div>
        {prompts.map((p, i) => (
          <div key={i} className="text-sm text-gray-600 mb-2">
            <div className="font-medium text-gray-700">{p.platform}</div>
            <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">{p.prompt}</div>
          </div>
        ))}
      </CollapsibleSection>

      {/* 6. Platforms */}
      <CollapsibleSection
        title="平台策略"
        icon="🌐"
        count={platforms.length}
        defaultOpen={currentStageIndex >= 6}
        hasData={hasPlatforms}
      >
        {platforms.map((p, i) => (
          <div key={i} className="text-sm text-gray-600 mb-2">
            <div className="flex items-center gap-2">
            <span className="text-gray-400 shrink-0">{i + 1}.</span>
            <span className="font-medium">{p.platform}</span>
            <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-xs">
              {p.focus}
            </span>
            </div>
            <div className="ml-5 text-xs text-gray-400">
              {p.frequency || '频率待定'} · {p.publishTime || '时间待定'}
            </div>
          </div>
        ))}
      </CollapsibleSection>

      {/* Progress Footer */}
      <div className="pt-2 border-t border-gray-100">
        <div className="flex items-center justify-between">
          <div className="text-xs text-gray-400">
            当前：{STAGE_DISPLAY_NAMES[currentStage]}
          </div>
          <div className="flex gap-1">
            {STAGES.map((stage, i) => (
              <div
                key={stage}
                className={`w-2 h-2 rounded-full transition-colors ${
                  i < currentStageIndex
                    ? 'bg-green-400'
                    : i === currentStageIndex
                    ? 'bg-blue-500'
                    : 'bg-gray-200'
                }`}
                title={STAGE_DISPLAY_NAMES[stage]}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function getManualSections(sessionData: SessionData) {
  return [
    { title: '推广目标与定位', done: !!sessionData.promotionGoal.productName },
    { title: '企业画像配置', done: !!(sessionData.enterprise.fullName || sessionData.enterprise.description) },
    { title: '关键词策略', done: sessionData.keywordStrategy.categories.length > 0 || sessionData.keywords.length > 0 },
    { title: '知识库内容准备', done: sessionData.knowledgePlan.length > 0 || sessionData.knowledgeBase.documents.length > 0 },
    { title: '图片素材准备', done: sessionData.imagePlan.length > 0 || sessionData.knowledgeBase.images.length > 0 },
    { title: '内容生成实操', done: sessionData.contentPlaybook.length > 0 },
    { title: '多平台发布策略', done: sessionData.platforms.length > 0 },
    { title: '效果追踪与优化', done: sessionData.trackingPlan.metrics.length > 0 },
    { title: '12大平台文章生成提示词', done: sessionData.prompts.length >= 12 },
  ];
}

// Collapsible Section component
function CollapsibleSection({
  title,
  icon,
  count,
  defaultOpen = false,
  hasData = false,
  children,
}: {
  title: string;
  icon: string;
  count?: number;
  defaultOpen?: boolean;
  hasData?: boolean;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className={`rounded-lg border transition-colors ${hasData ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50/50'}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-3 py-2 flex items-center justify-between hover:bg-gray-50 rounded-lg transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm">{icon}</span>
          <span className={`text-sm font-medium ${hasData ? 'text-gray-700' : 'text-gray-400'}`}>
            {title}
          </span>
          {count !== undefined && count > 0 && (
            <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded-full text-xs">
              {count}
            </span>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && (
        <div className="px-3 pb-3 space-y-1">
          {hasData ? children : <div className="text-xs text-gray-400 italic">暂无数据</div>}
        </div>
      )}
    </div>
  );
}

function Field({ label, value, truncate }: { label: string; value: string; truncate?: boolean }) {
  if (!value) return null;
  return (
    <div className="text-sm">
      <span className="text-gray-400">{label}：</span>
      <span className={`text-gray-700 ${truncate ? 'line-clamp-2' : ''}`}>{value}</span>
    </div>
  );
}

function TermGroup({ label, terms, color }: { label: string; terms: string[]; color: 'blue' | 'green' | 'purple' }) {
  const colors = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    purple: 'bg-purple-50 text-purple-600',
  };

  return (
    <div className="mb-2">
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className="flex flex-wrap gap-1">
        {terms.map((term, i) => (
          <span key={i} className={`px-2 py-0.5 rounded text-xs ${colors[color]}`}>
            {term}
          </span>
        ))}
      </div>
    </div>
  );
}
