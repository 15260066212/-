import { Hono } from 'hono';
import { ContentGenerator } from '@zemingengine/content-generator';
import { ContentReviewer } from '@zemingengine/content-reviewer';
import type { Article, ArticleStatus, GenerateArticleRequest } from '@zemingengine/shared';
import type { DatabaseAccess } from '../db.js';
import { appendContactFooter } from '../article-footer.js';

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

      const MAX_REGEN_ROUNDS = 3;
      let currentRound = 1;
      let result = await generator.generate(
        {
          sessionId: body.sessionId,
          platform: body.platform,
          contentType: body.contentType,
          generationRound: currentRound,
        },
        session,
      );

      // Append enterprise contact info to article footer
      result.article = appendContactFooter(result.article, session.enterprise);
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
          },
          session,
        );

        // Append enterprise contact info to regenerated article too
        regenResult.article = appendContactFooter(regenResult.article, session.enterprise);
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
      }

      return c.json({
        success: true,
        data: {
          article: result.article,
          review,
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
