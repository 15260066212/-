import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useArticleStore } from '../../stores/articleStore.js';
import type { PlatformId } from '@zemingengine/shared';
import { ArticleStatusBadge } from './ArticleStatusBadge.js';
import { ReviewReport } from './ReviewReport.js';
import { ExternalLink, AlertTriangle, CheckCircle2, PenSquare } from 'lucide-react';

const PLATFORM_LABELS: Record<string, string> = {
  weixin: '微信公众号',
  zhihu: '知乎',
  baijia: '百家号',
  toutiao: '今日头条',
  csdn: 'CSDN',
  juejin: '掘金',
  bilibili: '哔哩哔哩',
  sohu: '搜狐号',
  netease: '网易号',
  zhidao: '百度知道',
  deepseek: 'DeepSeek',
  kimi: 'Kimi',
  doubao: '豆包',
  yuanbao: '元宝',
  qianwen: '千问',
};

interface Feedback {
  type: 'success' | 'error';
  msg: string;
}

export function ArticleDetail() {
  const {
    articles,
    selectedArticleId,
    review,
    loading,
    actionLoading,
    fetchReview,
    publishArticle,
    reviewArticle,
    deleteArticle,
  } = useArticleStore();

  const article = articles.find((a) => a.id === selectedArticleId);
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editSummary, setEditSummary] = useState('');
  const [reviewMsg, setReviewMsg] = useState<string | null>(null);

  // 选中文章变化时拉取最新审核结果
  useEffect(() => {
    if (selectedArticleId) {
      fetchReview(selectedArticleId);
    }
  }, [selectedArticleId, fetchReview]);

  const [feedback, setFeedback] = useState<Feedback | null>(null);

  // 切换文章时清空操作反馈
  useEffect(() => {
    setFeedback(null);
    setReviewMsg(null);
    setEditMode(false);
  }, [selectedArticleId]);

  if (!article) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
        请从左侧选择一篇文章查看详情
      </div>
    );
  }

  const handlePublish = async () => {
    setFeedback(null);
    try {
      await publishArticle(article.id);
      setFeedback({ type: 'success', msg: '已提交发布任务，正在发布到目标平台...' });
    } catch (err) {
      setFeedback({
        type: 'error',
        msg: err instanceof Error ? err.message : '发布失败',
      });
    }
  };

  const handleReReview = async () => {
    setFeedback(null);
    setReviewMsg(null);
    try {
      const result = await reviewArticle(article.id);
      const msg = (result as any).message;
      if (msg) setReviewMsg(msg);
      setFeedback({
        type: 'success',
        msg: result.passed ? '审核通过' : '审核未通过',
      });
      if ((result as any).manualEdit) {
        // 3次不通过，已转为人工改写
        setEditMode(true);
        setEditContent(article.contentMarkdown || '');
        setEditTitle(article.title || '');
        setEditSummary(article.summary || '');
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        msg: err instanceof Error ? err.message : '重新审核失败',
      });
    }
  };

  const handleManualSave = async () => {
    setFeedback(null);
    try {
      const apiKey = localStorage.getItem('apiKey') || '';
      const resp = await fetch(`/api/reviews/${article.id}/manual-save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({
          contentMarkdown: editContent,
          title: editTitle,
          summary: editSummary,
        }),
      });
      const data = await resp.json();
      if (!data.success) {
        setFeedback({ type: 'error', msg: data.error || '保存失败' });
        return;
      }
      setEditMode(false);
      setFeedback({
        type: 'success',
        msg: data.data.passed ? '人工改写后审核通过' : '人工改写后审核仍未通过',
      });
      if (data.data.passed) {
        // 刷新文章列表状态
        window.location.reload();
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        msg: err instanceof Error ? err.message : '保存失败',
      });
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`确定要删除文章「${article.title || '未命名文章'}」吗？`)) return;
    setFeedback(null);
    try {
      await deleteArticle(article.id);
      setFeedback({ type: 'success', msg: '文章已删除' });
    } catch (err) {
      setFeedback({
        type: 'error',
        msg: err instanceof Error ? err.message : '删除失败',
      });
    }
  };

  const canPublish =
    !actionLoading &&
    article.status !== 'publishing' &&
    article.status !== 'published';

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50">
      <div className="max-w-3xl mx-auto p-6 space-y-4">
        {/* 标题区 */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <ArticleStatusBadge status={article.status} />
            {(article as any).reviewRound > 0 && (
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                (article as any).reviewRound >= 3
                  ? 'bg-orange-100 text-orange-700'
                  : 'bg-blue-50 text-blue-600'
              }`}>
                审核 第{(article as any).reviewRound}轮/3
              </span>
            )}
            {(article as any).generationMeta?.model === 'fallback-template-v2' ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-600" title="文章未由 DeepSeek API 生成，使用了回退模板">
                <AlertTriangle className="w-3 h-3" />
                模板生成
              </span>
            ) : (article as any).generationMeta?.model ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-600" title={`由 ${(article as any).generationMeta.model} 生成`}>
                <CheckCircle2 className="w-3 h-3" />
                DeepSeek AI 生成
              </span>
            ) : null}
            <span className="text-xs text-gray-400">
              创建于 {new Date(article.createdAt).toLocaleString('zh-CN')}
            </span>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-3">
            {article.title || '(未命名文章)'}
          </h1>
          {article.summary && (
            <p className="text-sm text-gray-600 leading-relaxed mb-3">
              {article.summary}
            </p>
          )}
          <div className="flex items-center gap-4 text-sm text-gray-500">
            <span>
              平台：
              <span className="text-gray-700">
                {PLATFORM_LABELS[article.platform] ?? article.platform}
              </span>
            </span>
            <span>
              字数：<span className="text-gray-700">{article.wordCount}</span>
            </span>
            {article.status === 'published' && article.publishUrl && (
              <a
                href={article.publishUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 hover:underline"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                查看发布文章
              </a>
            )}
            {article.status === 'draft_saved' && (
              <span className="inline-flex items-center gap-1 text-amber-600 text-xs" title="文章已保存到平台草稿箱，但未正式发布">
                <AlertTriangle className="w-3.5 h-3.5" />
                文章仅存草稿，未正式发布
              </span>
            )}
            <span>
              类型：
              <span className="text-gray-700">
                {article.contentType === 'tutorial'
                  ? '教程'
                  : article.contentType === 'case'
                  ? '案例'
                  : article.contentType === 'comparison'
                  ? '对比'
                  : article.contentType === 'faq'
                  ? 'FAQ问答'
                  : article.contentType === 'whitepaper'
                  ? '白皮书'
                  : '科普'}
              </span>
            </span>
            {article.reviewRound > 0 && (
              <span className="text-orange-600">
                审核轮次：{article.reviewRound}/3
              </span>
            )}
          </div>
        </div>

        {/* 操作按钮区 */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handlePublish}
              disabled={!canPublish}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {actionLoading ? '处理中...' : '发布'}
            </button>
            <button
              onClick={handleReReview}
              disabled={actionLoading}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              重新审核
            </button>
            <button
              onClick={() => {
                setEditMode(true);
                setEditContent(article.contentMarkdown || '');
                setEditTitle(article.title || '');
                setEditSummary(article.summary || '');
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-orange-300 px-4 py-2 text-sm font-medium text-orange-600 hover:bg-orange-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <PenSquare className="w-3.5 h-3.5" />
              人工修改
            </button>
            <button
              onClick={handleDelete}
              disabled={actionLoading}
              className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              删除
            </button>
          </div>
          {feedback && (
            <div
              className={`mt-3 rounded-md px-3 py-2 text-sm ${
                feedback.type === 'success'
                  ? 'bg-green-50 text-green-700'
                  : 'bg-red-50 text-red-700'
              }`}
            >
              {feedback.msg}
            </div>
          )}
          {reviewMsg && (
            <div className="mt-2 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-700">
              {reviewMsg}
            </div>
          )}
        </div>

        {/* 标签区 */}
        {article.tags.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="text-sm font-medium text-gray-700 mb-2">标签</h3>
            <div className="flex flex-wrap gap-2">
              {article.tags.map((tag, i) => (
                <span
                  key={i}
                  className="inline-flex items-center rounded-full bg-purple-50 px-2.5 py-0.5 text-xs font-medium text-purple-600"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 人工修改编辑器 */}
        {editMode && (
          <div className="bg-white rounded-lg border border-orange-300 p-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
                人工修改模式
              </span>
              <span className="text-xs text-gray-500">
                {(article as any).reviewRound >= 3
                  ? '文章已连续3次审核未通过，请手动修改后保存并重新审核'
                  : '手动修改文章内容，保存后将自动重新审核'}
              </span>
            </div>
            {/* Three-round review flow indicator */}
            <div className="mb-4 flex items-center gap-2 text-xs">
              {[1, 2, 3].map((round) => {
                const currentRound = (article as any).reviewRound || 0;
                const isActive = currentRound === round;
                const isPassed = currentRound > round || article.status === 'approved';
                const isManual = round === 3 && currentRound >= 3;
                return (
                  <div key={round} className="flex items-center">
                    <div className={`flex items-center gap-1 px-2 py-1 rounded-full ${
                      isManual
                        ? 'bg-orange-100 text-orange-700'
                        : isPassed
                        ? 'bg-green-50 text-green-600'
                        : isActive
                        ? 'bg-blue-50 text-blue-600'
                        : 'bg-gray-50 text-gray-400'
                    }`}>
                      {isManual ? (
                        <PenSquare className="w-3 h-3" />
                      ) : isPassed ? (
                        <CheckCircle2 className="w-3 h-3" />
                      ) : null}
                      <span>
                        {round === 3 ? '第3轮（人工修改）' : `第${round}轮（八维度审核）`}
                      </span>
                    </div>
                    {round < 3 && <div className={`w-4 h-px ${isPassed ? 'bg-green-300' : 'bg-gray-200'}`} />}
                  </div>
                );
              })}
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">标题</label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">摘要</label>
                <input
                  type="text"
                  value={editSummary}
                  onChange={(e) => setEditSummary(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">正文内容（Markdown）</label>
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  rows={20}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none resize-y"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleManualSave}
                  disabled={actionLoading}
                  className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
                >
                  保存并重新审核
                </button>
                <button
                  onClick={() => setEditMode(false)}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 正文内容（Markdown 渲染） */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h3 className="text-sm font-medium text-gray-700 mb-3">正文内容</h3>
          {article.contentMarkdown ? (
            <div className="max-h-[60vh] overflow-y-auto pr-1">
              <div className="prose-sm text-gray-800">
                <ReactMarkdown
                  components={{
                    h1: ({ children }) => (
                      <h1 className="text-2xl font-bold text-gray-900 mt-6 mb-3">
                        {children}
                      </h1>
                    ),
                    h2: ({ children }) => (
                      <h2 className="text-xl font-bold text-gray-900 mt-5 mb-3">
                        {children}
                      </h2>
                    ),
                    h3: ({ children }) => (
                      <h3 className="text-lg font-semibold text-gray-800 mt-4 mb-2">
                        {children}
                      </h3>
                    ),
                    h4: ({ children }) => (
                      <h4 className="text-base font-semibold text-gray-800 mt-3 mb-2">
                        {children}
                      </h4>
                    ),
                    p: ({ children }) => (
                      <p className="text-sm text-gray-700 leading-relaxed mb-3">
                        {children}
                      </p>
                    ),
                    ul: ({ children }) => (
                      <ul className="list-disc list-inside text-sm text-gray-700 mb-3 space-y-1 pl-2">
                        {children}
                      </ul>
                    ),
                    ol: ({ children }) => (
                      <ol className="list-decimal list-inside text-sm text-gray-700 mb-3 space-y-1 pl-2">
                        {children}
                      </ol>
                    ),
                    li: ({ children }) => (
                      <li className="text-sm text-gray-700">{children}</li>
                    ),
                    strong: ({ children }) => (
                      <strong className="font-semibold text-gray-900">
                        {children}
                      </strong>
                    ),
                    em: ({ children }) => (
                      <em className="italic text-gray-700">{children}</em>
                    ),
                    a: ({ href, children }) => (
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 underline hover:text-blue-700"
                      >
                        {children}
                      </a>
                    ),
                    blockquote: ({ children }) => (
                      <blockquote className="border-l-4 border-gray-200 pl-4 italic text-gray-600 my-3">
                        {children}
                      </blockquote>
                    ),
                    code: ({ className, children }) => {
                      const isBlock = /language-/.test(className || '');
                      if (isBlock) {
                        return <code className={className}>{children}</code>;
                      }
                      return (
                        <code className="rounded bg-gray-100 px-1 py-0.5 text-xs font-mono text-pink-600">
                          {children}
                        </code>
                      );
                    },
                    pre: ({ children }) => (
                      <pre className="bg-gray-800 text-gray-100 rounded-md p-3 overflow-x-auto text-xs my-3">
                        {children}
                      </pre>
                    ),
                    hr: () => <hr className="my-4 border-gray-200" />,
                    table: ({ children }) => (
                      <div className="overflow-x-auto my-3">
                        <table className="w-full text-sm border-collapse">
                          {children}
                        </table>
                      </div>
                    ),
                    th: ({ children }) => (
                      <th className="border border-gray-300 px-2 py-1 bg-gray-50 text-left font-medium text-gray-700">
                        {children}
                      </th>
                    ),
                    td: ({ children }) => (
                      <td className="border border-gray-300 px-2 py-1 text-gray-700">
                        {children}
                      </td>
                    ),
                    img: ({ src, alt }) => (
                      <img
                        src={typeof src === 'string' ? src : undefined}
                        alt={alt ?? ''}
                        className="max-w-full rounded-md my-3"
                      />
                    ),
                  }}
                >
                  {article.contentMarkdown}
                </ReactMarkdown>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400">(无内容)</p>
          )}
        </div>

        {/* 审核报告 */}
        <div>
          <h3 className="text-sm font-medium text-gray-700 mb-2">审核结果</h3>
          {loading && !review ? (
            <div className="bg-white rounded-lg border border-gray-200 p-5 text-center text-sm text-gray-400">
              正在加载审核结果...
            </div>
          ) : review ? (
            <ReviewReport review={review} />
          ) : (
            <div className="bg-white rounded-lg border border-gray-200 p-5 text-center text-sm text-gray-400">
              暂无审核结果，点击「重新审核」生成审核报告
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
