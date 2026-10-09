import { classifyFailure } from '@zemingengine/publisher';
import type { PublishTask, Article, PlatformCredentials } from '@zemingengine/shared';
import type { DatabaseAccess } from './db.js';
import type { Publisher } from '@zemingengine/publisher';

/**
 * Execute publishWithRetry and handle result/error by updating task and article status.
 * Shared between scheduler and pipeline to eliminate duplicate error handling.
 */
export async function executePublishWithHandling(
  db: DatabaseAccess,
  publisher: Publisher,
  task: PublishTask,
  article: Article,
  credentials: PlatformCredentials,
  logPrefix = '',
): Promise<void> {
  try {
    const result = await publisher.publishWithRetry(
      task,
      article,
      credentials,
      (updates) => db.publish.updatePublishTask(task.id, updates),
    );

    if (result.success) {
      db.publish.updatePublishTask(task.id, {
        status: 'published',
        platformPostId: result.postId,
        platformPostUrl: result.postUrl,
        publishedAt: new Date().toISOString(),
      });
      const articleUpdate: Partial<Article> = { status: 'published' };
      if (result.postUrl) {
        articleUpdate.publishUrl = result.postUrl;
      }
      db.articles.updateArticle(article.id, articleUpdate);
      if (logPrefix) {
        console.log(`${logPrefix} Task ${task.id} published successfully`);
      }
    } else {
      const error = result.error ?? 'Unknown publish error';
      const analysis = classifyFailure(error);
      db.publish.updatePublishTask(task.id, {
        status: 'failed',
        errorMessage: error,
        failureType: analysis.type,
      });
      db.articles.updateArticle(article.id, { status: 'failed' });
      if (logPrefix) {
        console.warn(
          `${logPrefix} Task ${task.id} publish failed: ${error} (${analysis.category})`,
        );
      }
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error';
    const analysis = classifyFailure(error);
    db.publish.updatePublishTask(task.id, {
      status: 'failed',
      errorMessage: error,
      failureType: analysis.type,
    });
    db.articles.updateArticle(article.id, { status: 'failed' });
    if (logPrefix) {
      console.error(`${logPrefix} Task ${task.id} publish threw error:`, error);
    }
  }
}
