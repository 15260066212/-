import { describe, expect, it } from 'vitest';
import { createEmptySession } from '@zemingengine/shared';
import { renderManual } from './template.js';

describe('renderManual', () => {
  it('renders a customer-facing manual without internal configuration steps', () => {
    const session = createEmptySession('manual_session');
    session.enterprise = {
      ...session.enterprise,
      fullName: '杭州汇数智通科技有限公司',
      shortName: 'DataFocus',
      description: '中文原生、支持多轮对话的自然语言数据分析平台',
      products: [
        {
          name: 'FocusGPT',
          description: '面向业务人员的自然语言数据分析助手',
          category: '搜索式BI',
          isPrimary: true,
        },
      ],
      userPainPoints: ['传统BI门槛高', '报表响应慢'],
    };
    session.wordBank.industryTerms = ['搜索式BI', '自然语言数据分析'];
    session.promotionGoal = {
      productName: 'FocusGPT',
      positioning: '中文原生、支持多轮对话的自然语言数据分析平台',
      coreValue: '搜索式BI + 自然语言数据分析',
      targetUsers: '业务人员、数据分析师、管理者',
      coreSellingPoint: '通过自然语言查询数据库并生成分析结果',
    };

    const manual = renderManual(session);

    expect(manual).toContain('企业与产品信息');
    expect(manual).toContain('搜索式BI');
    expect(manual).not.toContain('企业画像配置');
    expect(manual).not.toContain('选择企业画像');
    expect(manual).not.toContain('关键词蒸馏');
    expect(manual).not.toContain('多平台发布');
    expect(manual).not.toContain('一站式解决方案：整合内容营销全流程');
  });
});
