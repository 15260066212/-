import { classifyFailure } from '@zemingengine/publisher';
import type { PublishTask, Article, PlatformCredentials } from '@zemingengine/shared';
import type { DatabaseAccess } from './db.js';
import type { Publisher } from '@zemingengine/publisher';

/**
 * Execute saveDraftWithRetry and handle result/error by updating task and article status.
 * Shared between scheduler and pipeline to eliminate duplicate error handling.
 *
 * Draft-first flow: articles are saved to the platform's draft box, NOT published
 * directly. On success the task/article status is set to 'draft_saved' and the
 * user must manually publish on the platform, then confirm via the
 * /publish/:taskId/confirm-published endpoint.
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
    const result = await publisher.saveDraftWithRetry(
      task,
      article,
      credentials,
      (updates) => db.publish.updatePublishTask(task.id, updates),
    );

    if (result.success) {
      // Article saved to platform draft box — mark as draft_saved, not published.
      db.publish.updatePublishTask(task.id, {
        status: 'draft_saved',
        platformPostId: result.postId,
        platformPostUrl: result.postUrl,
        verificationStatus: result.verificationStatus ?? 'draft_saved',
        verificationMessage: result.verificationMessage,
      });
      const articleUpdate: Partial<Article> = { status: 'draft_saved' };
      if (result.postUrl) {
        articleUpdate.publishUrl = result.postUrl;
      }
      db.articles.updateArticle(article.id, articleUpdate);
      if (logPrefix) {
        console.log(`${logPrefix} Task ${task.id} saved to draft box successfully`);
      }
    } else {
      const error = result.error ?? 'Unknown draft-save error';
      const analysis = classifyFailure(error);
      db.publish.updatePublishTask(task.id, {
        status: 'failed',
        errorMessage: error,
        failureType: analysis.type,
      });
      db.articles.updateArticle(article.id, { status: 'failed' });
      if (logPrefix) {
        console.warn(
          `${logPrefix} Task ${task.id} draft-save failed: ${error} (${analysis.category})`,
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
      console.error(`${logPrefix} Task ${task.id} draft-save threw error:`, error);
    }
  }
}
