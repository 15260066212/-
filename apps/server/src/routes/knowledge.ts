import { Hono } from 'hono';
import type { Article, KnowledgeSource, AICard } from '@zemingengine/shared';
import type { DatabaseAccess } from '../db.js';

/** 信源组合（按引用集合聚合，各组合隔离展示） */
export interface EkCombination {
  /** 组合签名：成员信源 id 排序后用 + 连接 */
  key: string;
  /** 组合引用次数（仅统计审核通过的文章） */
  count: number;
  /** 成员信源 id（L3 名片在前） */
  memberIds: string[];
  /** 使用该组合的文章 */
  articles: Array<{
    id: string;
    title: string;
    platform: string;
    contentType: string;
    status: string;
    createdAt: string;
  }>;
}

export interface EkKnowledgeData {
  sessionId: string;
  enterprise: { fullName: string; shortName?: string };
  /** 知识库是否已编译出信源 */
  kbReady: boolean;
  /** L2 可引用信源（含 usageCount） */
  l2Sources: KnowledgeSource[];
  /** L3 AI 名片（含引用次数） */
  aiCard: (AICard & { usageCount: number }) | null;
  combinations: EkCombination[];
  stats: {
    l2Count: number;
    l3Usage: number;
    combinationCount: number;
    /** L2 信源被引用总次数（session 内 usageCount 之和） */
    totalCitations: number;
    maxUsage: number;
    minUsage: number;
    articleCount: number;
    approvedCount: number;
    /** 未记录引用集合的历史文章数（记录功能上线前生成） */
    untrackedArticles: number;
  };
  generatedAt: string;
}

/** 组合签名：id 排序后拼接，保证同集合不同顺序聚合到同一组合 */
function combinationKey(ids: string[]): string {
  return [...ids].sort().join('+');
}

function aggregateCombinations(articles: Article[]): {
  combinations: EkCombination[];
  untracked: number;
} {
  const map = new Map<string, EkCombination>();
  let untracked = 0;

  for (const article of articles) {
    const ids = article.citedSourceIds;
    if (!ids || ids.length === 0) {
      untracked++;
      continue;
    }
    const key = combinationKey(ids);
    let combo = map.get(key);
    if (!combo) {
      combo = { key, count: 0, memberIds: ids, articles: [] };
      map.set(key, combo);
    }
    if (article.status === 'approved' || article.status === 'published') {
      combo.count++;
    }
    combo.articles.push({
      id: article.id,
      title: article.title,
      platform: String(article.platform),
      contentType: String(article.contentType),
      status: String(article.status),
      createdAt: article.createdAt,
    });
  }

  // 组合按引用次数降序，同次数按最近使用时间降序
  const combinations = [...map.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    const ta = a.articles.reduce((m, x) => (x.createdAt > m ? x.createdAt : m), '');
    const tb = b.articles.reduce((m, x) => (x.createdAt > m ? x.createdAt : m), '');
    return tb.localeCompare(ta);
  });

  return { combinations, untracked };
}

/**
 * 芯图EK · 企业知识库聚合数据
 * GET /api/knowledge/ek/:sessionId
 *
 * 展示内容：当前会话企业的 L2 可引用信源、L3 AI 名片、
 * 以及按组合隔离的信源组合引用次数（每篇文章生成时的引用集合）。
 */
export function createKnowledgeRoutes(db: DatabaseAccess): Hono {
  const app = new Hono();

  app.get('/ek/:sessionId', (c) => {
    try {
      const sessionId = c.req.param('sessionId');
      const session = db.sessions.getSession(sessionId);
      if (!session) {
        return c.json({ success: false, error: 'Session not found' }, 404);
      }

      const kb = session.knowledgeBase;
      const l2Sources = (kb?.sources ?? []).filter((s) => s.layer === 2);
      const card = kb?.card ?? null;
      const aiCard = card
        ? { ...card, usageCount: card.source?.usageCount ?? 0 }
        : null;

      const articles = db.articles.getArticlesBySession(sessionId);
      const { combinations, untracked } = aggregateCombinations(articles);

      const usages = l2Sources.map((s) => s.usageCount ?? 0);
      const data: EkKnowledgeData = {
        sessionId,
        enterprise: {
          fullName: session.enterprise?.fullName ?? '',
          shortName: session.enterprise?.shortName,
        },
        kbReady: l2Sources.length > 0 || !!card,
        l2Sources,
        aiCard,
        combinations,
        stats: {
          l2Count: l2Sources.length,
          l3Usage: aiCard?.usageCount ?? 0,
          combinationCount: combinations.length,
          totalCitations: usages.reduce((a, b) => a + b, 0),
          maxUsage: usages.length ? Math.max(...usages) : 0,
          minUsage: usages.length ? Math.min(...usages) : 0,
          articleCount: articles.length,
          approvedCount: articles.filter((a) => a.status === 'approved' || a.status === 'published').length,
          untrackedArticles: untracked,
        },
        generatedAt: new Date().toISOString(),
      };

      return c.json({ success: true, data });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Knowledge] EK aggregation failed:', error);
      return c.json({ success: false, error: message }, 500);
    }
  });

  return app;
}
