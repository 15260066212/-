import type { PromptConfig, SessionData } from '@zemingengine/shared';

interface PromptContext {
  productName: string;
  positioning: string;
  coreFunctions: string;
  targetUsers: string;
  brandTone: string;
  keywords: string;
}

function getPromptContext(session: SessionData): PromptContext {
  const productName = session.promotionGoal.productName
    || session.enterprise.products[0]?.name
    || session.enterprise.shortName
    || session.enterprise.fullName
    || '产品';

  return {
    productName,
    positioning: session.promotionGoal.positioning || session.enterprise.description || 'AI驱动的一站式内容营销平台',
    coreFunctions: session.enterprise.products.map((product) => product.description || product.name).filter(Boolean).join('、')
      || '企业画像管理、知识库上传、关键词蒸馏、AI内容生成、多平台发布',
    targetUsers: session.promotionGoal.targetUsers || '企业内容运营人员、市场营销团队、自媒体创作者',
    brandTone: session.enterprise.brandTone.join(' + ') || '专业严谨 + 科技创新 + 务实高效',
    keywords: session.keywords.map((keyword) => keyword.question).join('、') || '内容营销、AI内容生成、多平台发布',
  };
}

function productBlock(context: PromptContext): string {
  return `【产品信息】
- 产品名称：${context.productName}
- 产品定位：${context.positioning}
- 核心功能：${context.coreFunctions}
- 目标用户：${context.targetUsers}
- 品牌调性：${context.brandTone}
- 核心关键词：${context.keywords}`;
}

export function buildPlatformPrompts(session: SessionData): PromptConfig[] {
  const context = getPromptContext(session);
  const product = context.productName;
  const block = productBlock(context);

  return [
    {
      platform: '微信公众号',
      scenario: '深度长文/产品介绍',
      prompt: `你是一位专业的企业内容运营专家，正在为 ${product} 撰写一篇深度长文。

${block}

【写作要求】
1. 文章类型：深度长文/产品介绍
2. 文章长度：2000-3000字
3. 内容风格：专业严谨、有深度、提供实用价值
4. 结构要求：引言提出行业痛点；正文分3-4个小标题深入分析；案例结合真实场景；结语给出行动建议
5. 适配公众号阅读习惯：段落每段3-5句话，适当使用小标题，可引用数据或金句增强说服力
6. 关键词自然融入，不堆砌

【知识库要求】
- 产品能力、案例、数字优先来自知识库
- 缺少事实依据时标注“需补充资料”，不要编造

【避免】
- 过于技术化的术语
- 过度推销，保持客观专业
- 与主题无关的冗长内容`,
    },
    {
      platform: '知乎',
      scenario: '专业问答/深度分析',
      prompt: `你是一位知乎高赞答主，专注于内容营销和SaaS工具领域，正在回答一个关于 ${product} 的问题。

${block}

【回答要求】
1. 回答形式：专业问答 + 深度分析
2. 文章长度：1500-2500字
3. 内容风格：专业客观、数据驱动、有理有据
4. 结构要求：开门见山给出观点；分点深入分析；与竞品或传统方式对比；结合实际案例；总结行动建议
5. 知乎特色：可以使用「」引用关键内容，使用分割线分隔内容块，结尾可提出开放问题引发讨论
6. 数据支撑：尽可能提供具体数字或比例，数字必须来自知识库

【避免】
- 过于主观的个人感受
- 缺乏事实依据的断言
- 纯广告性质的推广`,
    },
    {
      platform: 'CSDN',
      scenario: '技术教程/实操指南',
      prompt: `你是一位技术博主，专注于SaaS工具和企业级应用，正在撰写一篇关于 ${product} 的技术教程或实操指南。

${block}

【目标读者】
技术开发者、技术运营、产品经理，关注技术实现和实操落地。

【写作要求】
1. 文章类型：技术教程/实操指南
2. 文章长度：1500-2500字
3. 内容风格：技术导向、步骤清晰、代码友好
4. 结构要求：前言、技术原理、实操步骤、示例、注意事项、总结
5. CSDN特色：使用Markdown代码块，使用编号列表，技术术语准确，可加入环境要求和依赖说明
6. 实用性优先：读者能够根据文章实际操作

【避免】
- 过于营销化的语言
- 与技术无关的内容
- 步骤不清晰或不完整`,
    },
    {
      platform: '掘金',
      scenario: '技术分析/架构解读',
      prompt: `你是一位掘金技术作者，专注于AI工具和企业技术栈，正在撰写一篇关于 ${product} 的技术分析或架构解读文章。

${block}

【目标读者】
前端开发者、全栈工程师、技术决策者，关注新技术趋势和工程实践。

【写作要求】
1. 文章类型：技术分析/架构解读
2. 文章长度：1500-2000字
3. 内容风格：技术深度、工程思维、前沿视角
4. 结构要求：背景、核心技术、架构设计、技术亮点、实践思考
5. 掘金特色：使用「」引用技术要点，使用**加粗**突出关键技术术语，可用Mermaid图示说明架构

【避免】
- 纯产品功能介绍
- 缺乏技术分析的内容
- 过度营销`,
    },
    {
      platform: '今日头条',
      scenario: '资讯文章/热点结合',
      prompt: `你是一位今日头条资讯作者，专注于科技资讯和企业应用，正在撰写一篇关于 ${product} 的资讯文章。

${block}

【目标读者】
广泛大众、企业主、职场人士，关注科技热点和实用信息。

【写作要求】
1. 文章类型：资讯文章/热点结合
2. 文章长度：1200-1800字
3. 内容风格：新闻化、热点导向、通俗易懂
4. 结构要求：导语用热点或趋势引入；介绍解决方案；分析市场现状；引用行业观点；展望未来
5. 今日头条特色：标题可带数字或热点词，导语3句话内切入主题，语言大众化

【避免】
- 过于技术化的内容
- 缺乏时效性的内容
- 纯广告性质`,
    },
    {
      platform: '百家号',
      scenario: 'SEO文章/科普内容',
      prompt: `你是一位百家号作者，专注于科技产品和工具评测，正在撰写一篇关于 ${product} 的SEO优化文章或科普内容。

${block}

【目标读者】
广泛搜索用户、产品决策者、技术爱好者，通过搜索引擎获取信息。

【写作要求】
1. 文章类型：SEO文章/科普内容
2. 文章长度：1500-2000字
3. 内容风格：信息量大、结构清晰、易于搜索
4. 结构要求：H1包含核心关键词；导语包含关键词；正文3-5个H2；FAQ；结语
5. SEO优化：关键词密度合理，使用同义词和相关词，结构化标记友好

【避免】
- 关键词堆砌
- 内容空洞缺乏实质
- 过度营销`,
    },
    {
      platform: 'B站专栏',
      scenario: '轻松专栏/梗点结合',
      prompt: `你是一位B站UP主，专注于科技工具和效率提升，正在撰写一篇关于 ${product} 的轻松专栏文章。

${block}

【目标读者】
Z世代、年轻职场人、学生党，熟悉网络文化和效率工具。

【写作要求】
1. 文章类型：轻松专栏/梗点结合
2. 文章长度：1200-2000字
3. 内容风格：轻松幽默、网络用语、有梗
4. 结构要求：吸引眼球标题；用网络热词引入；轻松介绍核心功能；结尾引导评论和讨论
5. B站特色：使用【】标注重点，适当使用emoji，营造互动讨论感

【避免】
- 过于严肃正式
- 使用过时网络用语
- 内容过于硬广`,
    },
    {
      platform: '36氪',
      scenario: '行业分析/产品报道',
      prompt: `你是一位36氪作者，专注于企业服务SaaS和科技创新，正在撰写一篇关于 ${product} 的行业分析或产品报道。

${block}

【目标读者】
投资机构、企业决策者、科技从业者，关注行业趋势和商业模式。

【写作要求】
1. 文章类型：行业分析/产品报道
2. 文章长度：1500-2200字
3. 内容风格：行业视角、商业洞察、专业深度
4. 结构要求：导语、行业背景、产品定位、商业模式、行业观点、未来前瞻
5. 36氪特色：重视数据支撑和市场分析，关注商业模式和竞争力

【避免】
- 纯产品功能介绍
- 缺乏行业视角
- 过度营销`,
    },
    {
      platform: 'InfoQ',
      scenario: '技术实践/案例文章',
      prompt: `你是一位InfoQ作者，专注于企业级技术和技术管理，正在撰写一篇关于 ${product} 的技术实践或案例文章。

${block}

【目标读者】
CTO、技术总监、架构师、技术决策者，关注企业级技术解决方案。

【写作要求】
1. 文章类型：技术实践/案例文章
2. 文章长度：1800-2800字
3. 内容风格：技术深度、企业视角、实践导向
4. 结构要求：摘要、背景、方案、实践、结果、经验总结
5. InfoQ特色：强调企业级技术价值，关注技术决策和架构思考，提供实践经验

【避免】
- 过于浅显的技术内容
- 缺乏实践价值
- 纯产品推广`,
    },
    {
      platform: '虎嗅',
      scenario: '商业观察/趋势分析',
      prompt: `你是一位虎嗅作者，专注于科技商业和创业观察，正在撰写一篇关于 ${product} 的商业观察或趋势分析文章。

${block}

【目标读者】
创业者、投资人、企业管理者，关注商业创新和市场机会。

【写作要求】
1. 文章类型：商业观察/趋势分析
2. 文章长度：1500-2500字
3. 内容风格：商业洞察、观点鲜明、批判性思考
4. 结构要求：导语、现象分析、产品视角、竞争格局、观点输出、思考
5. 虎嗅特色：观点明确，重视商业逻辑分析，关注商业本质

【避免】
- 观点模糊或中庸
- 缺乏商业逻辑
- 纯产品介绍`,
    },
    {
      platform: '钛媒体',
      scenario: '科技趋势/创新分析',
      prompt: `你是一位钛媒体作者，专注于科技创新和产业观察，正在撰写一篇关于 ${product} 的科技趋势或创新分析文章。

${block}

【目标读者】
科技从业者、投资人、企业管理者，关注科技创新和产业变革。

【写作要求】
1. 文章类型：科技趋势/创新分析
2. 文章长度：1600-2600字
3. 内容风格：科技前沿、产业深度、创新视角
4. 结构要求：导语、趋势分析、产品创新、产业影响、未来展望、价值思考
5. 钛媒体特色：关注科技与产业结合，重视创新价值和产业影响，可加入国际视角

【避免】
- 缺乏科技视角
- 内容过于浅显
- 纯产品推广`,
    },
  ];
}
