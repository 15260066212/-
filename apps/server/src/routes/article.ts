import { Hono } from 'hono';
import { ContentGenerator } from '@zemingengine/content-generator';
import { ContentReviewer } from '@zemingengine/content-reviewer';
import { selectCitedSources, recordSourceUsage } from '@zemingengine/dialogue-engine';
import type { Article, ArticleStatus, GenerateArticleRequest } from '@zemingengine/shared';
import type { DatabaseAccess } from '../db.js';
import { appendContactFooter, appendEkDisclaimer } from '../article-footer.js';
import { updateSession } from '../session-store.js';

export function createArticleRoutes(db: DatabaseAccess): Hono {
  const app = new Hono();
  const generator = new ContentGenerator();
  const reviewer = new ContentReviewer();

  // POST /generate - 生成文章并自动审核，返回 { article, review }
  app.post('/generate', async (c) => {
    try {
      const body = await c.req.json<GenerateArticleRequest>();

      const session = db.sessions.getSession(body.sessionId);
      if (!session) {
        return c.json({ success: false, error: 'Session not found' }, 404);
      }

      // 会话完整性校验：空壳会话（企业名/描述缺失）不允许生成，否则产出必为空洞模板
      const missingFields: string[] = [];
      if (!session.enterprise.fullName?.trim() && !session.enterprise.shortName?.trim()) {
        missingFields.push('企业名称');
      }
      if (!session.enterprise.description?.trim()) {
        missingFields.push('企业描述');
      }
      if (missingFields.length > 0) {
        return c.json(
          { success: false, error: `会话自画像不完整，缺少：${missingFields.join('、')}。请先完成对话采集再生成。` },
          400,
        );
      }

      // 三层检索：L3 AI 名片必引 → L2 候选池（Milvus 语义召回 + 编译式配额 + usageCount 差额均衡），合计 6-9 条
      let milvusCandidateIds: string[] | undefined;
      if (db.milvus?.isEnabled()) {
        try {
          const queryText = [
            (body as { topic?: string }).topic,
            body.contentType,
            body.platform,
            session.enterprise.products.map((p) => p.name).join('、'),
          ].filter(Boolean).join(' ');
          const hits = await db.milvus.semanticSearch(
            session.enterprise.shortName || session.enterprise.fullName || body.sessionId,
            queryText,
            20,
          );
          milvusCandidateIds = hits.map((h) => h.sourceId);
          console.log(`[Article] Milvus 语义召回 ${hits.length} 条`);
        } catch (e) {
          console.warn('[Article] Milvus 语义召回失败，回退纯编译式:', e instanceof Error ? e.message : e);
        }
      }

      const selection = selectCitedSources(session, {
        topic: (body as { topic?: string }).topic,
        platform: body.platform,
        contentType: body.contentType,
      }, { milvusCandidateIds });
      const citedSources = selection?.selected ?? [];

      // EK 信源约束注入：召回为空 → 禁脑补降格观点文；underflow → 防编造提示
      let ekConstraint: string | undefined;
      if (citedSources.length === 0) {
        ekConstraint =
          '【信源缺失硬性约束】本会话芯图EK 知识库无任何可用信源。禁止编造任何企业事实、数据、案例、资质或产品细节；' +
          '本文按行业观点文写作，不得出现企业专属信息，并在文末注明「本文基于行业公开观点整理，不含企业专属信源」。';
        console.warn(`[Article] session ${body.sessionId} 知识库为空（EK 召回 0 条），按观点文模式生成`);
      } else if (selection?.underflow) {
        ekConstraint =
          '【信源不足提示】本次检索信源数量低于下限。正文只能使用已注入信源中的事实，缺失信息一律不得编造。';
        console.warn(`[Article] session ${body.sessionId} 信源 underflow（${citedSources.length} 条），已注入防编造约束`);
      }
      const requestSupplement = (body as { contentSupplement?: string }).contentSupplement;
      const contentSupplement = [requestSupplement, ekConstraint].filter(Boolean).join('\n\n') || undefined;

      const MAX_REGEN_ROUNDS = 3;
      let currentRound = 1;
      let result = await generator.generate(
        {
          sessionId: body.sessionId,
          platform: body.platform,
          contentType: body.contentType,
          generationRound: currentRound,
          citedSources,
          contentSupplement,
        },
        session,
      );

      // AI 降级显性化：模板产出必须可见，不再静默吞掉
      const isFallback = () => (result.article.generationMeta?.model ?? '').startsWith('fallback');
      if (isFallback()) {
        console.error(
          `[Article] ⚠️ AI 生成失败已降级为模板（model=${result.article.generationMeta?.model}），文章 ${result.article.id} 非 AI 产出`,
        );
      }

      // Append enterprise contact info to article footer
      if (citedSources.length === 0) {
        // 代码层强制：模型未必遵守文末注明要求，确保无信源声明可见
        result.article = appendEkDisclaimer(result.article);
      }
      result.article = appendContactFooter(result.article, session.enterprise);
      // 芯图EK · 记录本文实际引用的信源集合（L3 名片在前），用于组合引用统计
      result.article.citedSourceIds = citedSources.map((source) => source.id);
      db.articles.insertArticle(result.article);

      // Auto-review and regenerate if not passed (up to 3 rounds)
      let review = reviewer.review(result.article, session);
      db.reviews.insertReview(review);

      while (!review.passed && currentRound < MAX_REGEN_ROUNDS) {
        currentRound++;
        console.log(`Article ${result.article.id} review failed (round ${currentRound - 1}), regenerating round ${currentRound}...`);

        const regenResult = await generator.generate(
          {
            sessionId: body.sessionId,
            platform: body.platform,
            contentType: body.contentType,
            generationRound: currentRound,
            reviewFeedback: {
              issues: review.issues,
              suggestions: review.suggestions,
              overallScore: review.overallScore,
            },
            citedSources,
            contentSupplement,
          },
          session,
        );

        // Append enterprise contact info to regenerated article too
        if (citedSources.length === 0) {
          regenResult.article = appendEkDisclaimer(regenResult.article);
        }
        regenResult.article = appendContactFooter(regenResult.article, session.enterprise);
        regenResult.article.citedSourceIds = citedSources.map((source) => source.id);
        db.articles.insertArticle(regenResult.article);
        review = reviewer.review(regenResult.article, session);
        db.reviews.insertReview(review);

        if (review.passed) {
          result = regenResult;
          break;
        }
        result = regenResult;
      }

      if (review.passed) {
        db.articles.updateArticle(result.article.id, { status: 'approved' });
        // 生成成功后回写引用计数（失败或未通过不计入，避免引用分布失真）
        if (citedSources.length > 0) {
          const bumped = recordSourceUsage(session, citedSources.map((source) => source.id));
          updateSession(body.sessionId, bumped, db);
          // 同步 usageCount 到 Milvus，让后续语义搜索能在 score 接近时做确定性重排
          if (db.milvus) {
            const sourceMap = new Map((bumped.knowledgeBase.sources ?? []).map((s) => [s.id, s]));
            for (const src of citedSources) {
              const bump = sourceMap.get(src.id);
              if (bump) {
                db.milvus.updateUsageCount(src.id, bump.usageCount).catch((e: unknown) =>
                  console.warn('[Article] Milvus updateUsageCount 失败:', e instanceof Error ? e.message : e),
                );
              }
            }
          }
        }
      }

      return c.json({
        success: true,
        data: {
          article: result.article,
          review,
          aiDegraded: isFallback(),
          ekSourceCount: citedSources.length,
          ekUnderflow: selection?.underflow ?? false,
          generationHistory: {
            totalRounds: currentRound,
            autoRegenerated: currentRound > 1,
          },
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return c.json({ success: false, error: message }, 500);
    }
  });

  // GET / - 查询文章，支持 sessionId 和 status 查询参数
  app.get('/', (c) => {
    try {
      const sessionId = c.req.query('sessionId');
      const status = c.req.query('status') as ArticleStatus | undefined;

      let articles: Article[];
      if (sessionId) {
        articles = db.articles.getArticlesBySession(sessionId);
      } else if (status) {
        articles = db.articles.getArticlesByStatus(status);
      } else {
        const allStatuses: ArticleStatus[] = [
          'draft', 'reviewing', 'approved', 'publishing', 'published', 'failed',
          'draft_saved', 'manual_edit',
        ];
        articles = allStatuses.flatMap((s) => db.articles.getArticlesByStatus(s));
      }

      return c.json({ success: true, data: articles });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return c.json({ success: false, error: message }, 500);
    }
  });

  // GET /:id - 获取单篇文章
  app.get('/:id', (c) => {
    try {
      const id = c.req.param('id');
      const article = db.articles.getArticle(id);
      if (!article) {
        return c.json({ success: false, error: 'Article not found' }, 404);
      }
      return c.json({ success: true, data: article });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return c.json({ success: false, error: message }, 500);
    }
  });

  // PUT /:id - 更新文章
  app.put('/:id', async (c) => {
    try {
      const id = c.req.param('id');
      const existing = db.articles.getArticle(id);
      if (!existing) {
        return c.json({ success: false, error: 'Article not found' }, 404);
      }
      const updates = await c.req.json<Partial<Article>>();
      db.articles.updateArticle(id, updates);
      const updated = db.articles.getArticle(id);
      return c.json({ success: true, data: updated });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return c.json({ success: false, error: message }, 500);
    }
  });

  // DELETE /:id - 软删除（状态改为 failed）
  app.delete('/:id', (c) => {
    try {
      const id = c.req.param('id');
      const existing = db.articles.getArticle(id);
      if (!existing) {
        return c.json({ success: false, error: 'Article not found' }, 404);
      }
      db.articles.updateArticle(id, { status: 'failed' });
      return c.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return c.json({ success: false, error: message }, 500);
    }
  });

  return app;
}
