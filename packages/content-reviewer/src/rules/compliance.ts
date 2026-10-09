import type { Article, ReviewIssue } from '@zemingengine/shared';

const POLITICAL_SENSITIVE: string[] = [
  '法轮功', '台独', '藏独', '疆独', '港独', '颜色革命',
  '颠覆国家', '分裂国家', '恐怖主义', '极端主义',
  '反华', '反共', '反政府', '敌对势力',
];

const HARMFUL_CONTENT: string[] = [
  '色情', '淫秽', '裸聊', '一夜情', '援交', '卖淫', '嫖娼',
  '赌博', '博彩', '时时彩', '六合彩', '赌场', '下注', '投注',
  '吸毒', '贩毒', '大麻', '冰毒', '摇头丸', 'K粉',
  '枪支', '弹药', '管制刀具', '爆炸物',
  '暴力', '凶杀', '绑架', '勒索',
  '传销', '诈骗', '集资诈骗', '非法集资',
  '造假', '制假售假', '偷税漏税',
  '黑客', '木马', '病毒制作', '网络攻击',
];

const ADVERTISING_LAW_ABSOLUTE: string[] = [
  '最好', '最佳', '最优', '最低价', '最便宜', '最强', '最高级',
  '第一', '唯一', '首个', '首家', '首选', '首屈一指',
  '国家级', '世界级', '顶级', '极品', '至尊', '至臻',
  '领先', '首创', '独家', '绝无仅有', '无与伦比',
  '百分之百', '绝对', '万能', '永久', '终身', '永远',
  '销量第一', '市场份额第一', '排名第一',
  '之王', '之最', '霸主', '王者', '巅峰',
  '史无前例', '空前绝后', '举世无双', '天下第一',
];

const MEDICAL_SENSITIVE: string[] = [
  '包治百病', '药到病除', '根治', '痊愈', '彻底治愈',
  '有效率百分之', '有效率100%', '治愈率100%',
  '祖传秘方', '宫廷秘方', '失传秘方',
  '纯天然无副作用', '无任何副作用', '零副作用',
  '最新技术', '最先进技术', '国际领先技术',
  '神药', '仙丹', '灵丹妙药', '神奇疗效',
  '保证减肥', '快速瘦身', '安全瘦身',
  '增高', '丰胸', '壮阳', '延时',
  '替代药物', '可替代处方药',
];

const FINANCIAL_SENSITIVE: string[] = [
  '保本', '保收益', '保证收益', '稳赚不赔', '零风险',
  '百分百盈利', '必定涨', '必涨', '涨停保证',
  '高收益零风险', '无风险套利', '绝对安全',
  '翻倍', '暴富', '一夜暴富', '快速致富',
  '内部消息', '内幕消息', '内幕交易',
  '代客理财', '代客操盘', '保本理财',
  '荐股', '推荐股票', '牛股推荐', '金股推荐',
  '非法集资', '非法吸收公众存款',
  '资金盘', '庞氏', '拆分盘',
  '加杠杆', '场外配资', '杠杆炒股',
];

const FALSE_ADVERTISING: string[] = [
  '免费试用不满意退款', '无效退款', '不满意全额退款',
  '终身免费', '永久免费', '永远免费',
  '限量抢购只剩', '最后机会', '仅剩最后',
  '错过再等一年', '仅此一次',
  '央视推荐', '明星同款', '国家领导人用',
  '权威认证', '国际认证', '官方指定',
];

const REGEX_PATTERNS: { pattern: RegExp; label: string; severity: 'high' | 'medium' | 'low'; description: string }[] = [
  {
    pattern: /(?:QQ|扣扣|企鹅)[：:\s]*\d{5,12}/i,
    label: 'QQ号',
    severity: 'medium',
    description: '正文中包含QQ号码',
  },
  {
    pattern: /(?:微信|VX|vx|加微)[：:\s]*[a-zA-Z0-9_-]{5,30}/,
    label: '微信号',
    severity: 'medium',
    description: '正文中包含微信号',
  },
  {
    pattern: /(?:电话|手机|tel|phone)[：:\s]*1[3-9]\d{9}/i,
    label: '手机号',
    severity: 'medium',
    description: '正文中包含手机号码',
  },
  {
    pattern: /(?:支付宝|alipay)[：:\s]*[a-zA-Z0-9@._-]{5,30}/i,
    label: '支付宝',
    severity: 'medium',
    description: '正文中包含支付宝账号',
  },
  {
    pattern: /银行卡号|信用卡号|借记卡号/i,
    label: '银行卡',
    severity: 'high',
    description: '正文中提及银行卡号',
  },
  {
    pattern: /[\d]{16,19}$/,
    label: '疑似卡号',
    severity: 'medium',
    description: '检测到疑似银行卡号的数字串',
  },
  {
    pattern: /加我|私聊|扫码|二维码|进群|加群/i,
    label: '引流',
    severity: 'medium',
    description: '检测到引流话术',
  },
  {
    pattern: /(?:优惠券|折扣码|优惠码|promo\s*code)/i,
    label: '优惠券',
    severity: 'low',
    description: '正文中包含优惠券信息',
  },
];

const FALSE_POSITIVE_CONTEXTS: Record<string, string[]> = {
  '第一': ['第一时间', '第一时间', '第一人称', '第一方', '第一步', '第一阶段', '第一印象', '第一部分', '第一章', '第一节', '第一课', '第一次', '第一天', '第一年', '第一版', '第一期', '第一行'],
  '领先': ['领先技术', '领先水平', '领先地位', '行业领先', '技术领先', '处于领先'],
  '唯一': ['唯一标识', '唯一ID', '唯一编号', '唯一码', '唯一值', '唯一键'],
  '永久': ['永久免费', '永久有效', '永久保存', '永久删除', '永久存储'],
  '顶级': ['顶级域名'],
  '绝对': ['绝对值', '绝对路径', '绝对定位', '绝对位置', '绝对误差', '绝对温度'],
};

function isFalsePositive(word: string, text: string): boolean {
  const contexts = FALSE_POSITIVE_CONTEXTS[word];
  if (!contexts) return false;
  return contexts.some((ctx) => text.includes(ctx));
}

function checkWordList(
  text: string,
  words: string[],
  category: string,
  baseSeverity: 'high' | 'medium' | 'low',
): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const found = new Set<string>();
  for (const word of words) {
    if (text.includes(word) && !found.has(word)) {
      if (isFalsePositive(word, text)) continue;
      found.add(word);
      let severity = baseSeverity;
      if (category === '广告法绝对化' || category === '虚假宣传') {
        severity = 'medium';
      }
      issues.push({
        dimension: 'compliance',
        severity,
        description: `[${category}] 检测到敏感词："${word}"`,
        suggestion: getSuggestion(category, word),
      });
    }
  }
  return issues;
}

function getSuggestion(category: string, word: string): string {
  switch (category) {
    case '政治敏感':
      return `请立即移除"${word}"，该词汇涉及政治敏感内容，违反相关法规`;
    case '不良信息':
      return `请移除"${word}"，该内容违反互联网信息服务管理规定`;
    case '广告法绝对化':
      return `《广告法》禁止使用绝对化用语"${word}"，建议替换为客观描述（如"优秀""可靠"）`;
    case '医疗敏感':
      return `医疗广告中禁止使用"${word}"，涉嫌夸大疗效或违反《医疗广告管理办法》`;
    case '金融敏感':
      return `金融宣传中禁止使用"${word}"，违反《广告法》第二十五条关于金融理财的禁止性规定`;
    case '虚假宣传':
      return `"${word}"涉嫌虚假宣传，建议提供可验证的证明或删除该表述`;
    default:
      return `请移除或替换敏感词汇"${word}"，确保内容合规`;
  }
}

function checkMedicalClaims(text: string): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const medicalClaimPatterns = [
    { regex: /治愈[率效].{0,5}\d+\s*%/g, desc: '宣称具体治愈率百分比' },
    { regex: /有效率.{0,5}\d+\s*%/g, desc: '宣称具体有效率百分比' },
    { regex: /(包治|根治|治愈|痊愈).{0,10}(病|症|炎|痛|咳|喘)/g, desc: '宣称可根治/包治疾病' },
    { regex: /(纯天然|无副作用|零副作用|安全无毒)/g, desc: '宣称无副作用' },
    { regex: /(替代|代替).{0,5}(处方药|药物|药品)/g, desc: '宣称可替代处方药' },
  ];
  for (const { regex, desc } of medicalClaimPatterns) {
    const matches = text.match(regex);
    if (matches) {
      issues.push({
        dimension: 'compliance',
        severity: 'high',
        description: `[医疗宣称] ${desc}，共 ${matches.length} 处`,
        suggestion: '医疗广告不得含有表示功效、安全性的断言或保证，请删除相关表述',
      });
    }
  }
  return issues;
}

function checkFinancialClaims(text: string): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const financialClaimPatterns = [
    { regex: /(保本|保收益|保证收益|稳赚不赔|零风险|无风险)/g, desc: '承诺保本或收益保证' },
    { regex: /(翻倍|暴富|暴利|日赚|月赚).{0,10}\d/g, desc: '宣称具体收益金额' },
    { regex: /(内部消息|内幕消息|内幕交易|内部信息)/g, desc: '涉嫌内幕交易信息' },
    { regex: /(荐股|推荐股票|牛股|金股|必涨|涨停)/g, desc: '涉嫌非法荐股' },
  ];
  for (const { regex, desc } of financialClaimPatterns) {
    const matches = text.match(regex);
    if (matches) {
      issues.push({
        dimension: 'compliance',
        severity: 'high',
        description: `[金融宣称] ${desc}，共 ${matches.length} 处`,
        suggestion: '金融产品广告不得含有收益承诺或暗示安全保证，违反《广告法》第二十五条',
      });
    }
  }
  return issues;
}

export function checkCompliance(article: Article): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const text = `${article.title}\n${article.contentPlain ?? article.contentMarkdown}`;

  issues.push(...checkWordList(text, POLITICAL_SENSITIVE, '政治敏感', 'high'));
  issues.push(...checkWordList(text, HARMFUL_CONTENT, '不良信息', 'high'));
  issues.push(...checkWordList(text, ADVERTISING_LAW_ABSOLUTE, '广告法绝对化', 'medium'));
  issues.push(...checkWordList(text, MEDICAL_SENSITIVE, '医疗敏感', 'high'));
  issues.push(...checkWordList(text, FINANCIAL_SENSITIVE, '金融敏感', 'high'));
  issues.push(...checkWordList(text, FALSE_ADVERTISING, '虚假宣传', 'medium'));

  issues.push(...checkMedicalClaims(text));
  issues.push(...checkFinancialClaims(text));

  for (const { pattern, description, severity } of REGEX_PATTERNS) {
    if (pattern.test(text)) {
      issues.push({
        dimension: 'compliance',
        severity,
        description: `[正则检测] ${description}`,
        suggestion: '请移除正文中的联系方式或敏感信息，避免被平台判定为违规引流',
      });
    }
  }

  // 重复违规词合并
  const grouped = new Map<string, ReviewIssue>();
  for (const issue of issues) {
    const key = issue.description;
    if (!grouped.has(key)) {
      grouped.set(key, issue);
    }
  }

  return Array.from(grouped.values());
}
