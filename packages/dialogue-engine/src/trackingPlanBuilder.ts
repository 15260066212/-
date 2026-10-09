import type { TrackingPlan } from '@zemingengine/shared';

export function buildTrackingPlan(): TrackingPlan {
  return {
    metrics: [
      { metricType: '内容产出', metric: '每周文章数量', target: '10-15篇' },
      { metricType: '平台覆盖', metric: '发布平台数量', target: '8-12个' },
      { metricType: '曝光量', metric: '各平台总阅读量', target: '持续增长' },
      { metricType: '互动率', metric: '点赞+评论+收藏/阅读量', target: '>3%' },
      { metricType: '转化率', metric: '官网访问/阅读量', target: '>5%' },
      { metricType: '注册量', metric: '新用户注册', target: '持续增长' },
    ],
    weeklyReview: [
      '分析上周各平台阅读、互动、收藏和转化数据',
      '识别表现好的内容类型、标题结构和关键词',
      '调整下周内容选题、平台优先级和发布时间',
      '将高表现文章沉淀为知识库案例或FAQ素材',
    ],
    contentOptimization: [
      '复盘阅读量高的文章标题、结构和开头方式',
      '优化标题、封面图和首屏摘要',
      '增加知识库中的数据、案例、截图和引用来源',
      '针对不同平台调整语气、段落长度和行动呼吁',
    ],
    keywordOptimization: [
      '分析关键词带来的阅读量、搜索曝光和转化效果',
      '删除长期无曝光或无转化的低价值关键词',
      '添加新的痛点词、对比词、教程词和案例词',
      '维护关键词到搜索问题的映射关系',
    ],
    platformOptimization: [
      '对比各平台曝光、互动和转化表现',
      '提高高转化平台的发布频率',
      '降低低质量流量平台的投入',
      '根据平台反馈调整内容类型和发布时间',
    ],
    publishChecklist: [
      '内容已人工审核',
      '封面图已设置',
      '标题符合平台规范',
      '无敏感词汇',
      '关键词自然融入',
      '配有相关图片',
    ],
    weeklyChecklist: [
      '分析上周数据',
      '识别高价值内容',
      '生成新关键词',
      '更新知识库',
      '规划下周内容',
    ],
  };
}
