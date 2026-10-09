import type { ContentGenerationConfig, SessionData } from '@zemingengine/shared';

export function renderManual(session: SessionData): string {
  const now = new Date().toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const frontmatterDate = new Date().toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).replace(/\//g, '/');
  const productName = getProductName(session);

  return `---
created: ${frontmatterDate}
updated: ${frontmatterDate}
---

# ${productName} 产品推广实操手册

> 本手册基于已整理的企业、产品、关键词和资料信息，为 ${productName} 制定内容推广执行方案。
> 生成日期：${now}
> GEO：Generative Engine Optimization，即生成式引擎优化，是伴随生成式 AI 技术规模化应用诞生的新一代数字营销优化体系。

---

## 目录

1. [推广目标与定位](#推广目标与定位)
2. [企业与产品信息](#企业与产品信息)
3. [关键词策略](#关键词策略)
4. [知识库内容准备](#知识库内容准备)
5. [图片素材准备](#图片素材准备)
6. [内容生成实操](#内容生成实操)
7. [渠道发布策略](#渠道发布策略)
8. [效果追踪与优化](#效果追踪与优化)
9. [12大平台文章生成提示词](#12大平台文章生成提示词)

---

## 推广目标与定位

### 核心推广信息

| 项目 | 内容 |
|-----|------|
| **产品名称** | ${session.promotionGoal.productName || productName} |
| **产品定位** | ${session.promotionGoal.positioning || session.enterprise.description || '未填写'} |
| **核心价值** | ${session.promotionGoal.coreValue || '未配置'} |
| **目标用户** | ${session.promotionGoal.targetUsers || '未配置'} |
| **核心卖点** | ${session.promotionGoal.coreSellingPoint || '未配置'} |

### 目标人群分层

${renderAudienceSegments(session)}

---

## 企业与产品信息

### 基础信息

| 字段 | 填写内容 |
|-----|---------|
| **资料名称** | ${productName} 产品推广资料 |
| **公司全称** | ${session.enterprise.fullName || '未填写'} |
| **公司简称** | ${session.enterprise.shortName || '未填写'} |
| **公司规模** | ${session.enterprise.scale || '未填写'} |
| **所属行业** | ${getIndustry(session)} |
| **所在地区** | ${session.enterprise.location || '未填写'} |
| **公司网站** | ${session.enterprise.website || '未填写'} |

### 企业简介

\`\`\`
${session.enterprise.description || '暂未配置'}
\`\`\`

### 产品描述

${renderProductDescriptions(session)}

### 产品优势

${renderProductAdvantages(session)}

### 品牌故事

\`\`\`
${session.enterprise.brandStory || '暂未配置'}
\`\`\`

### 信任背书

${renderList(session.enterprise.trustAnchors, '暂未配置')}

### 用户痛点

${renderList(session.enterprise.userPainPoints, '暂未配置')}

### 客户案例

${renderCustomerCasePlaceholder(session)}

### 品牌调性

\`${session.enterprise.brandTone.join(' + ') || '专业严谨 + 科技创新 + 务实高效'}\`

---

## 关键词策略

### 核心关键词分类

${renderKeywordCategories(session)}

### 关键词扩展配置

**主关键词**：${session.keywordStrategy.distillation.seedKeyword || session.wordBank.industryTerms[0] || productName}

**生成配置**：
- 生成数量：${session.keywordStrategy.distillation.quantity || 30}个
- 生成方式：${session.keywordStrategy.distillation.mode || '精准模式'}
- 问题类型：${session.keywordStrategy.distillation.questionTypes.join('、') || '疑问句、推荐型、对比型、教程型、案例型'}

**生成示例关键词**：

${renderKeywordTable(session)}

### 自动组合配置

${renderCombinationConfigs(session)}

### 关键词库管理建议

${renderKeywordMappings(session)}

---

## 知识库内容准备

### 必备文档清单

${renderKnowledgePlan(session)}

### 文档内容要点

${renderDocumentPoints(session)}

### 文档标签设置

${renderDocumentTags(session)}

---

## 图片素材准备

### 必备图片清单

${renderImagePlan(session)}

### 截图注意事项

1. 使用示例数据：避免暴露真实客户数据
2. 保持界面整洁：关闭无关窗口和标签
3. 添加标注：使用标注框突出重点功能
4. 确保清晰：使用高清截图，避免模糊

---

## 内容生成实操

### 内容制作流程

\`\`\`
1. 确定目标人群和核心关键词
   ↓
2. 选择内容类型和发布渠道
   ↓
3. 引用产品资料、案例和 FAQ
   ↓
4. 生成初稿并补充真实数据
   ↓
5. 人工审核优化
   ↓
6. 按渠道发布并记录效果
\`\`\`

### 不同内容类型的生成配置

${renderContentPlaybook(session)}

---

## 渠道发布策略

### 平台选择与内容策略

${renderPlatformTable(session)}

### 内容矩阵策略

**第一层：深度内容（公众号、知乎）**
- 目标：建立品牌权威，获取精准客户
- 内容：产品深度解析、客户案例、行业洞察
- 频率：每周1-2篇

**第二层：教程内容（CSDN、掘金）**
- 目标：技术用户转化，产品功能展示
- 内容：使用教程、功能详解、技术原理解析
- 频率：每周1-2篇

**第三层：轻量内容（今日头条、百家号）**
- 目标：扩大曝光，获取流量
- 内容：快速上手、产品亮点、行业科普
- 频率：每周3-4篇

**第四层：社交内容（即刻、微博、B站）**
- 目标：互动讨论，品牌传播
- 内容：使用心得、行业观点、互动话题
- 频率：每周5-7条

### 跨平台内容复用策略

| 原平台 | 可复用平台 | 需要调整 |
|-------|-----------|---------|
| 公众号深度文 | 今日头条、百家号 | 简化内容，增加新闻性 |
| CSDN教程 | 掘金、36氪 | 增加技术分析深度 |
| 知乎问答 | InfoQ、钛媒体 | 增加企业视角 |

---

## 效果追踪与优化

### 追踪指标

${renderTrackingMetrics(session)}

### 优化策略

**周度复盘**：
${renderList(session.trackingPlan.weeklyReview, '暂未配置')}

**内容优化**：
${renderList(session.trackingPlan.contentOptimization, '暂未配置')}

**关键词优化**：
${renderList(session.trackingPlan.keywordOptimization, '暂未配置')}

**平台优化**：
${renderList(session.trackingPlan.platformOptimization, '暂未配置')}

---

## 附录：快速检查清单

### 发布前检查
${renderChecklist(session.trackingPlan.publishChecklist)}

### 每周检查
${renderChecklist(session.trackingPlan.weeklyChecklist)}

---

## 12大平台文章生成提示词

${renderPrompts(session)}

---

## 提示词使用说明

### 提示词应用流程

\`\`\`
1. 确定目标平台
   ↓
2. 选择对应的提示词模板
   ↓
3. 根据具体主题调整内容
   ↓
4. 填入关键词和搜索问题
   ↓
5. 生成内容并审核
   ↓
6. 根据平台特点进一步优化
\`\`\`

### 内容适配检查清单

- [ ] 内容风格符合平台调性
- [ ] 标题格式符合平台规范
- [ ] 关键词自然融入
- [ ] 无敏感词汇
- [ ] 长度符合平台要求
- [ ] 引用数据来源可靠（如需要）
- [ ] 有明确的行动呼吁或结尾

---

*本手册由 芯图引擎：GEO 自动生成。*
`;
}

function getProductName(session: SessionData): string {
  return session.promotionGoal.productName
    || session.enterprise.products[0]?.name
    || session.enterprise.shortName
    || session.enterprise.fullName
    || '未命名产品';
}

function getIndustry(session: SessionData): string {
  return session.wordBank.industryTerms[0] || session.enterprise.products[0]?.category || '未填写';
}

function renderList(items: string[], fallback: string): string {
  return items.length > 0 ? items.map((item, index) => `${index + 1}. ${item}`).join('\n') : fallback;
}

function renderChecklist(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- [ ] ${item}`).join('\n') : '- [ ] 暂未配置';
}

function renderAudienceSegments(session: SessionData): string {
  if (session.audienceSegments.length === 0) return '暂未配置';
  const rows = session.audienceSegments
    .map((item) => `| **${item.level}** | ${item.audience} | ${item.painPoint} | ${item.platforms.join('、')} |`)
    .join('\n');
  return `| 层级 | 目标人群 | 核心痛点 | 触达平台 |
|-----|---------|---------|---------|
${rows}`;
}

function renderProductDescriptions(session: SessionData): string {
  if (session.enterprise.products.length === 0) return '暂未配置';
  return session.enterprise.products
    .map((product, index) => `${index + 1}. **${product.name}**：${product.description || product.category || '暂未配置描述'}`)
    .join('\n');
}

function renderProductAdvantages(session: SessionData): string {
  const configured = session.promotionGoal.coreValue
    ? session.promotionGoal.coreValue.split(/[+＋]/).map((item) => item.trim()).filter(Boolean)
    : [];
  const fallback = [
    session.enterprise.products[0]?.description,
    session.wordBank.industryTerms[0] ? `聚焦${session.wordBank.industryTerms[0]}场景` : '',
    session.enterprise.userPainPoints[0] ? `解决${session.enterprise.userPainPoints[0]}` : '',
    session.enterprise.trustAnchors[0],
  ].filter((item): item is string => Boolean(item));
  return renderList(configured.length > 0 ? configured : fallback, '暂未配置');
}

function renderCustomerCasePlaceholder(session: SessionData): string {
  const caseDocs = session.knowledgePlan.filter((doc) => /案例|客户/.test(doc.documentType));
  if (caseDocs.length === 0) return '暂未配置';
  return caseDocs
    .map((doc) => `- ${doc.documentType}：建议补充客户背景、使用前痛点、解决方案、使用后效果数据和客户评价。`)
    .join('\n');
}

function renderKeywordCategories(session: SessionData): string {
  if (session.keywordStrategy.categories.length === 0) return '暂未配置';
  const rows = session.keywordStrategy.categories
    .map((item) => `| **${item.category}** | ${item.examples.join('、')} | ${item.generationMethod} |`)
    .join('\n');
  return `| 分类 | 关键词示例 | 生成方式 |
|-----|-----------|---------|
${rows}`;
}

function renderKeywordTable(session: SessionData): string {
  if (session.keywords.length === 0) return '暂未配置';
  const rows = session.keywords
    .slice(0, 8)
    .map((keyword) => `| ${keyword.type} | ${keyword.question} |`)
    .join('\n');
  return `| 类型 | 关键词 |
|-----|-------|
${rows}`;
}

function renderCombinationConfigs(session: SessionData): string {
  if (session.keywordStrategy.combinations.length === 0) return '暂未配置';
  return session.keywordStrategy.combinations
    .map((config, index) => `**配置${index + 1}：${config.name}**
\`\`\`
前缀词库：${config.prefixes.join(' ')}
主关键词：${config.mainKeywords.join('、')}
后缀词库：${config.suffixes.join(' ')}
\`\`\``)
    .join('\n\n');
}

function renderKeywordMappings(session: SessionData): string {
  if (session.keywordStrategy.questionMappings.length === 0) return '暂未配置';
  const rows = session.keywordStrategy.questionMappings
    .map((item) => `| ${item.keyword} | ${item.question} |`)
    .join('\n');
  return `| 关键词 | 建议搜索问题 |
|-------|------------|
${rows}`;
}

function renderKnowledgePlan(session: SessionData): string {
  if (session.knowledgePlan.length === 0) return '暂未配置';
  const rows = session.knowledgePlan
    .map((doc) => `| ${doc.priority} | ${doc.documentType} | ${doc.filename} | ${doc.purpose} |`)
    .join('\n');
  return `| 优先级 | 文档类型 | 文件名建议 | 用途 |
|-------|---------|-----------|------|
${rows}`;
}

function renderDocumentPoints(session: SessionData): string {
  const docs = session.knowledgePlan.filter((doc) => doc.contentPoints && doc.contentPoints.length > 0);
  if (docs.length === 0) return '暂未配置';
  return docs
    .map((doc) => `**${doc.documentType}应包含**：
\`\`\`
${doc.contentPoints?.map((point) => `- ${point}`).join('\n')}
\`\`\``)
    .join('\n\n');
}

function renderDocumentTags(session: SessionData): string {
  if (session.knowledgePlan.length === 0) return '暂未配置';
  const rows = session.knowledgePlan
    .map((doc) => `| ${doc.documentType} | ${doc.tags.map((tag) => `#${tag}`).join(' ')} |`)
    .join('\n');
  return `| 文档类型 | 建议标签 |
|---------|---------|
${rows}`;
}

function renderImagePlan(session: SessionData): string {
  if (session.imagePlan.length === 0) return '暂未配置';
  const rows = session.imagePlan
    .map((image) => `| ${image.imageType} | ${image.filename} | ${image.size} | ${image.purpose} |`)
    .join('\n');
  return `| 图片类型 | 文件名建议 | 尺寸 | 用途 |
|---------|-----------|------|------|
${rows}`;
}

function renderContentPlaybook(session: SessionData): string {
  if (session.contentPlaybook.length === 0) return '暂未配置';
  return session.contentPlaybook.map(renderContentConfig).join('\n\n');
}

function renderContentConfig(config: ContentGenerationConfig): string {
  return `#### ${config.contentType}

**适用关键词**：${config.suitableKeywords.join('、') || '待补充'}

**生成参数**：
- 文章类型：${config.articleType}
- 文章长度：${config.articleLength}
- 内容风格：${config.style}

**示例标题**：
${renderList(config.titleExamples, '暂未配置')}`;
}

function renderPlatformTable(session: SessionData): string {
  if (session.platforms.length === 0) return '暂未配置';
  const rows = session.platforms
    .map((platform) => `| **${platform.platform}** | ${platform.adaptations.join('、') || platform.focus} | ${platform.frequency || '待定'} | ${platform.publishTime || '待定'} | ${platform.tone || '待定'} |`)
    .join('\n');
  return `| 平台 | 内容类型 | 发布频率 | 最佳时段 | 适合调性 |
|-----|---------|---------|---------|---------|
${rows}`;
}

function renderTrackingMetrics(session: SessionData): string {
  if (session.trackingPlan.metrics.length === 0) return '暂未配置';
  const rows = session.trackingPlan.metrics
    .map((metric) => `| **${metric.metricType}** | ${metric.metric} | ${metric.target} |`)
    .join('\n');
  return `| 指标类型 | 具体指标 | 目标值 |
|---------|---------|-------|
${rows}`;
}

function renderPrompts(session: SessionData): string {
  if (session.prompts.length === 0) return '暂未配置';
  return session.prompts
    .map((prompt, index) => `### ${index + 1}. ${prompt.platform}

\`\`\`
${prompt.prompt}
\`\`\``)
    .join('\n\n---\n\n');
}
